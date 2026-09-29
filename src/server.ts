import http from "node:http";
import { env } from "./config/env";
import { logger } from "./utils/logger";
import { connectRedis, disconnectRedis, redisClient } from "./config/redis";
import { createApp } from "./app";
import db from "./config/database";
import { assertEncryptionKeys } from "./utils/encryption-audit";

const server = http.createServer(createApp({ db, redis: redisClient }));
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => process.exit(1), 30000);
  deadline.unref();
  server.close(async () => {
    await disconnectRedis().catch(() => {});
    await db.destroy();
    clearTimeout(deadline);
  });
}
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => { void shutdown(); });
process.on("uncaughtException", () => { logger.fatal({ event: "uncaught_exception" }, "API process failed"); process.exit(1); });
process.on("unhandledRejection", () => { logger.fatal({ event: "unhandled_rejection" }, "API process failed"); process.exit(1); });
try {
  await assertEncryptionKeys(db);
  await connectRedis();
  server.listen(env.PORT, () => logger.info({ port: env.PORT }, "API listening"));
} catch {
  logger.fatal({ event: "api_start_failed" }, "API startup failed; check database migrations, keyring, and Redis");
  await disconnectRedis().catch(() => {}); await db.destroy(); process.exitCode = 1;
}
