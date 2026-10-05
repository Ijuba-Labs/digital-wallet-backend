import { describe, expect, it, jest } from "@jest/globals";
import { createHash } from "node:crypto";
import type { AuthenticatedClient, PendingGrant, WalletAddress } from "@interledger/open-payments";
import { createOnboardingConfig } from "@/config/onboarding";
import { SESSION_TTL_MS } from "@/constants/onboarding";
import type { OnboardingServiceDependencies, OnboardingSession } from "@/types/onboarding";
import { AppError } from "@/utils/appError";
import { logger } from "@/utils/logger";
import { OnboardingService } from "./onboarding.service";
import type { FinalizedOwnership } from "@/types/grant";

const wallet: WalletAddress = {
  id: "https://wallet.example/alice", assetCode: "ZAR", assetScale: 2,
  authServer: "https://auth.example", resourceServer: "https://resource.example",
};
const pending: PendingGrant = {
  continue: { uri: "https://auth.example/continue", access_token: { value: "continue-secret" } },
  interact: { redirect: "https://auth.example/consent", finish: "server-nonce" },
};
const finalized = {
  continue: pending.continue,
  access_token: { value: "resource-secret", manage: "https://auth.example/manage", access: [] },
  subject: { sub_ids: [{ id: wallet.id, format: "uri" as const }] },
};

const setup = () => {
  let session: OnboardingSession | null = null;
  let ownership: FinalizedOwnership | undefined;
  const config = createOnboardingConfig({
    apiPublicUrl: "https://api.example.com",
    webReturnUrl: "https://app.example.com/onboarding/return",
    mobileReturnUrl: "https://links.example.com/onboarding/return",
  });
  const repository: OnboardingServiceDependencies["onboardingRepository"] = {
    save: jest.fn<OnboardingServiceDependencies["onboardingRepository"]["save"]>()
      .mockImplementation(async (value) => { session = value; }),
    findById: jest.fn<OnboardingServiceDependencies["onboardingRepository"]["findById"]>()
      .mockImplementation(async () => session),
    findActiveByUserId: jest.fn<OnboardingServiceDependencies["onboardingRepository"]["findActiveByUserId"]>()
      .mockImplementation(async () => session && !["COMPLETED", "FAILED", "EXPIRED"].includes(session.status) ? session : null),
    transition: jest.fn<OnboardingServiceDependencies["onboardingRepository"]["transition"]>()
      .mockImplementation(async (_id, expected, updates) => {
        if (!session || session.status !== expected) throw new AppError("Onboarding state changed", 409);
        session = { ...session, ...updates };
        return session;
      }),
  };
  const grants = {
    saveOwnership: jest.fn<OnboardingServiceDependencies["grantRepository"]["saveOwnership"]>().mockImplementation(async input => {
      ownership = { userId: input.userId, walletAddressUrl: input.wallet.id, completedAt: new Date(),
        callbackFingerprint: input.callbackFingerprint, clientId: input.clientId, returnUrl: input.returnUrl };
    }),
    getFinalized: jest.fn<OnboardingServiceDependencies["grantRepository"]["getFinalized"]>().mockImplementation(async () => ownership),
  };
  const requestGrant = jest.fn<AuthenticatedClient["grant"]["request"]>().mockResolvedValue(pending);
  const continueGrant = jest.fn<AuthenticatedClient["grant"]["continue"]>().mockResolvedValue(finalized);
  const client = {
    walletAddress: { get: jest.fn<AuthenticatedClient["walletAddress"]["get"]>().mockResolvedValue(wallet) },
    grant: { request: requestGrant, continue: continueGrant },
  } as unknown as AuthenticatedClient;
  const service = new OnboardingService({
    onboardingRepository: repository, grantRepository: grants, config, logger,
    onboardingRequestRepository: { find: async () => undefined, reserve: async record => ({ record, created: true }), remove: async () => undefined },
    getOpenPaymentsClient: async () => client,
  });
  const start = async (clientId: "api" | "web" | "mobile" = "api") => {
    const started = await service.start({ userId: "owner", walletAddressUrl: wallet.id, clientId });
    await service.requestConsent(started.sessionId, "owner");
    return started.sessionId;
  };
  const hashFor = (ref = "interaction-ref") => {
    const interaction = session!.interaction!;
    return createHash("sha256").update([
      interaction.clientNonce, interaction.serverInteractNonce, ref, interaction.grantRequestUrl,
    ].join("\n")).digest("base64");
  };
  return { service, repository, grants, config, requestGrant, continueGrant, start, hashFor,
    session: () => session!, setSession: (updates: Partial<OnboardingSession>) => { session = { ...session!, ...updates }; } };
};

describe("Onboarding callback security", () => {
  it.each(["api", "web", "mobile"] as const)("completes %s onboarding with its saved destination and no public credentials", async (clientId) => {
    const t = setup();
    const id = await t.start(clientId);
    const result = await t.service.handleCallback(id, "interaction-ref", t.hashFor());
    expect(result).toEqual({ sessionId: id, status: "COMPLETED", returnUrl: t.config.returnUrls[clientId] });
    expect(t.grants.saveOwnership).toHaveBeenCalledWith(expect.objectContaining({ transactionId: id, userId: "owner", wallet }));
    const status = await t.service.getStatus(id, "owner");
    expect(status).toMatchObject({ status: "COMPLETED", clientId, expiresAt: null });
    for (const field of ["interaction", "callbackInteractRef", "accessToken", "grantContinueToken", "returnUrl", "redirectUrl"]) {
      expect(JSON.parse(JSON.stringify(status))).not.toHaveProperty(field);
    }
  });

  it("uses a fresh nonce and the public API callback, and reuses pending consent on retry", async () => {
    const a = setup();
    const b = setup();
    const id = await a.start();
    await b.start();
    const finish = a.requestGrant.mock.calls[0]![1].interact!.finish!;
    expect(finish).toMatchObject({ method: "redirect", uri: `https://api.example.com/api/v1/onboarding/callback?session_id=${id}` });
    expect(finish.nonce).toHaveLength(43);
    expect(finish.nonce).not.toBe(b.session().interaction!.clientNonce);
    await a.service.requestConsent(id, "owner");
    expect(a.requestGrant).toHaveBeenCalledTimes(1);
  });

  it("rejects forged proofs without changing state or contacting the provider", async () => {
    const t = setup();
    const id = await t.start();
    const before = t.session();
    await expect(t.service.handleCallback(id, "interaction-ref", "A".repeat(43))).rejects.toMatchObject({ statusCode: 400 });
    await expect(t.service.handleCallback(id, "tampered-ref", t.hashFor())).rejects.toMatchObject({ statusCode: 400 });
    expect(t.session()).toBe(before);
    expect(t.continueGrant).not.toHaveBeenCalled();
    expect(t.grants.saveOwnership).not.toHaveBeenCalled();
  });

  it("rejects expired callbacks and hides sessions from other users", async () => {
    const t = setup();
    const id = await t.start();
    await expect(t.service.getStatus(id, "someone-else")).rejects.toMatchObject({ statusCode: 404 });
    await expect(t.service.requestConsent(id, "someone-else")).rejects.toMatchObject({ statusCode: 404 });
    t.setSession({ createdAt: new Date(Date.now() - SESSION_TTL_MS - 1) });
    await expect(t.service.handleCallback(id, "interaction-ref", t.hashFor())).rejects.toMatchObject({ statusCode: 410 });
    expect(t.continueGrant).not.toHaveBeenCalled();
  });

  it("continues a grant only once for concurrent callbacks and completed retries", async () => {
    const t = setup();
    const id = await t.start();
    const hash = t.hashFor();
    const results = await Promise.allSettled([
      t.service.handleCallback(id, "interaction-ref", hash),
      t.service.handleCallback(id, "interaction-ref", hash),
    ]);
    expect(results.some((result) => result.status === "fulfilled")).toBe(true);
    expect(await t.service.handleCallback(id, "interaction-ref", hash)).toMatchObject({ status: "COMPLETED" });
    expect(t.continueGrant).toHaveBeenCalledTimes(1);
    await expect(t.service.handleCallback(id, "different-ref", hash)).rejects.toMatchObject({ statusCode: 400 });
  });

  it("reports in-progress finalization without calling the provider again", async () => {
    const t = setup();
    const id = await t.start();
    t.setSession({ status: "FINALIZING" });
    expect(await t.service.handleCallback(id, "interaction-ref", t.hashFor())).toMatchObject({ status: "FINALIZING" });
    expect(t.continueGrant).not.toHaveBeenCalled();
  });

  it("recovers a committed grant after Redis completion failed without continuing again", async () => {
    const t = setup();
    const id = await t.start();
    const transition = t.repository.transition;
    let failCompletion = true;
    t.repository.transition = async (sessionId, expected, updates) => {
      if (updates.status === "COMPLETED" && failCompletion) {
        failCompletion = false;
        throw new Error("Redis unavailable");
      }
      return transition(sessionId, expected, updates);
    };
    const hash = t.hashFor();
    expect(await t.service.handleCallback(id, "interaction-ref", hash)).toMatchObject({ status: "COMPLETED" });
    expect(t.session().status).toBe("FINALIZING");
    expect(await t.service.getStatus(id, "owner")).toMatchObject({ status: "COMPLETED" });
    expect(await t.service.handleCallback(id, "interaction-ref", hash)).toMatchObject({ status: "COMPLETED" });
    expect(t.continueGrant).toHaveBeenCalledTimes(1);
  });

  it("marks a rejected provider continuation failed without exposing its error", async () => {
    const t = setup();
    const id = await t.start();
    t.continueGrant.mockRejectedValue(new Error("provider details and secrets"));
    await expect(t.service.handleCallback(id, "interaction-ref", t.hashFor())).rejects.toMatchObject({
      statusCode: 502, message: "Ownership verification failed; check onboarding status",
    });
    expect(t.session().status).toBe("FAILED");
    expect(t.grants.saveOwnership).not.toHaveBeenCalled();
  });

  it("returns success if status polling completes Redis state before the original callback does", async () => {
    const t = setup();
    const id = await t.start();
    const saveOwnership = t.grants.saveOwnership.getMockImplementation()!;
    t.grants.saveOwnership.mockImplementation(async input => {
      await saveOwnership(input);
      expect(await t.service.getStatus(id, "owner")).toMatchObject({ status: "COMPLETED" });
    });
    expect(await t.service.handleCallback(id, "interaction-ref", t.hashFor())).toMatchObject({ status: "COMPLETED" });
    expect(t.continueGrant).toHaveBeenCalledTimes(1);
  });

  it("does not let a start retry change the saved client or wallet", async () => {
    const t = setup();
    const id = await t.start("web");
    expect(await t.service.start({ userId: "owner", walletAddressUrl: wallet.id, clientId: "web" })).toMatchObject({ sessionId: id });
    await expect(t.service.start({ userId: "owner", walletAddressUrl: wallet.id, clientId: "mobile" })).rejects.toMatchObject({ statusCode: 409 });
    await expect(t.service.start({ userId: "owner", walletAddressUrl: "https://other.example/wallet", clientId: "web" })).rejects.toMatchObject({ statusCode: 409 });
  });

  it("falls back to the API page if a destination was removed from configuration", async () => {
    const t = setup();
    const id = await t.start("web");
    t.config.returnUrls = { api: null };
    expect(await t.service.handleCallback(id, "interaction-ref", t.hashFor())).toMatchObject({ returnUrl: null });
  });

  it("supports mobile without an App Link and sends the emulator-reachable callback origin", async () => {
    const t = setup();
    Object.assign(t.config, createOnboardingConfig({ apiPublicUrl: "http://localhost:9002", allowLocalHttp: true }));
    const id = await t.start("mobile");
    expect(t.requestGrant.mock.calls[0]![1].interact!.finish!.uri)
      .toBe(`http://localhost:9002/api/v1/onboarding/callback?session_id=${id}`);
    expect(await t.service.handleCallback(id, "interaction-ref", t.hashFor())).toEqual({ sessionId: id, status: "COMPLETED", returnUrl: null });
  });

  it("finishes on browser refresh after the provider wait period", async () => {
    const t = setup();
    const id = await t.start();
    const hash = t.hashFor();
    t.setSession({ continueAfter: Date.now() + 60_000 });
    expect(await t.service.handleCallback(id, "interaction-ref", hash)).toMatchObject({ status: "FINALIZING" });
    expect(t.continueGrant).not.toHaveBeenCalled();
    t.setSession({ continueAfter: Date.now() - 1 });
    expect(await t.service.handleCallback(id, "interaction-ref", hash)).toMatchObject({ status: "COMPLETED" });
    expect(t.continueGrant).toHaveBeenCalledTimes(1);
  });

  it("retries pending provider continuation without submitting the interaction twice", async () => {
    const t = setup();
    const id = await t.start();
    const hash = t.hashFor();
    t.continueGrant.mockResolvedValueOnce({ continue: pending.continue });
    expect(await t.service.handleCallback(id, "interaction-ref", hash)).toMatchObject({ status: "FINALIZING" });
    expect(t.session().interactionSent).toBe(true);
    t.setSession({ continueAfter: Date.now() - 1 });
    expect(await t.service.handleCallback(id, "interaction-ref", hash)).toMatchObject({ status: "COMPLETED" });
    expect(t.continueGrant.mock.calls[0]![1]).toEqual({ interact_ref: "interaction-ref" });
    expect(t.continueGrant.mock.calls[1]![1]).toBeUndefined();
  });

  it("rejects a verified subject belonging to another wallet", async () => {
    const t = setup();
    const id = await t.start();
    t.continueGrant.mockResolvedValue({ ...finalized, subject: { sub_ids: [{ id: "https://wallet.example/other", format: "uri" }] } });
    await expect(t.service.handleCallback(id, "interaction-ref", t.hashFor())).rejects.toMatchObject({ statusCode: 502 });
    expect(t.grants.saveOwnership).not.toHaveBeenCalled();
  });

  it("cancels only the owner's pending attempt, invalidates its callback, and permits a fresh attempt", async () => {
    const t = setup();
    const id = await t.start();
    const hash = t.hashFor();
    await expect(t.service.cancel(id, "other-user")).rejects.toMatchObject({ statusCode: 404 });
    await t.service.cancel(id, "owner");
    expect(t.session()).toMatchObject({ status: "FAILED", failureReason: "Cancelled by user" });
    expect(t.session().interaction).toBeUndefined();
    expect(t.session().pendingGrant).toBeUndefined();
    await expect(t.service.handleCallback(id, "interaction-ref", hash)).rejects.toMatchObject({ statusCode: 400 });
    expect(t.continueGrant).not.toHaveBeenCalled();
    expect(await t.start()).not.toBe(id);
  });

  it("does not cancel a finalizing or completed authorization", async () => {
    const t = setup();
    const id = await t.start();
    t.setSession({ status: "FINALIZING" });
    await expect(t.service.cancel(id, "owner")).rejects.toMatchObject({ statusCode: 409 });
    t.setSession({ status: "CONSENT_PENDING" });
    await t.service.handleCallback(id, "interaction-ref", t.hashFor());
    await expect(t.service.cancel(id, "owner")).rejects.toMatchObject({ statusCode: 409 });
    await expect(t.service.cancel(id, "other-user")).rejects.toMatchObject({ statusCode: 404 });
  });
});
