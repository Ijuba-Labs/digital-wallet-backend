import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { SESSION_TTL_MS } from "@/constants/onboarding";
import type { OnboardingSession } from "@/types/onboarding";
import { OnboardingRepository } from "./onboarding.repository";

describe("Onboarding Redis transitions", () => {
  let container: StartedTestContainer | undefined;
  let redis: Redis | undefined;
  let repository: OnboardingRepository;

  beforeAll(async () => {
    container = await new GenericContainer("redis:8").withExposedPorts(6379).start();
    redis = new Redis({ host: container.getHost(), port: container.getMappedPort(6379), maxRetriesPerRequest: 1 });
    repository = new OnboardingRepository({ redis });
    await redis.ping();
  }, 120_000);

  afterAll(async () => {
    try { if (redis) await redis.quit(); } finally { await container?.stop(); }
  });

  const createSession = (): OnboardingSession => ({
    id: `onb_${randomUUID()}`, userId: randomUUID(), walletAddressUrl: "https://wallet.example/alice",
    clientId: "api", returnUrl: null, status: "CONSENT_PENDING", createdAt: new Date(), updatedAt: new Date(),
  });

  it("allows only one concurrent claim and preserves the original expiry", async () => {
    const session = createSession();
    await repository.save(session);
    const key = `${process.env.SESSION_PREFIX}${session.id}`;
    await redis!.pexpire(key, 60_000);
    const beforeTtl = await redis!.pttl(key);
    const results = await Promise.allSettled([
      repository.transition(session.id, "CONSENT_PENDING", { status: "FINALIZING", callbackInteractRef: "ref-one" }),
      repository.transition(session.id, "CONSENT_PENDING", { status: "FINALIZING", callbackInteractRef: "ref-two" }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: { statusCode: 409 } });
    const afterTtl = await redis!.pttl(key);
    expect(afterTtl).toBeGreaterThan(0);
    expect(afterTtl).toBeLessThanOrEqual(beforeTtl);
    const winner = results.find((result) => result.status === "fulfilled")!;
    expect(await repository.findById(session.id)).toEqual(winner.value);
  });

  it("rejects expired sessions at the atomic claim", async () => {
    const session = createSession();
    session.createdAt = new Date(Date.now() - SESSION_TTL_MS - 1);
    await repository.save(session);
    await expect(repository.transition(session.id, "CONSENT_PENDING", { status: "FINALIZING" }))
      .rejects.toMatchObject({ statusCode: 410 });
    expect((await repository.findById(session.id))?.status).toBe("CONSENT_PENDING");
    expect(await repository.findActiveByUserId(session.userId)).toBeNull();
  });

  it("does not resurrect missing sessions", async () => {
    await expect(repository.transition("missing", "CONSENT_PENDING", { status: "FINALIZING" }))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(await repository.findById("missing")).toBeNull();
  });

  it("allows a new onboarding session after the previous one completes", async () => {
    const session = createSession();
    await repository.save(session);
    expect((await repository.findActiveByUserId(session.userId))?.id).toBe(session.id);
    await repository.transition(session.id, "CONSENT_PENDING", { status: "FINALIZING" });
    await repository.transition(session.id, "FINALIZING", { status: "COMPLETED" });
    expect(await repository.findActiveByUserId(session.userId)).toBeNull();
  });
});
