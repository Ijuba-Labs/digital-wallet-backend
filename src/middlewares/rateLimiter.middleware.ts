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
  return { create: middleware("create", 10, true), callback: middleware("callback", 60, false),
    status: middleware("status", 60, true), wallet: (id: string) => consume("wallet", id, 10) };
};
export type PaymentRateLimits = ReturnType<typeof createPaymentRateLimits>;
