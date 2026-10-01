import { createHash, randomUUID } from "node:crypto";
import { isPendingGrant, isFinalizedGrantWithSubject, OpenPaymentsClientError } from "@interledger/open-payments";
import { AppError } from "@/utils/appError";
import { SESSION_TTL_MS } from "@/constants/onboarding";
import type { OnboardingServiceDependencies, OnboardingSession, OnboardingStartInput, OnboardingStatusResponse, OnboardingCallbackResult } from "@/types/onboarding";
import type { FinalizedOwnership } from "@/types/grant";
import { callbackFingerprint, createInteractionNonce, verifyInteractionHash } from "@/utils/grant-interaction";
import { getOnboardingReturnUrl } from "@/config/onboarding";
import { validateProviderUrl, validateWalletAddress } from "@/utils/provider-url";
import type { OnboardingRequestRecord } from "@/repositories/onboarding-request.repository";
import { idempotencyKeySchema } from "@/validators/transfer.validator";

export class OnboardingService {
  constructor(private readonly deps: OnboardingServiceDependencies) {}
  async start(input: OnboardingStartInput): Promise<OnboardingStatusResponse> {
    input = { ...input, walletAddressUrl: validateWalletAddress(input.walletAddressUrl) };
    const clientId = input.clientId ?? "api";
    const returnUrl = getOnboardingReturnUrl(this.deps.config, clientId);
    const requestHash = createHash("sha256").update(JSON.stringify([input.walletAddressUrl, clientId, returnUrl])).digest("hex");
    let keyHash: string | undefined;
    if (input.idempotencyKey !== undefined) {
      if (!idempotencyKeySchema.safeParse(input.idempotencyKey).success) throw new AppError("Invalid Idempotency-Key", 400);
      keyHash = createHash("sha256").update(input.idempotencyKey).digest("hex");
      const request = await this.deps.onboardingRequestRepository.find(input.userId, keyHash);
      if (request) return this.replayStart(request, requestHash, input.userId);
    }
    const existing = await this.deps.onboardingRepository.findActiveByUserId(input.userId);
    if (existing) {
      if (keyHash) {
        const concurrent = await this.deps.onboardingRequestRepository.find(input.userId, keyHash);
        if (concurrent) return this.replayStart(concurrent, requestHash, input.userId);
        throw new AppError("An onboarding session is already active; reuse its Idempotency-Key", 409);
      }
      if (existing.walletAddressUrl !== input.walletAddressUrl || existing.clientId !== clientId || existing.returnUrl !== returnUrl) throw new AppError("An onboarding session is already active", 409);
      return this.response(existing);
    }
    validateProviderUrl(input.walletAddressUrl);
    const now = new Date();
    const session: OnboardingSession = { id: `onb_${randomUUID()}`, userId: input.userId, walletAddressUrl: input.walletAddressUrl,
      clientId, returnUrl, status: "PENDING", createdAt: now, updatedAt: now };
    let reservation: OnboardingRequestRecord | undefined;
    if (keyHash) {
      const result = await this.deps.onboardingRequestRepository.reserve({ user_id: input.userId, key_hash: keyHash,
        request_hash: requestHash, session_id: session.id, session_created_at: now });
      if (!result.created) return this.replayStart(result.record, requestHash, input.userId);
      reservation = result.record;
    }
    try { await this.deps.onboardingRepository.save(session); }
    catch (error) {
      // Only a confirmed admission conflict can discard the new reservation.
      // An uncertain Redis acknowledgement retains its stable session identity.
      if (reservation && error instanceof AppError && error.statusCode === 409) {
        await this.deps.onboardingRequestRepository.remove(reservation);
      }
      throw error;
    }
    let phase: "client_setup" | "wallet_lookup" | "provider_url_validation" | "session_persistence" = "client_setup";
    try {
      const client = await this.deps.getOpenPaymentsClient();
      phase = "wallet_lookup";
      const resolved = await client.walletAddress.get({ url: input.walletAddressUrl });
      phase = "provider_url_validation";
      for (const url of [resolved.id, resolved.authServer, resolved.resourceServer]) validateProviderUrl(url);
      const wallet = { id: validateWalletAddress(resolved.id), assetCode: resolved.assetCode, assetScale: resolved.assetScale,
        authServer: resolved.authServer, resourceServer: resolved.resourceServer, publicName: resolved.publicName };
      phase = "session_persistence";
      return { ...this.response(await this.deps.onboardingRepository.transition(session.id, "PENDING", { status: "WALLET_RESOLVED", wallet })),
        ...(keyHash ? { idempotencyReplayed: false } : {}) };
    } catch (error) {
      const nodeCode = error instanceof Error && "code" in error ? error.code : undefined;
      const reason = phase === "client_setup" && ["ENOENT", "EACCES", "EPERM"].includes(String(nodeCode))
        ? "private_key_unavailable"
        : error instanceof OpenPaymentsClientError ? "provider_rejected_request"
          : phase === "wallet_lookup" && ["ENOTFOUND", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT"].includes(String(nodeCode))
            ? "provider_network_error"
            : phase === "provider_url_validation" ? "provider_url_rejected" : `${phase}_failed`;
      this.deps.logger.warn({ event: "onboarding_wallet_resolution_failed", sessionId: session.id, phase, reason,
        ...(error instanceof OpenPaymentsClientError && Number.isInteger(error.status) ? { providerStatus: error.status } : {}) },
      "Could not resolve wallet");
      await this.fail(session, "Could not resolve wallet");
      throw new AppError("Could not resolve wallet", 422);
    }
  }
  private async replayStart(record: OnboardingRequestRecord, requestHash: string, userId: string): Promise<OnboardingStatusResponse> {
    if (record.request_hash !== requestHash) throw new AppError("Idempotency-Key belongs to a different onboarding request", 409);
    try { return { ...await this.getStatus(record.session_id, userId), idempotencyReplayed: true }; }
    catch (error) {
      if (error instanceof AppError && error.statusCode === 404) {
        if (record.session_created_at.getTime() + SESSION_TTL_MS <= Date.now()) throw new AppError("Onboarding expired; start with a new Idempotency-Key", 410);
        throw new AppError("Onboarding is initializing; retry with the same Idempotency-Key", 503,
          { sessionId: record.session_id, retryAfter: 2 });
      }
      throw error;
    }
  }
  async requestConsent(id: string, userId: string): Promise<OnboardingStatusResponse> {
    const s = await this.validSession(id, userId);
    if (s.status === "CONSENT_PENDING") return this.response(s);
    if (s.status !== "WALLET_RESOLVED") throw new AppError("Session is not ready for consent", 409);
    const claimed = await this.deps.onboardingRepository.transition(id, s.status, { status: "CONSENT_REQUESTING" });
    try {
      const client = await this.deps.getOpenPaymentsClient();
      const callback = new URL("/api/v1/onboarding/callback", this.deps.config.apiPublicUrl);
      callback.searchParams.set("session_id", id);
      const clientNonce = createInteractionNonce();
      // The SDK sends new URL(url).href; use that exact URI in the GNAP hash.
      const grantRequestUrl = new URL(s.wallet!.authServer).href;
      const pendingGrant = await client.grant.request({ url: grantRequestUrl }, {
        subject: { sub_ids: [{ id: s.wallet!.id, format: "uri" }] },
        interact: { start: ["redirect"], finish: { method: "redirect", uri: callback.href, nonce: clientNonce } },
      });
      if (!isPendingGrant(pendingGrant)) throw new AppError("Expected interactive ownership verification", 502);
      validateProviderUrl(pendingGrant.continue.uri); validateProviderUrl(pendingGrant.interact.redirect);
      return this.response(await this.deps.onboardingRepository.transition(id, "CONSENT_REQUESTING", {
        status: "CONSENT_PENDING", pendingGrant, redirectUrl: pendingGrant.interact.redirect,
        continueAfter: Date.now() + (pendingGrant.continue.wait ?? 0) * 1000,
        interaction: { clientNonce, serverInteractNonce: pendingGrant.interact.finish, grantRequestUrl },
      }));
    } catch {
      await this.fail(claimed, "Failed to request consent"); throw new AppError("Failed to request consent", 502);
    }
  }
  async handleCallback(id: string, interactRef: string, hash: string): Promise<OnboardingCallbackResult> {
    const fingerprint = callbackFingerprint(interactRef, hash);
    const durable = await this.deps.grantRepository.getFinalized(id);
    if (durable) {
      if (durable.callbackFingerprint !== fingerprint) throw new AppError("Callback proof mismatch", 400);
      return this.completedCallback(id, durable);
    }
    const s = await this.deps.onboardingRepository.findById(id);
    if (!s || Date.now() >= s.createdAt.getTime() + SESSION_TTL_MS) throw new AppError("Onboarding expired", 410);
    if (!s.interaction) throw new AppError("Onboarding interaction state unavailable", 400);
    if (!verifyInteractionHash(s.interaction, interactRef, hash)) throw new AppError("Invalid onboarding callback", 400);
    if (s.callbackFingerprint && s.callbackFingerprint !== fingerprint) throw new AppError("Interaction consumed", 409);
    if (s.status === "FINALIZING") return { sessionId: id, status: "FINALIZING", returnUrl: null };
    if (s.status !== "CONSENT_PENDING" || !s.pendingGrant) throw new AppError("Consent unavailable", 409);
    if (Date.now() < (s.continueAfter ?? 0)) return { sessionId: id, status: "FINALIZING", returnUrl: null };
    const claimed = await this.deps.onboardingRepository.transition(id, "CONSENT_PENDING", { status: "FINALIZING", callbackFingerprint: fingerprint });
    try {
      const client = await this.deps.getOpenPaymentsClient();
      const grant = await client.grant.continue({ url: s.pendingGrant.continue.uri, accessToken: s.pendingGrant.continue.access_token.value },
        s.interactionSent ? undefined : { interact_ref: interactRef });
      if (!isFinalizedGrantWithSubject(grant)) {
        if (!grant.continue) throw new AppError("Ownership verification missing", 502);
        validateProviderUrl(grant.continue.uri);
        await this.deps.onboardingRepository.transition(id, "FINALIZING", { status: "CONSENT_PENDING", interactionSent: true,
          pendingGrant: { ...s.pendingGrant, continue: grant.continue }, continueAfter: Date.now() + Math.max(1, grant.continue.wait ?? 5) * 1000 });
        return { sessionId: id, status: "FINALIZING", returnUrl: null };
      }
      if (!grant.subject.sub_ids.some((subject) => subject.format === "uri" && subject.id === s.wallet!.id)) throw new AppError("Verified subject does not match wallet", 502);
      await this.deps.grantRepository.saveOwnership({ transactionId: id, userId: s.userId, wallet: s.wallet!,
        callbackFingerprint: fingerprint, clientId: s.clientId, returnUrl: s.returnUrl });
      // Durable success wins even if Redis cleanup fails.
      try { await this.deps.onboardingRepository.transition(id, "FINALIZING", { status: "COMPLETED", completedAt: new Date(),
        pendingGrant: undefined, interaction: undefined, redirectUrl: undefined }); } catch { /* Recover from PostgreSQL. */ }
      return this.completedCallback(id, (await this.deps.grantRepository.getFinalized(id))!);
    } catch (error) {
      const committed = await this.deps.grantRepository.getFinalized(id);
      if (committed?.callbackFingerprint === fingerprint) return this.completedCallback(id, committed);
      await this.fail(claimed, "Ownership verification failed");
      if (error instanceof AppError && error.statusCode === 409) throw error;
      throw new AppError("Ownership verification failed; check onboarding status", 502);
    }
  }
  async getStatus(id: string, userId: string): Promise<OnboardingStatusResponse> {
    const durable = await this.deps.grantRepository.getFinalized(id);
    if (durable) {
      if (durable.userId !== userId) throw new AppError("Onboarding not found", 404);
      return { sessionId: id, status: "COMPLETED", linkedAt: durable.completedAt, clientId: durable.clientId, expiresAt: null };
    }
    let s = await this.validSession(id, userId);
    if (["FINALIZING", "CONSENT_REQUESTING"].includes(s.status) && Date.now() - s.updatedAt.getTime() > 60000) {
      s = await this.deps.onboardingRepository.transition(id, s.status, { status: "FAILED", failureReason: "Authorization interrupted", pendingGrant: undefined, interaction: undefined, redirectUrl: undefined });
    }
    return this.response(s);
  }
  private completedCallback(id: string, durable: FinalizedOwnership): OnboardingCallbackResult {
    return { sessionId: id, status: "COMPLETED", returnUrl: this.deps.config.returnUrls[durable.clientId] === durable.returnUrl ? durable.returnUrl : null };
  }
  private async validSession(id: string, userId: string) {
    const s = await this.deps.onboardingRepository.findById(id);
    if (!s || s.userId !== userId) throw new AppError("Onboarding not found", 404);
    if (Date.now() >= s.createdAt.getTime() + SESSION_TTL_MS) throw new AppError("Onboarding expired", 410);
    return s;
  }
  private response(s: OnboardingSession): OnboardingStatusResponse {
    return { sessionId: s.id, status: s.status, wallet: s.wallet, redirectUrl: s.redirectUrl, linkedAt: s.completedAt,
      clientId: s.clientId, expiresAt: s.status === "COMPLETED" ? null : new Date(s.createdAt.getTime() + SESSION_TTL_MS) };
  }
  private async fail(s: OnboardingSession, reason: string) {
    try { await this.deps.onboardingRepository.transition(s.id, s.status, { status: "FAILED", failureReason: reason,
      pendingGrant: undefined, interaction: undefined, redirectUrl: undefined }); }
    catch { this.deps.logger.warn({ sessionId: s.id }, "Could not update failed onboarding session"); }
  }
}
