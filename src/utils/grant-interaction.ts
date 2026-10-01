import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { AppError } from "./appError";

export const createInteractionNonce = (): string => randomBytes(32).toString("base64url");

const digestBytes = (hash: string): Buffer | null => {
  if (!/^(?:[A-Za-z0-9_-]{43}|[A-Za-z0-9+/]{43})=?$/.test(hash)) return null;
  const bytes = Buffer.from(hash, "base64url");
  if (bytes.length !== 32 || bytes.toString("base64url") !== hash.replace(/=$/, "").replace(/\+/g, "-").replace(/\//g, "_")) return null;
  return bytes;
};

export type GrantInteraction = {
  clientNonce: string;
  serverInteractNonce: string;
  grantRequestUrl: string;
};

/** Compare the GNAP digest bytes; Open Payments providers also use standard Base64. */
export const verifyInteractionHash = (interaction: GrantInteraction, interactRef: string, receivedHash: string): boolean => {
  const parts = [interaction.clientNonce, interaction.serverInteractNonce, interactRef, interaction.grantRequestUrl];
  if (parts.some((part) => !part || /[^\x21-\x7e]/.test(part))) return false;
  const received = digestBytes(receivedHash);
  if (!received) return false;
  const expected = createHash("sha256").update(parts.join("\n"), "ascii").digest();
  return timingSafeEqual(expected, received);
};

export const callbackFingerprint = (interactRef: string, hash: string): string => {
  const bytes = digestBytes(hash);
  if (!bytes || !interactRef || /[^\x21-\x7e]/.test(interactRef)) throw new AppError("Invalid callback proof", 400);
  return createHash("sha256").update(JSON.stringify([interactRef, bytes.toString("hex")])).digest("hex");
};
