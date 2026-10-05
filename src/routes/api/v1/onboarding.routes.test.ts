import { describe, expect, it, jest } from "@jest/globals";
import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import request from "supertest";
import { OnboardingController } from "@/controllers/onboarding.controller";
import type { OnboardingService } from "@/services/onboarding.service";
import { AppError } from "@/utils/appError";
import { createOnboardingRouter } from "./onboarding.routes";

const setup = () => {
  const service = {
    start: jest.fn<OnboardingService["start"]>(),
    requestConsent: jest.fn<OnboardingService["requestConsent"]>(),
    getStatus: jest.fn<OnboardingService["getStatus"]>(),
    cancel: jest.fn<OnboardingService["cancel"]>().mockResolvedValue(undefined),
    handleCallback: jest.fn<OnboardingService["handleCallback"]>().mockResolvedValue({
      sessionId: "onb_example", status: "COMPLETED", returnUrl: null,
    }),
  };
  const requireAuth = jest.fn<RequestHandler>().mockImplementation((_req, res) => { res.sendStatus(401); });
  const app = express();
  app.use(express.json());
  const callbackLimit: RequestHandler = (_req, _res, next) => next();
  app.use("/api/v1/onboarding", createOnboardingRouter(requireAuth, new OnboardingController(service), { callback: callbackLimit } as any));
  app.use(((error, _req, res, _next) => {
    res.status(error.statusCode ?? 500).json({ error: error.message });
  }) as ErrorRequestHandler);
  return { app, service, requireAuth };
};
const callback = "/api/v1/onboarding/callback";
const query = { session_id: "onb_example", interact_ref: "ref", hash: "proof" };

describe("Onboarding callback HTTP contract", () => {
  it("serves an API completion page without a frontend or bearer token", async () => {
    const t = setup();
    const response = await request(t.app).get(callback).query(query).expect(200);
    expect(response.text).toContain("Authorization received");
    expect(response.headers.location).toBeUndefined();
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(t.requireAuth).not.toHaveBeenCalled();
    expect(t.service.handleCallback).toHaveBeenCalledWith("onb_example", "ref", "proof");
  });

  it.each(["https://app.example.com/onboarding/return", "https://links.example.com/onboarding/return"])(
    "redirects only to the stored destination %s, with only the session ID", async (returnUrl) => {
      const t = setup();
      t.service.handleCallback.mockResolvedValue({ sessionId: "onb_example", status: "COMPLETED", returnUrl });
      const response = await request(t.app).get(callback)
        .query({ ...query, returnUrl: "https://attacker.example/steal", clientId: "mobile" }).expect(302);
      expect(response.headers.location).toBe(`${returnUrl}?session_id=onb_example`);
      expect(t.service.handleCallback).toHaveBeenCalledWith("onb_example", "ref", "proof");
    },
  );

  it("returns 202 while a concurrent callback is finalizing", async () => {
    const t = setup();
    t.service.handleCallback.mockResolvedValue({ sessionId: "onb_example", status: "FINALIZING", returnUrl: null });
    const response = await request(t.app).get(callback).query(query).expect(202);
    expect(response.headers["retry-after"]).toBe("2");
    expect(response.headers.refresh).toBe("2");
    expect(response.text).toContain("refresh automatically");
    expect(response.text).not.toContain("proof");
  });

  it.each([400, 404, 409, 410, 502])("does not redirect or reflect details when a callback fails with %i", async (statusCode) => {
    const t = setup();
    t.service.handleCallback.mockRejectedValue(new AppError("secret-provider-details", statusCode));
    const response = await request(t.app).get(callback).query(query).expect(statusCode);
    expect(response.text).toContain("Unable to complete authorization");
    expect(response.text).not.toContain("secret-provider-details");
    expect(response.headers.location).toBeUndefined();
    expect(response.headers.refresh).toBeUndefined();
  });

  it("rejects a missing hash before calling the service", async () => {
    const t = setup();
    await request(t.app).get(callback).query({ session_id: "onb_example", interact_ref: "ref" }).expect(400);
    expect(t.service.handleCallback).not.toHaveBeenCalled();
  });

  it("keeps start, consent, and status behind authentication", async () => {
    const t = setup();
    await request(t.app).post("/api/v1/onboarding/start").send({}).expect(401);
    await request(t.app).post("/api/v1/onboarding/onb_example/consent").expect(401);
    await request(t.app).get("/api/v1/onboarding/onb_example/status").expect(401);
    await request(t.app).delete("/api/v1/onboarding/onb_example").expect(401);
    expect(t.service.start).not.toHaveBeenCalled();
    expect(t.service.requestConsent).not.toHaveBeenCalled();
    expect(t.service.getStatus).not.toHaveBeenCalled();
    expect(t.service.cancel).not.toHaveBeenCalled();
  });

  it("defaults to API mode and rejects arbitrary return URLs in start requests", async () => {
    const t = setup();
    t.requireAuth.mockImplementation((req, _res, next) => {
      req.user = { id: "owner", email: "owner@example.com" };
      next();
    });
    t.service.start.mockResolvedValue({
      sessionId: "onb_example", status: "WALLET_RESOLVED", clientId: "api", expiresAt: new Date(),
    });
    await request(t.app).post("/api/v1/onboarding/start").send({ walletAddressUrl: "https://wallet.example/alice" }).expect(201);
    expect(t.service.start).toHaveBeenCalledWith({ userId: "owner", walletAddressUrl: "https://wallet.example/alice", clientId: "api" });
    t.service.start.mockClear();
    await request(t.app).post("/api/v1/onboarding/start")
      .send({ walletAddressUrl: "https://wallet.example/alice", returnUrl: "https://attacker.example" }).expect(400);
    expect(t.service.start).not.toHaveBeenCalled();
  });

  it("passes the authenticated owner to mobile start, polling, and cancellation", async () => {
    const t = setup();
    t.requireAuth.mockImplementation((req, _res, next) => { req.user = { id: "owner", email: "owner@example.com" }; next(); });
    t.service.start.mockResolvedValue({ sessionId: "onb_example", status: "WALLET_RESOLVED", clientId: "mobile", expiresAt: new Date() });
    await request(t.app).post("/api/v1/onboarding/start").send({ walletAddressUrl: "https://wallet.example/alice", clientId: "mobile" }).expect(201);
    expect(t.service.start).toHaveBeenCalledWith(expect.objectContaining({ userId: "owner", clientId: "mobile" }));
    await request(t.app).get("/api/v1/onboarding/onb_example/status").expect(200);
    expect(t.service.getStatus).toHaveBeenCalledWith("onb_example", "owner");
    await request(t.app).delete("/api/v1/onboarding/onb_example").expect(204);
    expect(t.service.cancel).toHaveBeenCalledWith("onb_example", "owner");
  });
});
