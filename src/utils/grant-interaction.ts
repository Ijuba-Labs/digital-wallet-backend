import { createHash, timingSafeEqual } from "node:crypto";

export type GrantInteraction = {
  clientNonce: string;
  serverInteractNonce: string;
  grantRequestUrl: string;
};

/** Compare the GNAP digest bytes; Open Payments providers also use standard Base64. */
export const verifyInteractionHash = (interaction: GrantInteraction, interactRef: string, receivedHash: string): boolean => {
  const parts = [interaction.clientNonce, interaction.serverInteractNonce, interactRef, interaction.grantRequestUrl];
  if (parts.some((part) => !part || /[^\x21-\x7e]/.test(part))) return false;
  const urlSafe = /^[A-Za-z0-9_-]{43}$/.test(receivedHash);
  const standard = /^[A-Za-z0-9+/]{43}=?$/.test(receivedHash);
  if (!urlSafe && !standard) return false;
  const received = Buffer.from(receivedHash, urlSafe ? "base64url" : "base64");
  if (received.length !== 32) return false;
  const canonical = received.toString(urlSafe ? "base64url" : "base64");
  if (urlSafe ? canonical !== receivedHash : canonical !== (receivedHash.endsWith("=") ? receivedHash : `${receivedHash}=`)) return false;
  const expected = createHash("sha256").update(parts.join("\n"), "ascii").digest();
  return timingSafeEqual(expected, received);
};

export const callbackFingerprint = (interactRef: string, hash: string): string =>
  createHash("sha256").update(JSON.stringify([interactRef, hash])).digest("hex");
