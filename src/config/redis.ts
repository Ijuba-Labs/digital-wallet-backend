import Redis from "ioredis";
import { readFileSync } from "node:fs";
import { env } from "./env";
import { logger } from "@/utils/logger";

const url = new URL(process.env.REDIS_URL || `redis://${env.REDIS_HOST}:${process.env.REDIS_PORT || "6379"}`);
const password = url.password ? decodeURIComponent(url.password) : process.env.REDIS_PASSWORD;
const privateLocal = ["shared-redis", "localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
if (!["redis:", "rediss:"].includes(url.protocol)) throw new Error("Unsupported Redis URL");
if (env.NODE_ENV === "production" && (!password || (!privateLocal && url.protocol !== "rediss:"))) {
  throw new Error("Production Redis requires authentication and TLS for remote hosts");
}
export const redisClient = new Redis({
  host: url.hostname, port: Number(url.port || 6379), username: url.username ? decodeURIComponent(url.username) : undefined,
  password, db: Number(url.pathname.slice(1) || 0),
  ...(url.protocol === "rediss:" ? { tls: { rejectUnauthorized: true,
    ...(process.env.REDIS_CA_FILE ? { ca: readFileSync(process.env.REDIS_CA_FILE) } : {}) } } : {}),
  maxRetriesPerRequest: 2, enableReadyCheck: true, lazyConnect: true, connectTimeout: 5000, commandTimeout: 5000,
  retryStrategy: (times) => Math.min(times * 100, 3000),
});
redisClient.on("error", () => logger.error({ event: "redis_unavailable" }, "Redis connection failed"));
export async function connectRedis() {
  if (redisClient.status === "wait") await redisClient.connect();
  await redisClient.ping();
}
export async function disconnectRedis() { if (redisClient.status !== "end") await redisClient.quit(); }
