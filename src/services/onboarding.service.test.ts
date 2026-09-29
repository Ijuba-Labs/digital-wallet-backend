import { describe, expect, it, jest } from "@jest/globals";
import { createHash } from "node:crypto";
import type { AuthenticatedClient, GrantWithAccessToken, PendingGrant, WalletAddress } from "@interledger/open-payments";
import { createOnboardingConfig } from "@/config/onboarding";
import { SESSION_TTL_MS } from "@/constants/onboarding";
import type { OnboardingServiceDependencies, OnboardingSession } from "@/types/onboarding";
import { AppError } from "@/utils/appError";
import { logger } from "@/utils/logger";
import { OnboardingService } from "./onboarding.service";

const wallet: WalletAddress = {
  id: "https://wallet.example/alice", assetCode: "ZAR", assetScale: 2,
  authServer: "https://auth.example", resourceServer: "https://resource.example",
};
const pending: PendingGrant = {
  continue: { uri: "https://auth.example/continue", access_token: { value: "continue-secret" } },
  interact: { redirect: "https://auth.example/consent", finish: "server-nonce" },
};
const finalized: GrantWithAccessToken = {
  continue: pending.continue,
  access_token: { value: "resource-secret", manage: "https://auth.example/manage", access: [] },
};

const setup = () => {
  let session: OnboardingSession | null = null;
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
      .mockImplementation(async () => session),
    transition: jest.fn<OnboardingServiceDependencies["onboardingRepository"]["transition"]>()
      .mockImplementation(async (_id, expected, updates) => {
        if (!session || session.status !== expected) throw new AppError("State changed", 409);
        session = { ...session, ...updates };
        return session;
      }),
  };
  const grants = {
    savePending: jest.fn<OnboardingServiceDependencies["grantRepository"]["savePending"]>().mockResolvedValue(undefined),
    getPending: jest.fn<OnboardingServiceDependencies["grantRepository"]["getPending"]>().mockResolvedValue(pending),
    saveFinalToken: jest.fn<OnboardingServiceDependencies["grantRepository"]["saveFinalToken"]>().mockResolvedValue(undefined),
    getFinalized: jest.fn<OnboardingServiceDependencies["grantRepository"]["getFinalized"]>().mockResolvedValue(undefined),
  };
  const requestGrant = jest.fn<AuthenticatedClient["grant"]["request"]>().mockResolvedValue(pending);
  const continueGrant = jest.fn<AuthenticatedClient["grant"]["continue"]>().mockResolvedValue(finalized);
  const client = {
    walletAddress: { get: jest.fn<AuthenticatedClient["walletAddress"]["get"]>().mockResolvedValue(wallet) },
    grant: { request: requestGrant, continue: continueGrant },
  } as unknown as AuthenticatedClient;
  const service = new OnboardingService({
    onboardingRepository: repository, grantRepository: grants, config, logger,
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
      interaction.clientNonce, interaction.finishNonce, ref, interaction.grantRequestUrl,
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
    expect(t.grants.savePending).toHaveBeenCalledWith(expect.objectContaining({ transactionId: id, userId: "owner", wallet }));
    expect(t.grants.saveFinalToken).toHaveBeenCalledWith({ transactionId: id, grant: finalized, interactRef: "interaction-ref" });
    const status = await t.service.getStatus(id, "owner");
    expect(status).toMatchObject({ status: "COMPLETED", clientId, expiresAt: expect.any(Date) });
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
    expect(t.grants.getPending).not.toHaveBeenCalled();
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
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: { statusCode: 409 } });
    expect(await t.service.handleCallback(id, "interaction-ref", hash)).toMatchObject({ status: "COMPLETED" });
    expect(t.continueGrant).toHaveBeenCalledTimes(1);
    await expect(t.service.handleCallback(id, "different-ref", t.hashFor("different-ref"))).rejects.toMatchObject({ statusCode: 409 });
  });

  it("reports in-progress finalization without calling the provider again", async () => {
    const t = setup();
    const id = await t.start();
    t.setSession({ status: "FINALIZING", callbackInteractRef: "interaction-ref" });
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
    await expect(t.service.handleCallback(id, "interaction-ref", t.hashFor())).rejects.toMatchObject({ statusCode: 502 });
    expect(t.session().status).toBe("FINALIZING");
    t.grants.getFinalized.mockResolvedValue({ interactRef: "interaction-ref", completedAt: new Date() });
    expect(await t.service.getStatus(id, "owner")).toMatchObject({ status: "COMPLETED" });
    expect(await t.service.handleCallback(id, "interaction-ref", t.hashFor())).toMatchObject({ status: "COMPLETED" });
    expect(t.continueGrant).toHaveBeenCalledTimes(1);
  });

  it("marks a rejected provider continuation failed without exposing its error", async () => {
    const t = setup();
    const id = await t.start();
    t.continueGrant.mockRejectedValue(new Error("provider details and secrets"));
    await expect(t.service.handleCallback(id, "interaction-ref", t.hashFor())).rejects.toMatchObject({
      statusCode: 502, message: "Could not complete onboarding; check the session status",
    });
    expect(t.session().status).toBe("FAILED");
    expect(t.grants.saveFinalToken).not.toHaveBeenCalled();
  });

  it("returns success if status polling completes Redis state before the original callback does", async () => {
    const t = setup();
    const id = await t.start();
    t.grants.saveFinalToken.mockImplementation(async () => {
      t.grants.getFinalized.mockResolvedValue({ interactRef: "interaction-ref", completedAt: new Date() });
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
});
