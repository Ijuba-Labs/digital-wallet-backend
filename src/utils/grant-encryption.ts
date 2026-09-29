import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

export interface EncryptionKeyring { activeKeyId: string; keys: Record<string, string> }

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

export const createGrantCipher = (legacyKey?: string) => {
  const ring = loadKeyring(legacyKey);
  const keyFor = (id: string, context: string) => {
    const master = ring.keys[id];
    if (!master) throw new Error("Encryption key is unavailable; retain referenced keys");
    return Buffer.from(hkdfSync("sha256", Buffer.from(master, "hex"), Buffer.from("wallet-backend:v2"),
      Buffer.from(context.split(":")[0]), 32));
  };
  const encrypt = (plaintext: string, context: string): string => {
    const id = ring.activeKeyId;
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", keyFor(id, context), iv);
    cipher.setAAD(Buffer.from(`v2:${id}:${context}`));
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return ["v2", id, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(":");
  };
  const decrypt = (encrypted: string, context: string): string => {
    const [version, id, iv, tag, ciphertext, extra] = encrypted.split(":");
    if (version !== "v2" || !id || !iv || !tag || !ciphertext || extra !== undefined) throw new Error("Invalid encrypted grant format");
    const nonce = Buffer.from(iv, "base64url");
    const authTag = Buffer.from(tag, "base64url");
    if (nonce.length !== 12 || authTag.length !== 16) throw new Error("Invalid encrypted grant format");
    const decipher = createDecipheriv("aes-256-gcm", keyFor(id, context), nonce);
    decipher.setAAD(Buffer.from(`v2:${id}:${context}`));
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
  };
  return { encrypt, decrypt, activeKeyId: ring.activeKeyId, keyIds: Object.keys(ring.keys) };
};
