/**
 * @file env.ts
 * @description Environment variable parsing, validation, and type-safe exports.
 *
 * Best Practices:
 * 1. Validate `process.env` at startup using a schema validator (e.g. `zod` or `envalid`).
 * 2. Fail fast: crash immediately with a clear message if required environment variables are missing.
 * 3. Provide sensible defaults for local development where appropriate.
 * 4. Export a frozen, strongly-typed `config` object rather than accessing `process.env` arbitrarily across the codebase.
 */
import dotenv from "dotenv";
import { z } from "zod";

// Load variables from .env file into process.env
dotenv.config({ debug: false });
// Define the schema with types and default values
const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().default(5000),
  FRONTEND_URL: z.url(),
  HOST: z.url().default("http://wallet-api:9000"),
  REDIS_URL: z.string().default("redis://shared-redis:6379"),
  REDIS_HOST: z.string().default("shared-redis"),
  DATABASE_URL: z.url("DATABASE_URL must be a valid connection string"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters long"),

  JWT_EXPIRES_IN: z.string().default("1d"),
  CORS_ORIGIN: z.string(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  MOCK_USERS_COUNT: z.string(),
  SEED_USERS: z.coerce.number().int().positive(),
  TEST_DB_NAME: z.string(),
  DB_USER: z.string(),
  DB_PASSWORD: z.string(),
  DB_TEST_PORT: z.coerce.number().default(5433),
  DB_HOST: z.string(),
  ACCESS_TOKEN_EXPIRES_IN: z.string()
});

// Validate process.env against schema
const parseEnv = () => {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error("❌ Invalid environment variables:");
    console.error(JSON.stringify(result.error.flatten().fieldErrors, null, 2));
    process.exit(1); // Stop server immediately
  }

  return result.data;
};

// Export a frozen, immutable config object
const env = Object.freeze(parseEnv());

// Export TypeScript type
type Env = z.infer<typeof envSchema>;

export { env, Env };
