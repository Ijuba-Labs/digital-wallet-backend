import knex from "knex";
import { env } from "./env";
const knexClient = knex({ client: "postgresql", connection: env.DATABASE_URL, pool: { min: 0, max: 10 } });
export default knexClient;
