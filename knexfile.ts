// Application connections use src/config/database.ts; the migration CLI uses knexfile.cjs.
import type { Knex } from "knex";
const config: Knex.Config = {
  client: "postgresql", connection: process.env.DATABASE_URL,
  migrations: { directory: "./src/database/knex-migrations", loadExtensions: [".cjs"], tableName: "knex_migrations" }
};
export default { development: config, test: config, production: config };
