/**
 * @file database.ts
 * @description Database connection management, client instantiation, and connection pooling.
 *
 * Best Practices:
 * 1. Initialize your ORM/query builder client (e.g. Prisma, Drizzle, TypeORM, Kysely, or Mongoose).
 * 2. Configure connection pool limits suitable for your infrastructure and concurrency targets.
 * 3. Export connection and disconnection helper functions (e.g. `connectDB()` and `disconnectDB()`).
 * 4. Implement retry strategies and exponential backoff for transient connection errors during startup.
 */
import knex from "knex";
import { PendingGrant } from "@interledger/open-payments";
import knexConfig from "../../knexfile";
import { env } from "./env";

const environment = env.NODE_ENV || 'development';
const config = knexConfig[environment];

const knexClient = knex(config);

export default knexClient;
