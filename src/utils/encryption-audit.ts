import type { Knex } from "knex";
import { createGrantCipher } from "./grant-encryption";
import { walletCredentialTables } from "./wallet-credential-tables";
export async function assertEncryptionKeys(db: Knex): Promise<void> {
  const cipher = createGrantCipher();
  const tables = await walletCredentialTables(db);
  const references = await db("transfer_credentials").distinct("key_id")
    .union(tables.map((table) => db(table).distinct("key_id").whereNotNull("key_id")));
  if (references.some((row) => !cipher.keyIds.includes(row.key_id))) throw new Error("Mounted keyring is missing a durable credential key");
}
