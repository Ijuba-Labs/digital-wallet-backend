import { createHash, randomUUID } from "node:crypto";
import {
  isFinalizedGrantWithAccessToken, isPendingGrant, OpenPaymentsClientError,
  type AccessToken, type OutgoingPayment, type WalletAddress
} from "@interledger/open-payments";
import type { getOpenPaymentsClient } from "@/utils/open-payment";
import type {
  CreateTransferInput, PaymentAmount, PaymentSessionRepositoryInterface, TransferRecord,
  TransferRepositoryInterface, TransferStatus, TransferUpdates, TransferWallet, WalletSnapshot
} from "@/types/transfer";
import { AppError } from "@/utils/appError";
import { callbackFingerprint, createInteractionNonce, verifyInteractionHash } from "@/utils/grant-interaction";
import { validateProviderUrl, validateWalletAddress } from "@/utils/provider-url";
import { PaymentTokenService } from "./payment-token.service";
import { logger } from "@/utils/logger";

const SESSION_TTL = 15 * 60 * 1000;
const terminal = (t: TransferRecord) => ["COMPLETED", "FAILED", "EXPIRED"].includes(t.status);
const sameAsset = (a: PaymentAmount, b: PaymentAmount) => a.assetCode === b.assetCode && a.assetScale === b.assetScale;
const sameAmount = (a: PaymentAmount, b: PaymentAmount) => sameAsset(a, b) && BigInt(a.value) === BigInt(b.value);
type Token = AccessToken["access_token"];

export class TransferService {
  private readonly tokens: PaymentTokenService;
  constructor(private readonly deps: {
    transferRepository: TransferRepositoryInterface;
    paymentSessionRepository: PaymentSessionRepositoryInterface;
    getOpenPaymentsClient: typeof getOpenPaymentsClient;
    apiPublicUrl: string;
    consumeWalletLimit?: (userId: string, walletId: string, idempotencyKey: string) => Promise<void>;
  }) { this.tokens = new PaymentTokenService(deps.transferRepository, deps.getOpenPaymentsClient); }
  private get repo() { return this.deps.transferRepository; }

  async create(userId: string, input: CreateTransferInput, idempotencyKey: string) {
    if (userId === input.recipientUserId) throw new AppError("Recipient must be another user", 400);
    const hash = createHash("sha256").update(JSON.stringify([input.recipientUserId, input.senderWalletId ?? null,
    input.amount, input.description ?? null])).digest("hex");
    const existing = await this.repo.findByIdempotencyKey(userId, idempotencyKey);
    if (existing) return this.replay(existing, hash, userId);
    const sender = await this.repo.findWallet(userId, input.senderWalletId);
    const recipient = await this.repo.findWallet(input.recipientUserId);
    if (!sender || !recipient) throw new AppError("Both users require active, verified linked wallets", 400);
    await this.deps.consumeWalletLimit?.(userId, sender.id, idempotencyKey);
    const client = await this.deps.getOpenPaymentsClient();
    let senderWallet: WalletSnapshot;
    let recipientWallet: WalletSnapshot;
    try {
      senderWallet = this.snapshot(sender, await client.walletAddress.get({ url: sender.walletAddressUrl }));
      recipientWallet = this.snapshot(recipient, await client.walletAddress.get({ url: recipient.walletAddressUrl }));
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("Could not resolve linked wallets", 502);
    }
    if (senderWallet.id === recipientWallet.id) throw new AppError("Sender and recipient wallets must differ", 400);
    const reserved = await this.repo.reserve({
      id: randomUUID(), sender_user_id: userId, recipient_user_id: input.recipientUserId,
      sender_wallet_id: sender.id, recipient_wallet_id: recipient.id, sender_wallet: senderWallet, recipient_wallet: recipientWallet,
      request_hash: hash, idempotency_key: idempotencyKey, description: input.description ?? null,
      debit_amount: { value: input.amount, assetCode: senderWallet.assetCode, assetScale: senderWallet.assetScale },
      expires_at: new Date(Date.now() + SESSION_TTL)
    });
    if (!reserved.created) return this.replay(reserved.transfer, hash, userId);
    const owner = randomUUID();
    const claimed = await this.repo.claim(reserved.transfer.id, owner);
    if (!claimed) return this.replay(await this.load(reserved.transfer.id), hash, userId);
    const prepared = await this.leased(claimed, owner, async (initial) => {
      let t = initial;
      try {
        const grant = await client.grant.request({ url: recipientWallet.authServer }, {
          access_token: { access: [{ type: "incoming-payment", identifier: recipientWallet.id, actions: ["create"] }] },
        });
        if (!isFinalizedGrantWithAccessToken(grant)) throw new AppError("Provider requires unsupported incoming consent", 422);
        await this.tokens.store(t.id, owner, "incoming-create", grant.access_token, (token) => this.checkIncomingCreate(t, token));
        const createToken = await this.tokens.get(t.id, owner, "incoming-create", (token) => this.checkIncomingCreate(t, token));
        await this.alive(t.id, owner);
        await this.tokens.assertUsable(t.id, "incoming-create");
        const incoming = await client.incomingPayment.create({ url: recipientWallet.resourceServer, accessToken: createToken }, {
          walletAddress: recipientWallet.id, expiresAt: t.expires_at.toISOString(), metadata: { transferId: t.id },
        });
        validateProviderUrl(incoming.id);
        const incomingExpiry = incoming.expiresAt ? new Date(incoming.expiresAt) : null;
        if (incomingExpiry && !Number.isFinite(incomingExpiry.getTime())) throw new AppError("Invalid incoming expiry", 502);
        t = await this.update(t, owner, {
          incoming_payment_url: incoming.id,
          incoming_expires_at: incomingExpiry,
          incoming_completed_at: incoming.completed ? new Date() : null,
        });
        if (validateWalletAddress(incoming.walletAddress) !== recipientWallet.id) throw new AppError("Incoming payment wallet mismatch", 502);
        await this.acquireIncoming(t, owner);
        await this.tokens.cleanup(t.id, owner, "incoming-create");
        const quoteGrant = await client.grant.request({ url: senderWallet.authServer }, {
          access_token: { access: [{ type: "quote", actions: ["create"] }] },
        });
        if (!isFinalizedGrantWithAccessToken(quoteGrant)) throw new AppError("Provider requires unsupported quote consent", 422);
        await this.tokens.store(t.id, owner, "quote", quoteGrant.access_token, (token) => this.checkQuote(token));
        const quoteToken = await this.tokens.get(t.id, owner, "quote", (token) => this.checkQuote(token));
        await this.alive(t.id, owner);
        await this.tokens.assertUsable(t.id, "quote");
        const quote = await client.quote.create({ url: senderWallet.resourceServer, accessToken: quoteToken }, {
          walletAddress: senderWallet.id, receiver: incoming.id, method: "ilp", debitAmount: t.debit_amount,
        });
        validateProviderUrl(quote.id);
        if (quote.walletAddress !== senderWallet.id || quote.receiver !== incoming.id || !sameAmount(quote.debitAmount, t.debit_amount) ||
          !sameAsset(quote.receiveAmount, { ...t.debit_amount, assetCode: recipientWallet.assetCode, assetScale: recipientWallet.assetScale }) ||
          BigInt(quote.receiveAmount.value) <= 0n) throw new AppError("Provider quote mismatch", 502);
        const expiresAt = Math.min(t.expires_at.getTime(), quote.expiresAt ? Date.parse(quote.expiresAt) : Infinity,
          t.incoming_expires_at?.getTime() ?? Infinity);
        if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new AppError("Quote expired", 410);
        t = await this.update(t, owner, {
          quote_url: quote.id, receive_amount: quote.receiveAmount,
          quote_expires_at: quote.expiresAt ? new Date(quote.expiresAt) : null, expires_at: new Date(expiresAt)
        });
        await this.tokens.cleanup(t.id, owner, "quote");
        const clientNonce = createInteractionNonce();
        // The SDK normalizes the request URL before sending it; this is the exact GNAP hash input.
        const outgoingGrantUrl = new URL(senderWallet.authServer).href;
        const callback = new URL("/api/v1/transfers/callback", this.deps.apiPublicUrl);
        callback.searchParams.set("transfer_id", t.id);
        await this.alive(t.id, owner);
        const pendingGrant = await client.grant.request({ url: outgoingGrantUrl }, {
          access_token: {
            access: [{
              type: "outgoing-payment", actions: ["create", "read", "list"], identifier: senderWallet.id,
              limits: { debitAmount: t.debit_amount, receiver: incoming.id }
            }]
          },
          interact: { start: ["redirect"], finish: { method: "redirect", uri: callback.href, nonce: clientNonce } },
        });
        if (!isPendingGrant(pendingGrant)) throw new AppError("Expected interactive outgoing consent", 502);
        validateProviderUrl(pendingGrant.continue.uri);
        validateProviderUrl(pendingGrant.interact.redirect);
        await this.deps.paymentSessionRepository.save({
          transferId: t.id, pendingGrant, clientNonce,
          serverInteractNonce: pendingGrant.interact.finish, grantRequestUrl: outgoingGrantUrl,
          continueAfter: Date.now() + (pendingGrant.continue.wait ?? 0) * 1000, expiresAt
        });
        t = await this.update(t, owner, { status: "AWAITING_AUTHORIZATION", next_attempt_at: new Date(Math.min(t.expires_at.getTime(), Date.now() + 60000)) });
        return { ...this.publicRecord(t), authorizationUrl: pendingGrant.interact.redirect };
      } catch (error) {
        await this.repo.transition(t.id, owner, ["CREATING"], {
          status: error instanceof AppError && error.statusCode === 410 ? "EXPIRED" : "FAILED",
          error_code: "PREPARATION_FAILED", next_attempt_at: new Date()
        });
        await this.deleteSession(t.id);
        throw new AppError("Could not prepare transfer; check its status", error instanceof AppError ? error.statusCode : 502, { transferId: t.id });
      }
    });
    return { transfer: prepared, created: true };
  }

  async handleCallback(id: string, interactRef: string, hash: string) {
    const initial = await this.load(id);
    const fingerprint = callbackFingerprint(interactRef, hash);
    if (initial.callback_fingerprint && initial.callback_fingerprint !== fingerprint) throw new AppError("Invalid payment callback", 400);
    const session = initial.callback_fingerprint ? null : await this.deps.paymentSessionRepository.findById(id);
    if (!initial.callback_fingerprint && (!session || !verifyInteractionHash(session, interactRef, hash))) throw new AppError("Invalid or expired payment callback", 400);
    const owner = randomUUID();
    const claimed = await this.repo.claim(id, owner);
    if (!claimed) return { transferId: id, status: initial.status, retryAfter: 5 };
    return this.leased(claimed, owner, async (t) => {
      if (t.callback_fingerprint && t.callback_fingerprint !== fingerprint) throw new AppError("Callback already consumed", 409);
      if (t.status === "AUTHORIZED") return { transferId: id, status: (await this.submit(t, owner)).status };
      if (t.status !== "AWAITING_AUTHORIZATION") return { transferId: id, status: t.status };
      const session = await this.deps.paymentSessionRepository.findById(id);
      if (!session || t.expires_at.getTime() <= Date.now()) throw new AppError("Payment authorization expired", 410);
      if (!verifyInteractionHash(session, interactRef, hash)) throw new AppError("Invalid payment callback", 400);
      if (Date.now() < session.continueAfter) return {
        transferId: id, status: t.status,
        retryAfter: Math.ceil((session.continueAfter - Date.now()) / 1000)
      };
      t = await this.update(t, owner, { status: "FINALIZING", callback_fingerprint: fingerprint, next_attempt_at: new Date(Date.now() + 60000) });
      try {
        const client = await this.deps.getOpenPaymentsClient();
        await this.alive(id, owner);
        const grant = await client.grant.continue({
          url: session.pendingGrant.continue.uri,
          accessToken: session.pendingGrant.continue.access_token.value
        }, session.interactionSent ? undefined : { interact_ref: interactRef });
        if (!isFinalizedGrantWithAccessToken(grant)) {
          validateProviderUrl(grant.continue.uri);
          const wait = Math.max(1, grant.continue.wait ?? 5);
          await this.deps.paymentSessionRepository.save({
            ...session, pendingGrant: { ...session.pendingGrant, continue: grant.continue },
            interactionSent: true, continueAfter: Date.now() + wait * 1000
          });
          t = await this.update(t, owner, { status: "AWAITING_AUTHORIZATION", next_attempt_at: new Date(Math.min(t.expires_at.getTime(), Date.now() + 60000)) });
          return { transferId: id, status: t.status, retryAfter: wait };
        }
        await this.tokens.store(id, owner, "outgoing", grant.access_token, (token) => this.checkOutgoing(t, token, true));
        t = await this.update(t, owner, { status: "AUTHORIZED", next_attempt_at: new Date() });
      } catch {
        await this.repo.transition(id, owner, ["FINALIZING"], { status: "FAILED", error_code: "AUTHORIZATION_FAILED", next_attempt_at: new Date() });
        await this.deleteSession(id);
        throw new AppError("Could not complete payment authorization; check transfer status", 502);
      }
      t = await this.submit(t, owner);
      await this.deleteSession(id);
      return { transferId: id, status: t.status };
    });
  }

  async get(userId: string, id: string) {
    let t = await this.load(id);
    if (t.sender_user_id !== userId && t.recipient_user_id !== userId) throw new AppError("Transfer not found", 404);
    let available = !t.reconciliation_required;
    // Coalesce frequent polling. AUTHORIZED is submitted only by callback/worker.
    if (!t.last_provider_checked_at || Date.now() - t.last_provider_checked_at.getTime() >= 5000) {
      const owner = randomUUID();
      const claimed = await this.repo.claim(id, owner);
      if (claimed) {
        const result = await this.leased(claimed, owner, (row) => this.maintain(row, owner, false));
        t = result.transfer; available = result.available;
      }
    }
    return { ...await this.present(t, userId), statusRefreshAvailable: available };
  }
  async list(userId: string, limit: number, offset: number) {
    const rows = await this.repo.list(userId, limit + 1, offset);
    return { transfers: rows.slice(0, limit).map((t) => this.publicRecord(t)), pagination: { limit, offset, hasMore: rows.length > limit } };
  }
  async processNext(): Promise<boolean> {
    const owner = randomUUID();
    const t = await this.repo.claimDue(owner);
    if (!t) return false;
    if (t.next_attempt_at && Date.now() - t.next_attempt_at.getTime() > 60000) {
      logger.warn({ transferId: t.id, event: "worker_lag", lagMs: Date.now() - t.next_attempt_at.getTime() }, "Payment recovery delayed");
    }
    await this.leased(t, owner, (row) => this.maintain(row, owner, true));
    return true;
  }

  private async maintain(t: TransferRecord, owner: string, allowSubmit: boolean) {
    // A claim is possible only after the previous operation releases or loses its lease.
    if (["CREATING", "FINALIZING", "SUBMITTING"].includes(t.status) && Date.now() - t.state_changed_at.getTime() >= 60000) {
      const sending = t.status === "SUBMITTING";
      t = await this.update(t, owner, {
        status: sending ? "UNKNOWN" : "FAILED", reconciliation_required: sending,
        error_code: sending ? "PAYMENT_OUTCOME_UNKNOWN" : t.status === "CREATING" ? "PREPARATION_INTERRUPTED" : "AUTHORIZATION_INTERRUPTED"
      });
    }
    if (["CREATING", "AWAITING_AUTHORIZATION", "AUTHORIZED"].includes(t.status) && t.expires_at.getTime() <= Date.now()) {
      t = await this.update(t, owner, { status: "EXPIRED", error_code: "AUTHORIZATION_EXPIRED" });
    }
    let available = true;
    try {
      if (allowSubmit && t.status === "AUTHORIZED") t = await this.submit(t, owner);
      if (["PENDING", "UNKNOWN"].includes(t.status)) t = await this.refresh(t, owner);
    } catch (error) {
      available = false;
      const needsHelp = error instanceof AppError;
      t = await this.load(t.id);
      t = await this.update(t, owner, { reconciliation_required: t.reconciliation_required || needsHelp });
      logger.warn({ transferId: t.id, event: "reconciliation_unavailable", manual: needsHelp }, "Provider status refresh unavailable");
    }
    if (terminal(t)) {
      t = await this.cleanup(t, owner);
    } else {
      const attempts = Math.min(t.reconciliation_attempts + 1, 30);
      const delay = Math.min(300000, 5000 * 2 ** Math.min(attempts - 1, 6) * (0.9 + Math.random() * 0.2));
      const temporaryResolved = await this.cleanupTemporary(t, owner);
      const next = t.status === "AWAITING_AUTHORIZATION"
        ? new Date(Math.min(t.expires_at.getTime(), Date.now() + 60000))
        : new Date(Date.now() + (temporaryResolved ? delay : Math.min(delay, 60000)));
      t = await this.update(t, owner, { reconciliation_attempts: attempts, next_attempt_at: next });
    }
    return { transfer: t, available };
  }

  private async submit(t: TransferRecord, owner: string): Promise<TransferRecord> {
    if (t.expires_at.getTime() <= Date.now()) return this.update(t, owner, { status: "EXPIRED", error_code: "AUTHORIZATION_EXPIRED", next_attempt_at: new Date() });
    const sender = await this.repo.findWallet(t.sender_user_id, t.sender_wallet_id);
    const recipient = await this.repo.findWallet(t.recipient_user_id, t.recipient_wallet_id);
    if (!sender || !recipient) return this.update(t, owner, { status: "FAILED", error_code: "WALLET_UNAVAILABLE", next_attempt_at: new Date() });
    const token = await this.tokens.get(t.id, owner, "outgoing", (value) => this.checkOutgoing(t, value, true));
    const client = await this.deps.getOpenPaymentsClient();
    await this.alive(t.id, owner);
    if (t.expires_at.getTime() <= Date.now()) return this.update(t, owner, { status: "EXPIRED", error_code: "AUTHORIZATION_EXPIRED", next_attempt_at: new Date() });
    t = await this.update(t, owner, { status: "SUBMITTING", next_attempt_at: new Date(Date.now() + 60000) });
    let payment: OutgoingPayment;
    try {
      await this.tokens.assertUsable(t.id, "outgoing");
      payment = await client.outgoingPayment.create({ url: t.sender_wallet.resourceServer, accessToken: token }, {
        walletAddress: t.sender_wallet.id, quoteId: t.quote_url!, metadata: { transferId: t.id, ...(t.description ? { description: t.description } : {}) },
      });
    } catch (error) {
      const rejection = this.classifyCreateError(error);
      t = await this.update(t, owner, {
        status: rejection.status, error_code: rejection.code,
        reconciliation_required: rejection.status === "UNKNOWN", next_attempt_at: new Date()
      });
      logger.warn({ transferId: t.id, event: "outgoing_create_result", status: t.status }, "Outgoing instruction did not return a usable resource");
      return t;
    }
    try {
      t = await this.recordOutgoing(t, owner, payment);
    } catch {
      // A successful create followed by a bad response or DB failure remains uncertain.
      return this.update(t, owner, { status: "UNKNOWN", error_code: "PAYMENT_OUTCOME_UNKNOWN", reconciliation_required: true, next_attempt_at: new Date() });
    }
    await this.deleteSession(t.id);
    return t;
  }
  private classifyCreateError(error: unknown): { status: TransferStatus; code: string } {
    if (error instanceof OpenPaymentsClientError && !error.validationErrors?.length) {
      // Only explicit provider error bodies are classified; unknown 4xx remain ambiguous.
      if (error.status && [400, 409, 410, 422].includes(error.status) && error.code === "quote_expired") return { status: "EXPIRED", code: "QUOTE_EXPIRED" };
      if (error.status && [400, 401, 403, 422].includes(error.status) && error.code &&
        ["invalid_request", "invalid_token", "insufficient_access", "insufficient_grant", "insufficient_funds", "invalid_quote"].includes(error.code)) {
        return { status: "FAILED", code: "PAYMENT_REJECTED" };
      }
    }
    return { status: "UNKNOWN", code: "PAYMENT_OUTCOME_UNKNOWN" };
  }
  private async refresh(t: TransferRecord, owner: string): Promise<TransferRecord> {
    const client = await this.deps.getOpenPaymentsClient();
    // A persisted provider failure needs only the recipient receipt. A later
    // outgoing read/credential failure must not block that final reconciliation.
    if (!t.provider_failed) {
      const accessToken = await this.tokens.get(t.id, owner, "outgoing", (value) => this.checkOutgoing(t, value));
      await this.alive(t.id, owner);
      if (t.outgoing_payment_url) {
        t = await this.recordOutgoing(t, owner, await this.readResource(t, owner, "outgoing", () => client.outgoingPayment.get({ url: t.outgoing_payment_url!, accessToken })));
      } else {
        let cursor: string | undefined;
        let match: OutgoingPayment | undefined;
        for (let page = 0; page < 10; page++) {
          await this.alive(t.id, owner);
          const result = await this.readResource(t, owner, "outgoing", () => client.outgoingPayment.list({ url: t.sender_wallet.resourceServer, walletAddress: t.sender_wallet.id, accessToken },
            { "wallet-address": t.sender_wallet.id, first: 100, ...(cursor ? { cursor } : {}) }));
          match = result.result.find((p) => p.quoteId === t.quote_url && p.metadata?.transferId === t.id);
          if (match || !result.pagination.hasNextPage || !result.pagination.endCursor) break;
          cursor = result.pagination.endCursor;
        }
        if (!match) return this.update(t, owner, { last_provider_checked_at: new Date(), reconciliation_required: true });
        t = await this.recordOutgoing(t, owner, match);
      }
    }
    const incomingToken = await this.tokens.get(t.id, owner, "incoming", (value) => this.checkIncoming(t, value));
    await this.alive(t.id, owner);
    const incoming = await this.readResource(t, owner, "incoming", () => client.incomingPayment.get({ url: t.incoming_payment_url!, accessToken: incomingToken }));
    if (incoming.id !== t.incoming_payment_url || incoming.walletAddress !== t.recipient_wallet.id || !t.receive_amount ||
      !sameAsset(incoming.receivedAmount, t.receive_amount)) throw new AppError("Incoming payment mismatch", 502);
    const completed = BigInt(incoming.receivedAmount.value) >= BigInt(t.receive_amount.value);
    const finalized = t.provider_failed || completed;
    return this.update(t, owner, {
      received_amount: incoming.receivedAmount,
      incoming_completed_at: incoming.completed ? (t.incoming_completed_at ?? new Date()) : t.incoming_completed_at,
      status: completed ? "COMPLETED" : t.provider_failed ? "FAILED" : "PENDING",
      completed_at: finalized ? new Date() : null, last_provider_checked_at: new Date(), reconciliation_required: false,
      error_code: t.provider_failed ? (completed ? "PROVIDER_FAILURE_WITH_FULL_RECEIPT" : "PAYMENT_FAILED") : null
    });
  }
  private async readResource<T>(t: TransferRecord, owner: string, purpose: "incoming" | "outgoing", read: () => Promise<T>): Promise<T> {
    try { await this.tokens.assertUsable(t.id, purpose); return await read(); }
    catch (error) {
      if (error instanceof OpenPaymentsClientError && [401, 403].includes(error.status ?? 0)) {
        await this.tokens.unavailable(t.id, owner, purpose);
        throw new AppError("Provider no longer accepts the reconciliation credential", 503);
      }
      throw error;
    }
  }
  private async recordOutgoing(t: TransferRecord, owner: string, payment: OutgoingPayment) {
    validateProviderUrl(payment.id);
    if (payment.walletAddress !== t.sender_wallet.id || payment.receiver !== t.incoming_payment_url || payment.quoteId !== t.quote_url ||
      payment.metadata?.transferId !== t.id || !sameAmount(payment.debitAmount, t.debit_amount) ||
      !t.receive_amount || !sameAmount(payment.receiveAmount, t.receive_amount) ||
      !sameAsset(payment.sentAmount, t.debit_amount) || BigInt(payment.sentAmount.value) > BigInt(t.debit_amount.value) ||
      (t.outgoing_payment_url && payment.id !== t.outgoing_payment_url)) throw new AppError("Outgoing payment mismatch", 502);
    return this.update(t, owner, {
      outgoing_payment_url: payment.id, sent_amount: payment.sentAmount, provider_failed: t.provider_failed === true || payment.failed,
      status: "PENDING", error_code: t.provider_failed || payment.failed ? "PAYMENT_FAILED" : null,
      last_provider_checked_at: new Date(), reconciliation_required: false, next_attempt_at: new Date()
    });
  }
  private async cleanupTemporary(t: TransferRecord, owner: string): Promise<boolean> {
    let resolved = true;
    for (const purpose of ["incoming-create", "quote"] as const) {
      await this.alive(t.id, owner);
      try { if (!await this.tokens.cleanup(t.id, owner, purpose)) resolved = false; }
      catch { resolved = false; }
    }
    return resolved;
  }
  private async cleanup(t: TransferRecord, owner: string) {
    await this.deleteSession(t.id);
    if (t.cleanup_state === "DONE") return this.update(t, owner, { next_attempt_at: null });
    let incomingResolved = !t.incoming_payment_url || !!t.incoming_completed_at ||
      !!(t.incoming_expires_at && t.incoming_expires_at.getTime() <= Date.now());
    if (!incomingResolved) {
      try {
        // Preparation may have stopped after creating the incoming resource.
        if (!await this.repo.credential(t.id, "incoming")) await this.acquireIncoming(t, owner);
        const client = await this.deps.getOpenPaymentsClient();
        const token = await this.tokens.get(t.id, owner, "incoming", (value) => this.checkIncoming(t, value));
        await this.alive(t.id, owner);
        await this.tokens.assertUsable(t.id, "incoming");
        const incoming = await client.incomingPayment.complete({ url: t.incoming_payment_url!, accessToken: token });
        if (incoming.id !== t.incoming_payment_url || validateWalletAddress(incoming.walletAddress) !== t.recipient_wallet.id ||
            !incoming.completed) throw new AppError("Incoming completion was not confirmed", 502);
        // Commit completion before deleting its credential; retries need no token to repeat it.
        t = await this.update(t, owner, { incoming_completed_at: new Date() });
        incomingResolved = true;
      } catch { /* Preserve the credential until completion is confirmed or incoming expires. */ }
    }
    let resolved = await this.cleanupTemporary(t, owner);
    for (const purpose of ["incoming", "outgoing"] as const) {
      if (purpose === "incoming" && !incomingResolved) { resolved = false; continue; }
      await this.alive(t.id, owner);
      try { if (!await this.tokens.cleanup(t.id, owner, purpose)) resolved = false; }
      catch { resolved = false; }
    }
    if (!resolved) logger.warn({ transferId: t.id, event: "cleanup_failed" }, "Provider cleanup will be retried");
    return this.update(t, owner, {
      cleanup_state: resolved ? "DONE" : "PENDING", cleanup_error: resolved ? null : "PROVIDER_CLEANUP_INCOMPLETE",
      next_attempt_at: resolved ? null : new Date(Date.now() + 60000)
    });
  }
  private exactScope(token: Token, type: string, actions: string[], identifier?: string) {
    const access = token.access;
    if (access.length !== 1 || access[0].type !== type ||
        ("identifier" in access[0] ? access[0].identifier : undefined) !== identifier ||
        access[0].actions.length !== actions.length || !actions.every((action) => access[0].actions.some((value) => value === action)) ||
        Object.keys(access[0]).some((key) => !["type", "actions", ...(identifier ? ["identifier"] : [])].includes(key))) {
      throw new AppError("Provider grant rights mismatch", 502);
    }
  }
  private checkIncomingCreate(t: TransferRecord, token: Token) {
    this.exactScope(token, "incoming-payment", ["create"], t.recipient_wallet.id);
  }
  private checkIncoming(t: TransferRecord, token: Token) {
    if (!t.incoming_payment_url) throw new AppError("Incoming payment is unavailable", 503);
    this.exactScope(token, "incoming-payment", ["read", "complete"], t.incoming_payment_url);
  }
  private checkQuote(token: Token) { this.exactScope(token, "quote", ["create"]); }
  private async acquireIncoming(t: TransferRecord, owner: string) {
    if (!t.incoming_payment_url) throw new AppError("Incoming payment is unavailable", 503);
    const client = await this.deps.getOpenPaymentsClient();
    await this.alive(t.id, owner);
    const grant = await client.grant.request({ url: t.recipient_wallet.authServer }, {
      access_token: { access: [{ type: "incoming-payment", identifier: t.incoming_payment_url, actions: ["read", "complete"] }] }
    });
    if (!isFinalizedGrantWithAccessToken(grant)) throw new AppError("Provider does not support resource-bound incoming authority", 422);
    await this.tokens.store(t.id, owner, "incoming", grant.access_token, (token) => this.checkIncoming(t, token));
  }
  private checkOutgoing(t: TransferRecord, token: Token, create = false) {
    const required = create ? ["create", "read", "list"] : ["read", "list"];
    const allowed = ["create", "read", "list"];
    const access = token.access;
    const scope = access[0];
    if (access.length !== 1 || scope?.type !== "outgoing-payment" || scope.identifier !== t.sender_wallet.id ||
        Object.keys(scope).some((key) => !["type", "actions", "identifier", "limits"].includes(key)) ||
        new Set(scope.actions).size !== scope.actions.length || scope.actions.some((action) => !allowed.includes(action)) ||
        !required.every((action) => scope.actions.some((value) => value === action)) ||
        !scope.limits || Object.keys(scope.limits).some((key) => !["debitAmount", "receiver"].includes(key)) ||
        scope.limits.receiver !== t.incoming_payment_url || !("debitAmount" in scope.limits) || !scope.limits.debitAmount ||
        Object.keys(scope.limits.debitAmount).some((key) => !["value", "assetCode", "assetScale"].includes(key)) ||
        !sameAmount(scope.limits.debitAmount, t.debit_amount)) {
      throw new AppError("Outgoing grant rights mismatch", 502);
    }
  }
  private snapshot(linked: TransferWallet, wallet: WalletAddress): WalletSnapshot {
    const walletId = validateWalletAddress(wallet.id);
    if (validateWalletAddress(linked.walletAddressUrl) !== walletId || linked.assetCode !== wallet.assetCode || linked.assetScale !== wallet.assetScale) throw new AppError("Wallet changed; relink it", 409);
    for (const url of [wallet.id, wallet.authServer, wallet.resourceServer]) validateProviderUrl(url);
    return { id: walletId, assetCode: wallet.assetCode, assetScale: wallet.assetScale, authServer: wallet.authServer, resourceServer: wallet.resourceServer };
  }
  private async leased<T>(t: TransferRecord, owner: string, action: (row: TransferRecord) => Promise<T>): Promise<T> {
    const heartbeat = setInterval(() => { void this.repo.renew(t.id, owner).catch(() => false); }, 15000);
    heartbeat.unref();
    try { return await action(t); }
    finally { clearInterval(heartbeat); await this.repo.release(t.id, owner); }
  }
  private async alive(id: string, owner: string) {
    if (!await this.repo.renew(id, owner)) throw new AppError("Transfer lease lost", 409);
  }
  private async update(t: TransferRecord, owner: string, changes: TransferUpdates) {
    const result = await this.repo.transition(t.id, owner, [t.status], changes);
    if (!result) throw new AppError("Transfer state changed or lease expired", 409);
    return result;
  }
  private async load(id: string) {
    const t = await this.repo.findById(id);
    if (!t) throw new AppError("Transfer not found", 404);
    return t;
  }
  private async replay(t: TransferRecord, hash: string, userId: string) {
    if (t.request_hash !== hash) throw new AppError("Idempotency-Key belongs to a different transfer", 409);
    return { transfer: await this.present(t, userId), created: false };
  }
  private async present(t: TransferRecord, userId: string) {
    const session = t.sender_user_id === userId && t.status === "AWAITING_AUTHORIZATION" ? await this.deps.paymentSessionRepository.findById(t.id) : null;
    return { ...this.publicRecord(t), ...(session ? { authorizationUrl: session.pendingGrant.interact.redirect } : {}) };
  }
  private publicRecord(t: TransferRecord) {
    return {
      transferId: t.id, senderUserId: t.sender_user_id, recipientUserId: t.recipient_user_id,
      senderWalletId: t.sender_wallet_id, recipientWalletId: t.recipient_wallet_id, status: t.status, description: t.description,
      debitAmount: t.debit_amount, receiveAmount: t.receive_amount, sentAmount: t.sent_amount, receivedAmount: t.received_amount,
      providerFailed: t.provider_failed, lastProviderCheckedAt: t.last_provider_checked_at, reconciliationRequired: t.reconciliation_required,
      incomingPaymentUrl: t.incoming_payment_url, quoteUrl: t.quote_url, outgoingPaymentUrl: t.outgoing_payment_url,
      errorCode: t.error_code, expiresAt: t.expires_at, createdAt: t.created_at, updatedAt: t.updated_at, completedAt: t.completed_at
    };
  }
  private async deleteSession(id: string) { try { await this.deps.paymentSessionRepository.delete(id); } catch { /* Redis TTL is fallback. */ } }
}
