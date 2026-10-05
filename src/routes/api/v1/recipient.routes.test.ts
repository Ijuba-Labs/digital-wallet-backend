import { describe, expect, it, jest } from "@jest/globals";
import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import request from "supertest";
import type Redis from "ioredis";
import { RecipientService } from "@/services/recipient.service";
import { createPaymentRateLimits } from "@/middlewares/rateLimiter.middleware";
import { sendError } from "@/utils/apiResponse";
import { createRecipientRouter } from "./recipient.routes";

const path = "/api/v1/recipients/search";
function setup() {
  const search = jest.fn<RecipientService["search"]>().mockResolvedValue([]);
  let count = 0;
  const evalRedis = jest.fn<Redis["eval"]>().mockImplementation(async () => [++count, 60000]);
  const limits = createPaymentRateLimits({ eval: evalRedis } as unknown as Redis);
  const auth: RequestHandler = (req, res, next) => {
    if (req.headers.authorization !== "Bearer test") { res.sendStatus(401); return; }
    req.user = { id: "requester" } as typeof req.user;
    next();
  };
  const app = express();
  app.use("/api/v1/recipients", createRecipientRouter(auth, limits.recipientSearch, { search } as unknown as RecipientService));
  app.use(((error, _req, res, _next) => sendError(res, error.message, error.statusCode ?? 500)) as ErrorRequestHandler);
  return { app, search, evalRedis };
}

describe("Recipient search HTTP contract", () => {
  it("requires authentication before spending the search budget", async () => {
    const t = setup();
    const res = await request(t.app).get(path).query({ q: "Sipho" }).expect(401);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(t.evalRedis).not.toHaveBeenCalled();
    expect(t.search).not.toHaveBeenCalled();
  });

  it("returns the standard envelope with trimmed query and default limit", async () => {
    const t = setup();
    const recipient = { recipientUserId: "recipient-id", displayName: "Sipho Dlamini" };
    t.search.mockResolvedValue([recipient]);
    const res = await request(t.app).get(path).auth("test", { type: "bearer" }).query({ q: " Sipho " }).expect(200);
    expect(res.body).toEqual({ success: true, data: [recipient] });
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(t.search).toHaveBeenCalledWith("requester", { q: "Sipho", limit: 10 });
    expect(t.evalRedis.mock.calls[0]?.[2]).not.toContain("Sipho");
  });

  it("supports a bounded limit and an empty result", async () => {
    const t = setup();
    const res = await request(t.app).get(path).auth("test", { type: "bearer" }).query({ q: "Nobody", limit: "20" }).expect(200);
    expect(res.body.data).toEqual([]);
    expect(t.search).toHaveBeenCalledWith("requester", { q: "Nobody", limit: 20 });
  });

  it.each([{}, { q: "  " }, { q: "ab" }, { q: "x".repeat(255) }, { q: "a\nb" },
    { q: ["one", "two"] }, { q: "Sipho", limit: "0" }, { q: "Sipho", limit: "21" },
    { q: "Sipho", limit: "1.5" }, { q: "Sipho", limit: "abc" }, { q: "Sipho", offset: "1" }])(
    "rejects malformed parameters %j", async (query) => {
      const t = setup();
      await request(t.app).get(path).auth("test", { type: "bearer" }).query(query).expect(400);
      expect(t.search).not.toHaveBeenCalled();
    });

  it("limits each authenticated user to 30 searches per minute", async () => {
    const t = setup();
    for (let i = 0; i < 30; i++) await request(t.app).get(path).auth("test", { type: "bearer" }).query({ q: "Sipho" }).expect(200);
    const res = await request(t.app).get(path).auth("test", { type: "bearer" }).query({ q: "Sipho" }).expect(429);
    expect(res.headers["retry-after"]).toBe("60");
    expect(t.search).toHaveBeenCalledTimes(30);
  });

  it("fails closed if the rate limiter is unavailable", async () => {
    const t = setup();
    t.evalRedis.mockRejectedValue(new Error("redis unavailable"));
    await request(t.app).get(path).auth("test", { type: "bearer" }).query({ q: "Sipho" }).expect(503);
    expect(t.search).not.toHaveBeenCalled();
  });
});
