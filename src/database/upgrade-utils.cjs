const fs = require('node:fs');
const path = require('node:path');
const schema = () => fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

exports.ensureTable = async (knex, name) => {
  if (await knex.schema.hasTable(name)) return;
  const source = schema();
  const start = source.indexOf('CREATE TABLE ' + name + ' (');
  const end = source.indexOf('\n);', start);
  if (start < 0 || end < 0) throw new Error('Missing baseline table definition: ' + name);
  await knex.raw(source.slice(start, end + 3));
};
exports.ensureIndexes = async (knex, table) => {
  for (const line of schema().split('\n')) {
    if (/^CREATE (UNIQUE )?INDEX /.test(line) && line.includes(' ON ' + table + '(')) {
      await knex.raw(line.replace('INDEX ', 'INDEX IF NOT EXISTS '));
    }
  }
};
exports.addColumns = async (knex, table, definitions) => {
  for (const [name, definition] of Object.entries(definitions)) {
    if (!await knex.schema.hasColumn(table, name)) {
      await knex.raw('ALTER TABLE ?? ADD COLUMN ?? ' + definition, [table, name]);
    }
  }
};
exports.amountFunction = async (knex) => {
  const source = schema();
  const start = source.indexOf('CREATE FUNCTION valid_payment_amount');
  const end = source.indexOf('END $$;', start);
  if (start < 0 || end < 0) throw new Error('Missing payment amount validation function');
  await knex.raw(source.slice(start, end + 7).replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION'));
};
exports.noRollback = async () => {
  throw new Error('Data-preserving upgrades are forward-only; restore a verified database backup to roll back.');
};
