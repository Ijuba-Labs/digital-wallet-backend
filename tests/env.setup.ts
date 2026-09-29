Object.assign(process.env, {
  // Server and browser URLs
  PORT: "0",
  NODE_ENV: "test",
  CORS_ORIGIN: "http://localhost:3000",
  HOST: "http://localhost:9000",
  API_PUBLIC_URL: "http://localhost:9001",
  ONBOARDING_WEB_RETURN_URL: "https://app.example.com/onboarding/return",
  ONBOARDING_MOBILE_RETURN_URL: "https://links.example.com/onboarding/return",
  FRONTEND_URL: "http://localhost:3000",
  REDIRECT_URL: "http://localhost:3000/callback",
  LOG_LEVEL: "error",

  // Test-only placeholders. Database tests use the connection returned by
  // createTestDatabase(), which reads Testcontainers' actual host and port.
  DATABASE_URL: "postgresql://test:test@db.invalid:5432/test",
  DB_PORT: "5432",
  POSTGRES_DB: "wallet_bucket_test",
  POSTGRES_USER: "man_hunter",
  POSTGRES_PASSWORD: "pgadmin123",
  DB_HOST: "db.invalid",
  DB_USER: "man_hunter",
  DB_PASSWORD: "pgadmin123",
  TEST_DB_NAME: "wallet_bucket_test",

  // External services and keys are inert test values.
  NGROK_AUTHTOKEN: "test-ngrok-token",
  NGROK_DOMAIN: "test.invalid",
  CLIENT_WALLET_ADDRESS_LOCAL: "https://wallet.test.invalid/local",
  CLIENT_WALLET_ADDRESS_TEST_NET: "https://wallet.test.invalid/test-net",
  PRIVATE_KEY_PATH: "tests/fixtures/test-private-key.pem",
  PRIVATE_KEY_PATH_TEST_NET: "tests/fixtures/test-private-key.pem",
  KEY_ID: "test-key-id",
  KEY_ID_TEST_NET: "test-key-id",
  SESSION_TTL_MS: "15",
  SESSION_PREFIX: "test:onboarding:",
  USER_ACTIVE_PREFIX: "test:user:",
  REDIS_URL: "redis://redis.invalid:6379",
  REDIS_PASSWORD: "test-redis-password",
  REDIS_PORT: "6379",
  REDIS_HOST: "redis.invalid",

  MOCK_USERS_COUNT: "0",
  SEED_USERS: "1",
  JWT_SECRET: "test-only-secret-at-least-16-characters",
  GRANT_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  ACCESS_TOKEN_EXPIRES_IN: "15m",
});
