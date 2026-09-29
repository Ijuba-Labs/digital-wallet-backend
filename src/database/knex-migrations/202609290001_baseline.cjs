const fs = require('node:fs');
const path = require('node:path');
exports.up = async (knex) => {
  if (await knex.schema.hasTable('users')) throw new Error('Fresh-install baseline requires an empty application database. Do not replay it over an existing schema.');
  await knex.raw(fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8'));
};
exports.down = async () => { throw new Error('Destructive baseline rollback is disabled. Restore a backup or explicitly rebuild a development database.'); };
