import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
export interface EncryptionKeyring { activeKeyId: string; keys: Record<string, string> }

export const createCipher = (ring: EncryptionKeyring, namespace = "wallet-backend:v2") => {
  if (!ring.keys[ring.activeKeyId] || Object.entries(ring.keys).some(([id, key]) => !/^[a-zA-Z0-9_-]{1,64}$/.test(id) || !/^[a-f\d]{64}$/i.test(key))) throw new Error("Invalid encryption keyring");
  const keyFor = (id: string, context: string) => {
    const master = ring.keys[id];
    if (!master) throw new Error("Encryption key is unavailable; retain referenced keys");
    return Buffer.from(hkdfSync("sha256", Buffer.from(master, "hex"), Buffer.from(namespace),
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
