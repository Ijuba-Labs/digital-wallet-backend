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
  async store(id: string, owner: string, purpose: CredentialPurpose, token: Token) {
    await this.repo.saveCredential(id, owner, this.encode(id, purpose, token, 1));
  }
  private encode(id: string, purpose: CredentialPurpose, token: Token, generation: number): TransferCredential {
    validateProviderUrl(token.manage);
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
      await this.repo.saveCredential(id, owner, { ...credential, state: "UNAVAILABLE" }, credential.generation);
    }
    if (!credential || credential.state !== "READY") throw new AppError("Payment credential needs reconciliation", 503);
    if (credential.rotate_after && credential.rotate_after.getTime() <= Date.now()) {
      const previous = credential;
      await this.repo.saveCredential(id, owner, { ...previous, state: "ROTATING" }, previous.generation);
      try {
        const client = await this.client();
        const result = await client.token.rotate({ url: previous.manage_url,
          accessToken: this.cipher.decrypt(previous.token_enc, this.context(id, purpose)) });
        validate(result.access_token);
        credential = this.encode(id, purpose, result.access_token, previous.generation + 1);
        await this.repo.saveCredential(id, owner, credential, previous.generation);
      } catch {
        // Rotation replaces the old token. A lost response cannot safely be replayed.
        const current = await this.repo.credential(id, purpose);
        if (current?.generation === previous.generation + 1 && current.state === "READY") {
          credential = current; // Recover a committed replacement after an uncertain DB acknowledgement.
        } else {
          if (current?.generation === previous.generation) {
            await this.repo.saveCredential(id, owner, { ...current, state: "UNAVAILABLE" }, current.generation);
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
  async cleanup(id: string, owner: string, purpose: CredentialPurpose): Promise<boolean> {
    const credential = await this.repo.credential(id, purpose);
    if (!credential) return true;
    let revoked = false;
    try {
      if (credential.state === "READY") {
        const client = await this.client();
        await client.token.revoke({ url: credential.manage_url,
          accessToken: this.cipher.decrypt(credential.token_enc, this.context(id, purpose)) });
        revoked = true;
      }
    } catch { /* Best effort; erase local secrets after terminal business results. */ }
    await this.repo.clearCredential(id, owner, purpose);
    return revoked;
  }
}
