require('dotenv').config({ quiet: true });
const path = require('node:path');
const config = {
  client: 'pg', connection: process.env.DATABASE_URL,
  migrations: { directory: path.join(__dirname, 'src/database/knex-migrations'), loadExtensions: ['.cjs'], tableName: 'knex_migrations' },
};
module.exports = { development: config, test: config, production: config };
