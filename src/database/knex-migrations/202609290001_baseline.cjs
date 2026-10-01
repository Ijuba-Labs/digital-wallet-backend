const fs = require('node:fs');
const path = require('node:path');
exports.up = async (knex) => {
  if (await knex.schema.hasTable('users')) {
    // Adopt only the known core schema. Incremental migrations below preserve
    // application rows; never replay CREATE TABLE over an existing installation.
    for (const table of ['wallets', 'accounts', 'ledger_transfers', 'reward_events']) {
      if (!await knex.schema.hasTable(table)) throw new Error('Unsupported existing core schema: missing ' + table);
    }
    for (const column of ['id', 'user_id', 'wallet_address_url', 'asset_code', 'asset_scale', 'status']) {
      if (!await knex.schema.hasColumn('wallets', column)) throw new Error('Unsupported existing wallets schema: missing ' + column);
    }
    return;
  }
  await knex.raw(fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8'));
};
exports.down = async () => { throw new Error('Destructive baseline rollback is disabled. Restore a backup or explicitly rebuild a development database.'); };
