import { env } from "@/config/env";
import type { Knex } from "knex";
// import { env } from "./src/config/env";

// Update with your config settings.

const knexConfig: { [key: string]: Knex.Config } = {
  development: {
    client: "postgresql",
    connection: process.env.DATABASE_URL,
  },

  // test: {
  //   client: "postgresql",
  //   connection: {
  //     host: env.DB_HOST,
  //     port: env.DB_TEST_PORT,
  //     user: env.DB_USER,
  //     password: env.DB_PASSWORD,
  //     database: env.TEST_DB_NAME,
  //   },
  // },

  staging: {
    client: "postgresql",
    connection: {
      database: "my_db",
      user: "username",
      password: "password",
    },
    pool: {
      min: 2,
      max: 10,
    },
    migrations: {
      tableName: "knex_migrations",
    },
  },

  production: {
    client: "postgresql",
    connection: {
      database: "my_db",
      user: "username",
      password: "password",
    },
    pool: {
      min: 2,
      max: 10,
    },
    migrations: {
      tableName: "knex_migrations",
    },
  },
};

export default knexConfig;
