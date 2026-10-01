import type { AccessToken } from "@interledger/open-payments";
import type { CredentialPurpose, TransferCredential, TransferRepositoryInterface } from "@/types/transfer";
import type { getOpenPaymentsClient } from "@/utils/open-payment";
import { createGrantCipher } from "@/utils/grant-encryption";
import { validateProviderUrl } from "@/utils/provider-url";
import { AppError } from "@/utils/appError";
import { logger } from "@/utils/logger";

type Token = AccessToken["access_token"];
export class PaymentTokenService {
  private readonly cipher = createGrantCipher();
  constructor(private readonly repo: TransferRepositoryInterface, private readonly client: typeof getOpenPaymentsClient) {}
  private context(id: string, purpose: CredentialPurpose) { return `transfer-${purpose}:${id}`; }
  async store(id: string, owner: string, purpose: CredentialPurpose, token: Token, validate: (token: Token) => void) {
    await this.persistValidated(id, owner, purpose, token, validate, 1);
  }
  private async persistValidated(id: string, owner: string, purpose: CredentialPurpose, token: Token,
    validate: (token: Token) => void, generation: number, expectedGeneration?: number): Promise<TransferCredential> {
    const credential = this.encode(id, purpose, token, generation);
    try { validate(token); }
    catch (error) {
      // Validation has rejected this token. This record authorizes cleanup only,
      // and can never be returned by get() or used for a payment operation.
      await this.repo.saveCredential(id, owner, { ...credential, state: "REJECTED" }, expectedGeneration);
      try { await this.cleanup(id, owner, purpose); } catch { /* Worker retries cleanup. */ }
      throw error;
    }
    await this.repo.saveCredential(id, owner, credential, expectedGeneration);
    return credential;
  }
  private encode(id: string, purpose: CredentialPurpose, token: Token, generation: number): TransferCredential {
    validateProviderUrl(token.manage);
    if (!token.value || !Array.isArray(token.access) || (token.expires_in !== undefined &&
        (!Number.isFinite(token.expires_in) || token.expires_in < 0))) throw new AppError("Invalid payment credential", 502);
    const lifetime = token.expires_in === undefined ? null : token.expires_in * 1000;
    return { transfer_id: id, purpose, token_enc: this.cipher.encrypt(token.value, this.context(id, purpose)),
      key_id: this.cipher.activeKeyId, manage_url: token.manage, access: token.access,
      expires_at: lifetime === null ? null : new Date(Date.now() + lifetime),
      rotate_after: lifetime === null ? null : new Date(Date.now() + lifetime - Math.min(60000, lifetime / 2)),
      generation, state: "READY" };
  }
  async get(id: string, owner: string, purpose: CredentialPurpose, validate: (token: Token) => void): Promise<string> {
    let credential = await this.repo.credential(id, purpose);
    if (credential?.state === "ROTATING") {
      // The replacement may outlive the old token. Its expiry is unknown.
      credential = { ...credential, state: "UNAVAILABLE", expires_at: null, rotate_after: null };
      await this.repo.saveCredential(id, owner, credential, credential.generation);
    }
    if (credential?.expires_at && credential.expires_at.getTime() <= Date.now()) throw new AppError("Payment credential expired", 503);
    if (!credential || credential.state !== "READY") throw new AppError("Payment credential needs reconciliation", 503);
    validate({ value: "", manage: credential.manage_url, access: credential.access });
    if (credential.rotate_after && credential.rotate_after.getTime() <= Date.now()) {
      const previous = credential;
      await this.repo.saveCredential(id, owner, { ...previous, state: "ROTATING" }, previous.generation);
      let rotationAttempted = false;
      try {
        const client = await this.client();
        if (previous.expires_at && previous.expires_at.getTime() <= Date.now()) throw new AppError("Payment credential expired", 503);
        rotationAttempted = true;
        const result = await client.token.rotate({ url: previous.manage_url,
          accessToken: this.cipher.decrypt(previous.token_enc, this.context(id, purpose)) });
        credential = await this.persistValidated(id, owner, purpose, result.access_token, validate,
          previous.generation + 1, previous.generation);
      } catch {
        // Rotation replaces the old token. A lost response cannot safely be replayed.
        const current = await this.repo.credential(id, purpose);
        if (current?.generation === previous.generation + 1 && current.state === "READY") {
          credential = current; // Recover a committed replacement after an uncertain DB acknowledgement.
        } else {
          if (current?.generation === previous.generation) {
            await this.repo.saveCredential(id, owner, { ...current,
              state: rotationAttempted ? "UNAVAILABLE" : "READY",
              expires_at: rotationAttempted ? null : current.expires_at,
              rotate_after: rotationAttempted ? null : current.rotate_after,
            }, current.generation);
          }
          logger.warn({ transferId: id, purpose, event: "token_rotation_unresolved" }, "Payment credential requires provider reconciliation");
          throw new AppError("Payment credential rotation is unresolved", 503);
        }
      }
    }
    if (credential.expires_at && credential.expires_at.getTime() <= Date.now()) throw new AppError("Payment credential expired", 503);
    validate({ value: "", manage: credential.manage_url, access: credential.access });
    return this.cipher.decrypt(credential.token_enc, this.context(id, purpose));
  }
  async unavailable(id: string, owner: string, purpose: CredentialPurpose) {
    const credential = await this.repo.credential(id, purpose);
    if (credential) await this.repo.saveCredential(id, owner, { ...credential, state: "UNAVAILABLE" }, credential.generation);
  }
  async assertUsable(id: string, purpose: CredentialPurpose): Promise<void> {
    const credential = await this.repo.credential(id, purpose);
    if (!credential || credential.state !== "READY" ||
        (credential.expires_at && credential.expires_at.getTime() <= Date.now())) {
      throw new AppError("Payment credential is unavailable or expired", 503);
    }
  }
  async cleanup(id: string, owner: string, purpose: CredentialPurpose): Promise<boolean> {
    const credential = await this.repo.credential(id, purpose);
    if (!credential) return true;
    if (credential.state === "ROTATING") {
      await this.repo.saveCredential(id, owner, { ...credential, state: "UNAVAILABLE", expires_at: null, rotate_after: null }, credential.generation);
      return false;
    }
    if (credential.expires_at && credential.expires_at.getTime() <= Date.now()) {
      await this.repo.clearCredential(id, owner, purpose);
      return true;
    }
    // A lost rotation response leaves the old token's authority uncertain.
    if (credential.state !== "READY" && credential.state !== "REJECTED") return false;
    try {
      const client = await this.client();
      if (!credential.expires_at || credential.expires_at.getTime() > Date.now()) {
        await client.token.revoke({ url: credential.manage_url,
          accessToken: this.cipher.decrypt(credential.token_enc, this.context(id, purpose)) });
      }
    } catch { return false; }
    await this.repo.clearCredential(id, owner, purpose);
    return true;
  }
}
