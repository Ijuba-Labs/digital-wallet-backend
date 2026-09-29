import type Redis from "ioredis";
import type { PaymentSession, PaymentSessionRepositoryInterface } from "@/types/transfer";
import { createGrantCipher } from "@/utils/grant-encryption";
import { AppError } from "@/utils/appError";

export class PaymentSessionRepository implements PaymentSessionRepositoryInterface {
  private readonly cipher: ReturnType<typeof createGrantCipher>;

  constructor(private readonly deps: { redis: Redis; encryptionKey?: string }) {
    this.cipher = createGrantCipher(deps.encryptionKey);
  }

  async save(session: PaymentSession): Promise<void> {
    const ttl = session.expiresAt - Date.now();
    if (ttl <= 0) throw new AppError("Payment authorization has expired", 410);
    await this.deps.redis.set(`payment:session:${session.transferId}`,
      this.cipher.encrypt(JSON.stringify(session), `payment-session:${session.transferId}`), "PX", ttl);
  }

  async findById(transferId: string): Promise<PaymentSession | null> {
    const raw = await this.deps.redis.get(`payment:session:${transferId}`);
    if (!raw) return null;
    const session = JSON.parse(this.cipher.decrypt(raw, `payment-session:${transferId}`)) as PaymentSession;
    return session.expiresAt > Date.now() ? session : null;
  }

  async delete(transferId: string): Promise<void> {
    await this.deps.redis.del(`payment:session:${transferId}`);
  }
}
