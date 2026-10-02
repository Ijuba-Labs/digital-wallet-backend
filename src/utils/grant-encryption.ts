import { createCipher, type EncryptionKeyring } from "@open-rewards/payment-primitives";
export type { EncryptionKeyring } from "@open-rewards/payment-primitives";
import { readFileSync } from "node:fs";



export const loadKeyring = (legacyKey?: string): EncryptionKeyring => {
  const path = process.env.ENCRYPTION_KEYRING_FILE;
  const ring: EncryptionKeyring = path
    ? JSON.parse(readFileSync(path, "utf8"))
    : { activeKeyId: "development", keys: { development: legacyKey ?? process.env.GRANT_ENCRYPTION_KEY ?? "" } };
  if (process.env.NODE_ENV === "production" && !path) throw new Error("Production requires ENCRYPTION_KEYRING_FILE");
  if (!ring || !ring.keys || !/^[a-zA-Z0-9_-]{1,64}$/.test(ring.activeKeyId) || !ring.keys[ring.activeKeyId] ||
      Object.entries(ring.keys).some(([id, key]) => !/^[a-zA-Z0-9_-]{1,64}$/.test(id) || typeof key !== "string" || !/^[a-f\d]{64}$/i.test(key))) {
    throw new Error("Invalid encryption keyring");
  }
  return ring;
};

export const createGrantCipher = (legacyKey?: string) => createCipher(loadKeyring(legacyKey));
