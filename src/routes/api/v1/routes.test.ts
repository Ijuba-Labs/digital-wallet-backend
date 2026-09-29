import { afterEach, describe, expect, it, jest } from "@jest/globals";
import request from "supertest";
import type { Knex } from "knex";
import { createApp } from "@/app";
import { redisClient } from "@/config/redis";
import { OnboardingRepository } from "@/repositories/onboarding.repository";
import { OnboardingService } from "@/services/onboarding.service";
import { GrantRepository } from "@/repositories/grant.repository";
import { getOpenPaymentsClient } from "@/utils/open-payment";
import { logger } from "@/utils/logger";
import { env } from "@/config/env";
import { OnboardingStatus } from "@/constants/onboarding";
import { createTestDatabase } from "../../../../tests/database";
import { createOnboardingConfig } from "@/config/onboarding";

describe("API v1 route wiring", () => {
  // These requests do not query the database; a missing token is rejected first.
  const db = {} as Knex;
  const app = createApp({ db });
  const onboardingService = new OnboardingService({
    onboardingRepository: new OnboardingRepository({ redis: redisClient }),
    grantRepository: new GrantRepository({ db }),
    getOpenPaymentsClient,
    logger,
    config: createOnboardingConfig({ apiPublicUrl: env.API_PUBLIC_URL, allowLocalHttp: true }),
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("mounts the public URL, wallet, and Redis routes", async () => {
    jest.spyOn(redisClient, "ping").mockResolvedValue("PONG");

    const shortened = await request(app)
      .get("/api/v1/urls/shorten")
      .query({ url: "https://example.com" })
      .expect(200);
    expect(shortened.body.data.shortUrl).toContain("/api/v1/urls/");

    await request(app).get("/api/v1/wallet/redirect").expect(200);
    await request(app).get("/api/v1/redis/health").expect(200);
  });

  it("requires a bearer token for onboarding but permits the external callback", async () => {
    const response = await request(app)
      .post("/api/v1/onboarding/start")
      .send({ walletAddressUrl: "https://example.com/wallet" })
      .expect(401);
    expect(response.body.error.message).toBe("Access token is required");

    await request(app).post("/api/v1/onboarding/session-1/consent").expect(401);
    await request(app).get("/api/v1/onboarding/session-1/status").expect(401);
    await request(app).get("/api/v1/onboarding/success").expect(401);

    const callback = await request(app).get("/api/v1/onboarding/callback").expect(400);
    expect(callback.headers.location).toBeUndefined();
    expect(callback.text).toContain("Unable to complete authorization");
  });

  it("does not expose legacy wallet grant creation", async () => {
    await request(app).post("/api/v1/wallet/request/grant")
      .send({ walletAddressUrl: "https://example.com/wallet" }).expect(404);
    await request(app).get("/api/v1/wallet/finalize/grant")
      .query({ transaction_id: "onb_test", interact_ref: "ref", hash: "hash" }).expect(404);
  });

  it("does not expose another user's onboarding session", async () => {
    const now = new Date();
    jest.spyOn(OnboardingRepository.prototype, "findById").mockResolvedValue({
      id: "session-1",
      userId: "owner-1",
      clientId: "api",
      returnUrl: null,
      walletAddressUrl: "https://example.com/wallet",
      status: OnboardingStatus.WALLET_RESOLVED,
      createdAt: now,
      updatedAt: now,
    });

    await expect(onboardingService.getStatus("session-1", "other-user"))
      .rejects.toMatchObject({ statusCode: 404 });
    await expect(onboardingService.requestConsent("session-1", "other-user"))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(await onboardingService.getStatus("session-1", "owner-1"))
      .toMatchObject({ sessionId: "session-1" });
  });

  it("passes the authenticated user through the status route to the service", async () => {
    const db = await createTestDatabase();
    const authenticatedApp = createApp({ db });
    const email = "onboarding-route@example.com";

    try {
      const registration = await request(authenticatedApp)
        .post("/api/v1/auth/register")
        .send({
          first_name: "Route",
          last_name: "Tester",
          email,
          password: "secure-password-123",
          phone_number: "0123456789",
        })
        .expect(201);

      const now = new Date();
      jest.spyOn(OnboardingRepository.prototype, "findById").mockResolvedValue({
        id: "session-1",
        userId: registration.body.data.user.id,
        clientId: "api",
        returnUrl: null,
        walletAddressUrl: "https://example.com/wallet",
        status: OnboardingStatus.WALLET_RESOLVED,
        createdAt: now,
        updatedAt: now,
      });

      const response = await request(authenticatedApp)
        .get("/api/v1/onboarding/session-1/status")
        .set("Authorization", `Bearer ${registration.body.data.accessToken}`)
        .expect(200);

      expect(response.body.data).toMatchObject({
        sessionId: "session-1",
        status: OnboardingStatus.WALLET_RESOLVED,
      });
    } finally {
      await db("users").where({ email }).del();
      await db.destroy();
    }
  });
});
