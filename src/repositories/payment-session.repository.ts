import type Redis from "ioredis";
import type { PaymentSession, PaymentSessionRepositoryInterface } from "@/types/transfer";
import { createGrantCipher } from "@/utils/grant-encryption";
import { AppError } from "@/utils/appError";
import { z } from "zod";
import { validateProviderUrl } from "@/utils/provider-url";

const text = z.string().min(1).max(4096).regex(/^[\x21-\x7e]+$/);
const providerUrl = text.refine((value) => {
  try { validateProviderUrl(value); return true; } catch { return false; }
});
const sessionSchema = z.object({
  transferId: z.uuid(), clientNonce: text, serverInteractNonce: text,
  grantRequestUrl: providerUrl,
  expiresAt: z.number().int().positive().safe(),
  continueAfter: z.number().int().nonnegative().safe(),
  interactionSent: z.boolean().optional(),
  pendingGrant: z.object({
    continue: z.object({
      uri: providerUrl, access_token: z.object({ value: text }).passthrough(),
      wait: z.number().int().nonnegative().safe().optional(),
    }).passthrough(),
    interact: z.object({ redirect: providerUrl, finish: text }).passthrough(),
  }).passthrough(),
}).strict().refine((s) => s.serverInteractNonce === s.pendingGrant.interact.finish);

export class PaymentSessionRepository implements PaymentSessionRepositoryInterface {
  private readonly cipher: ReturnType<typeof createGrantCipher>;

  constructor(private readonly deps: { redis: Redis; encryptionKey?: string }) {
    this.cipher = createGrantCipher(deps.encryptionKey);
  }

  async save(session: PaymentSession): Promise<void> {
    this.validate(session.transferId, session);
    const ttl = session.expiresAt - Date.now();
    if (ttl <= 0) throw new AppError("Payment authorization has expired", 410);
    await this.deps.redis.set(`payment:session:${session.transferId}`,
      this.cipher.encrypt(JSON.stringify(session), `payment-session:${session.transferId}`), "PX", ttl);
  }

  async findById(transferId: string): Promise<PaymentSession | null> {
    const raw = await this.deps.redis.get(`payment:session:${transferId}`);
    if (!raw) return null;
    let session: PaymentSession;
    try {
      session = this.validate(transferId, JSON.parse(this.cipher.decrypt(raw, `payment-session:${transferId}`)));
    } catch { throw new AppError("Payment session is invalid", 503); }
    return session.expiresAt > Date.now() ? session : null;
  }

  private validate(transferId: string, value: unknown): PaymentSession {
    const result = sessionSchema.safeParse(value);
    if (!result.success || result.data.transferId !== transferId) throw new AppError("Payment session is invalid", 503);
    return result.data as PaymentSession;
  }

  async delete(transferId: string): Promise<void> {
    await this.deps.redis.del(`payment:session:${transferId}`);
  }
}
