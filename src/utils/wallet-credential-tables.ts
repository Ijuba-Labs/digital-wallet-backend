import type { Knex } from "knex";

/** Preserve key references in quarantined legacy rows during schema upgrades. */
export async function walletCredentialTables(db: Knex): Promise<string[]> {
  const tables = ["wallet_access_grants"];
  if (await db.schema.hasTable("legacy_wallet_grants") && await db.schema.hasColumn("legacy_wallet_grants", "key_id")) {
    tables.push("legacy_wallet_grants");
  }
  return tables;
}
