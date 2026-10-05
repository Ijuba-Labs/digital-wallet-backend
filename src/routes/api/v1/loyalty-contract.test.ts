import { describe, expect, it, jest } from "@jest/globals";
import express, { type RequestHandler, type ErrorRequestHandler } from "express";
import request from "supertest";
import type Redis from "ioredis";
import type { LoyaltyService } from "@/services/loyalty.service";
import { createPaymentRateLimits } from "@/middlewares/rateLimiter.middleware";
import { sendError } from "@/utils/apiResponse";
import { createLoyaltyRouter } from "./loyalty.routes";
function setup() {
  const checkout = jest.fn<LoyaltyService["checkout"]>().mockResolvedValue({ canGenerateBarcode: true } as any);
  const programs = jest.fn<LoyaltyService["programs"]>().mockResolvedValue([]);
  let count = 0;
  const evalRedis = jest.fn<Redis["eval"]>().mockImplementation(async () => [++count, 60000]);
  const limits = createPaymentRateLimits({ eval: evalRedis } as unknown as Redis);
  const auth: RequestHandler = (req, res, next) => {
    if (req.headers.authorization !== "Bearer test") { res.sendStatus(401); return; }
    req.user = { id: "owner" } as typeof req.user; next();
  };
  const app = express(); app.use(express.json());
  app.use("/api/v1", createLoyaltyRouter(auth, { checkout, programs } as unknown as LoyaltyService, limits.loyalty));
  app.use(((error, _req, res, _next) => sendError(res, error.message, error.statusCode ?? 500, error.details)) as ErrorRequestHandler);
  return { app, checkout, evalRedis };
}
describe("loyalty HTTP security", () => {
  it("authenticates before rate limiting or revealing checkout", async () => {
    const t = setup();
    const res = await request(t.app).get("/api/v1/loyalty-cards/id/checkout").expect(401);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(t.checkout).not.toHaveBeenCalled(); expect(t.evalRedis).not.toHaveBeenCalled();
  });
  it("uses authenticated identity and no-store for private checkout", async () => {
    const t = setup();
    const res = await request(t.app).get("/api/v1/loyalty-cards/id/checkout").auth("test", { type: "bearer" }).expect(200);
    expect(t.checkout).toHaveBeenCalledWith("owner", "id");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toEqual({ success: true, data: { canGenerateBarcode: true } });
  });
  it("fails closed on Redis errors and returns retry-after for rate limits", async () => {
    const t = setup(); t.evalRedis.mockRejectedValueOnce(new Error("offline"));
    await request(t.app).get("/api/v1/loyalty-cards/id/checkout").auth("test", { type: "bearer" }).expect(503);
    t.evalRedis.mockResolvedValueOnce([121, 60000]);
    const res = await request(t.app).get("/api/v1/loyalty-cards/id/checkout").auth("test", { type: "bearer" }).expect(429);
    expect(res.headers["retry-after"]).toBe("60"); expect(t.checkout).not.toHaveBeenCalled();
  });
});
