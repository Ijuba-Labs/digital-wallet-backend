const { ensureTable, ensureIndexes, addColumns, noRollback } = require('../upgrade-utils.cjs');

const canonicalWallet = (value) => {
  const url = new URL(value);
  const authority = /^https:\/\/([^/?#]+)/i.exec(value)?.[1];
  if (!authority || /[\\\s\x00-\x1f]/.test(value) || url.protocol !== 'https:' || url.username || url.password ||
      authority.includes('@') || value.includes('?') || value.includes('#') ||
      (authority.startsWith('[') ? !authority.endsWith(']') : authority.includes(':'))) {
    throw new Error('Existing wallet address violates the wallet URL policy; resolve it before upgrading.');
  }
  return url.href;
};

exports.up = async (knex) => {
  await addColumns(knex, 'wallets', { public_name: 'TEXT', verified_at: 'TIMESTAMPTZ' });
  const wallets = await knex('wallets').select('id', 'wallet_address_url', 'status');
  const linkedOwners = new Set();
  const canonical = wallets.map((wallet) => {
    let address;
    try { address = canonicalWallet(wallet.wallet_address_url); }
    catch { throw new Error('Existing wallet address violates the wallet URL policy; resolve it before upgrading.'); }
    if (['ACTIVE', 'LINKED'].includes(wallet.status)) {
      if (linkedOwners.has(address)) throw new Error('Competing linked wallet owners exist; resolve ownership before upgrading. No owner is chosen automatically.');
      linkedOwners.add(address);
    }
    return { ...wallet, address };
  });
  await knex.raw('DROP INDEX IF EXISTS uq_wallets_active_address');
  for (const wallet of canonical) {
    if (wallet.wallet_address_url !== wallet.address) await knex('wallets').where({ id: wallet.id }).update({ wallet_address_url: wallet.address });
  }
  const type = await knex('pg_type').where({ typname: 'wallet_link_status' }).first();
  if (!type) await knex.raw("CREATE TYPE wallet_link_status AS ENUM ('LINKED','UNLINKED')");
  const column = await knex('information_schema.columns').where({ table_schema: 'public', table_name: 'wallets', column_name: 'status' }).first();
  if (column.udt_name !== 'wallet_link_status') {
    await knex.raw('ALTER TABLE wallets ALTER COLUMN status DROP DEFAULT');
    await knex.raw("ALTER TABLE wallets ALTER COLUMN status TYPE wallet_link_status USING (CASE WHEN status::text IN ('ACTIVE','LINKED') THEN 'LINKED' ELSE 'UNLINKED' END)::wallet_link_status");
    await knex.raw("ALTER TABLE wallets ALTER COLUMN status SET DEFAULT 'LINKED'");
  }
  await ensureIndexes(knex, 'wallets');
  for (const table of ['wallet_ownership_attestations', 'wallet_access_grants', 'onboarding_requests']) {
    await ensureTable(knex, table);
    await ensureIndexes(knex, table);
  }
  if (await knex.schema.hasTable('wallet_grants')) {
    if (await knex.schema.hasTable('legacy_wallet_grants')) throw new Error('Both wallet_grants and legacy_wallet_grants exist; resolve this ambiguous upgrade state first.');
    await knex.schema.renameTable('wallet_grants', 'legacy_wallet_grants');
  }
  if (await knex.schema.hasTable('legacy_wallet_grants')) {
    const columns = await knex('legacy_wallet_grants').columnInfo();
    const ownershipFields = ['id','wallet_id','transaction_id','verified_subject_uri','verified_at','callback_fingerprint','client_id','return_url','created_at'];
    if (ownershipFields.every((name) => columns[name]) && columns.purpose) {
      await knex.raw(`INSERT INTO wallet_ownership_attestations (${ownershipFields.join(',')})
        SELECT ${ownershipFields.join(',')} FROM legacy_wallet_grants
        WHERE purpose = 'ONBOARDING' AND transaction_id IS NOT NULL AND verified_subject_uri IS NOT NULL
          AND verified_at IS NOT NULL AND callback_fingerprint IS NOT NULL
        ON CONFLICT (transaction_id) DO NOTHING`);
    }
    const credentialFields = ['id','wallet_id','transaction_id','status','access_token_enc','key_id','manage_url','access','expires_at','created_at','updated_at'];
    if (credentialFields.every((name) => columns[name]) && columns.purpose) {
      await knex.raw(`INSERT INTO wallet_access_grants (${credentialFields.join(',')})
        SELECT ${credentialFields.join(',')} FROM legacy_wallet_grants
        WHERE purpose = 'REUSABLE_ACCESS' AND transaction_id IS NOT NULL AND access_token_enc IS NOT NULL
          AND key_id IS NOT NULL AND manage_url IS NOT NULL AND status IN ('ACTIVE','EXPIRED','REVOKED')
        ON CONFLICT (transaction_id) DO NOTHING`);
    }
    // Older grants lack trustworthy ownership proof or usable credential metadata.
    // Retain them intact in quarantine; never invent verification or activate them.
  }
};
exports.down = noRollback;
