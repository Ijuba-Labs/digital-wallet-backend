import type { Knex } from "knex";
import { createGrantCipher } from "./grant-encryption";
export async function assertEncryptionKeys(db: Knex): Promise<void> {
  const cipher = createGrantCipher();
  const references = await db("transfer_credentials").distinct("key_id")
    .union(db("wallet_grants").distinct("key_id").whereNotNull("key_id"));
  if (references.some((row) => !cipher.keyIds.includes(row.key_id))) throw new Error("Mounted keyring is missing a durable credential key");
}
