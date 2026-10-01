import type Redis from "ioredis";
import type { RequestHandler } from "express";
import { createHash } from "node:crypto";
import { AppError } from "@/utils/appError";

export const createPaymentRateLimits = (redis: Redis) => {
  const consume = async (scope: string, identity: string, maximum: number) => {
    const key = `rate:payments:${scope}:${createHash("sha256").update(identity).digest("hex")}`;
    let result: [number, number];
    try {
      result = await redis.eval(`
        local count = redis.call('INCR', KEYS[1])
        if count == 1 then redis.call('PEXPIRE', KEYS[1], 60000) end
        return {count, redis.call('PTTL', KEYS[1])}
      `, 1, key) as [number, number];
    } catch { throw new AppError("Payment rate limiting is unavailable", 503); }
    if (result[0] > maximum) throw new AppError("Too many payment requests", 429, { retryAfter: Math.max(1, Math.ceil(result[1] / 1000)) });
  };
  const middleware = (scope: string, maximum: number, authenticated: boolean): RequestHandler => async (req, res, next) => {
    try {
      await consume(scope, authenticated ? req.user!.id : req.ip ?? req.socket.remoteAddress ?? "unknown", maximum);
      next();
    } catch (error) {
      if (error instanceof AppError && error.statusCode === 429) res.setHeader("Retry-After", String((error.details as { retryAfter: number }).retryAfter));
      next(error);
    }
  };
  const wallet = async (userId: string, walletId: string, idempotencyKey: string) => {
    const identity = createHash("sha256").update(JSON.stringify([userId, walletId])).digest("hex");
    const request = createHash("sha256").update(idempotencyKey).digest("hex");
    // Hash tag keeps the count and admission in the same Redis Cluster slot.
    const key = `rate:payments:wallet:{${identity}}`;
    let result: [number, number];
    try {
      result = await redis.eval(`
        if redis.call('EXISTS', KEYS[2]) == 1 then return {1, redis.call('PTTL', KEYS[1])} end
        local count = tonumber(redis.call('GET', KEYS[1]) or '0')
        local ttl = redis.call('PTTL', KEYS[1])
        if count >= 10 then return {0, ttl} end
        if count == 0 or ttl <= 0 then
          redis.call('SET', KEYS[1], 1, 'PX', 60000)
          ttl = 60000
        else
          redis.call('INCR', KEYS[1])
        end
        redis.call('SET', KEYS[2], '1', 'PX', ttl)
        return {1, ttl}
      `, 2, key, `${key}:admitted:${request}`) as [number, number];
    } catch { throw new AppError("Payment rate limiting is unavailable", 503); }
    if (result[0] !== 1) throw new AppError("Too many payment requests", 429,
      { retryAfter: Math.max(1, Math.ceil(result[1] / 1000)) });
  };
  return { create: middleware("create", 10, true), callback: middleware("callback", 60, false),
    status: middleware("status", 60, true), wallet };
};
export type PaymentRateLimits = ReturnType<typeof createPaymentRateLimits>;
