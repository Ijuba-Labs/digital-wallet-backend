import db from "./config/database";
import { createGrantCipher } from "./utils/grant-encryption";
import { assertEncryptionKeys } from "./utils/encryption-audit";
import { walletCredentialTables } from "./utils/wallet-credential-tables";

const cipher = createGrantCipher();
try {
  await assertEncryptionKeys(db);
  const walletTables = await walletCredentialTables(db);
  const retirement = process.argv.indexOf("--check-retirement");
  if (retirement >= 0) {
    const id = process.argv[retirement + 1];
    if (!id || id === cipher.activeKeyId) throw new Error("Specify a non-active key ID");
    const references = await db("transfer_credentials").where({ key_id: id }).count("* as count").first();
    let walletReferences = 0;
    for (const table of walletTables) {
      const grants = await db(table).where({ key_id: id }).count("* as count").first();
      walletReferences += Number(grants?.count);
    }
    if (Number(references?.count) + walletReferences > 0) throw new Error("Key retirement blocked by durable references");
    console.log("No durable references. Retire only after all processes use the new keyring and the maximum Redis session TTL has elapsed.");
  } else {
    let changed = 0;
    // Keyset paging makes retries resumable without keeping an open transaction during encryption.
    let cursor = "";
    for (;;) {
      const rows = await db("transfer_credentials").whereNot("key_id", cipher.activeKeyId).whereNot("state", "ROTATING")
        .whereRaw("transfer_id::text || ':' || purpose > ?", [cursor]).orderByRaw("transfer_id::text || ':' || purpose").limit(100);
      if (!rows.length) break;
      for (const row of rows) {
        cursor = `${row.transfer_id}:${row.purpose}`;
        const context = `transfer-${row.purpose}:${row.transfer_id}`;
        const encrypted = cipher.encrypt(cipher.decrypt(row.token_enc, context), context);
        changed += await db("transfer_credentials").where({ transfer_id: row.transfer_id, purpose: row.purpose,
          token_enc: row.token_enc, generation: row.generation, state: row.state })
          .update({ token_enc: encrypted, key_id: cipher.activeKeyId });
      }
    }
    for (const table of walletTables) {
      if (!await db.schema.hasColumn(table, "transaction_id") || !await db.schema.hasColumn(table, "wallet_id")) continue;
      cursor = "";
      for (;;) {
        const rows = await db(table).whereNotNull("access_token_enc").whereNot("key_id", cipher.activeKeyId)
          .whereRaw("id::text > ?", [cursor]).orderByRaw("id::text").limit(100);
        if (!rows.length) break;
        for (const row of rows) {
          cursor = row.id;
          const context = `wallet-access:${row.transaction_id}:${row.wallet_id}`;
          changed += await db(table).where({ id: row.id, access_token_enc: row.access_token_enc })
            .update({ access_token_enc: cipher.encrypt(cipher.decrypt(row.access_token_enc, context), context), key_id: cipher.activeKeyId });
        }
      }
    }
    console.log(`Re-encrypted ${changed} durable credentials. ROTATING records remain untouched; repeat after resolving them.`);
  }
} catch (error) { console.error(error instanceof Error ? error.message : "Key maintenance failed"); process.exitCode = 1; }
finally { await db.destroy(); }
