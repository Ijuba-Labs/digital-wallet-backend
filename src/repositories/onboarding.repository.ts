import type { OnboardingRepositoryDependencies, OnboardingSession } from "@/types/onboarding";
import { AppError } from "@/utils/appError";
import { createGrantCipher } from "@/utils/grant-encryption";
import { SESSION_TTL_MS, type OnboardingStatusType } from "@/constants/onboarding";

export class OnboardingRepository {
  private readonly cipher = createGrantCipher();
  constructor(private readonly deps: OnboardingRepositoryDependencies) {}
  private key(id: string) { return `onboarding:v2:${id}`; }
  private active(userId: string) { return `onboarding:v2:user:${userId}`; }
  private encode(s: OnboardingSession) { return this.cipher.encrypt(JSON.stringify(s), `onboarding-session:${s.id}`); }
  private decode(id: string, raw: string): OnboardingSession {
    const s = JSON.parse(this.cipher.decrypt(raw, `onboarding-session:${id}`));
    return { ...s, createdAt: new Date(s.createdAt), updatedAt: new Date(s.updatedAt), completedAt: s.completedAt ? new Date(s.completedAt) : undefined };
  }
  async save(s: OnboardingSession): Promise<void> {
    const ttl = s.createdAt.getTime() + SESSION_TTL_MS - Date.now();
    if (ttl <= 0) throw new AppError("Onboarding expired", 410);
    const result = await this.deps.redis.eval(`
      if redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
      redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[3])
      redis.call('SET', KEYS[2], ARGV[2], 'PX', ARGV[3])
      return 1
    `, 2, this.key(s.id), this.active(s.userId), this.encode(s), s.id, ttl);
    if (result !== 1) throw new AppError("An onboarding session is already active", 409);
  }
  async findById(id: string): Promise<OnboardingSession | null> {
    const raw = await this.deps.redis.get(this.key(id));
    return raw ? this.decode(id, raw) : null;
  }
  async findActiveByUserId(userId: string): Promise<OnboardingSession | null> {
    const id = await this.deps.redis.get(this.active(userId));
    if (!id) return null;
    const session = await this.findById(id);
    if (!session || ["COMPLETED", "FAILED", "EXPIRED"].includes(session.status)) {
      await this.releaseActive(userId, id); return null;
    }
    return session;
  }
  async transition(id: string, expected: OnboardingStatusType, changes: Partial<OnboardingSession>): Promise<OnboardingSession> {
    const raw = await this.deps.redis.get(this.key(id));
    if (!raw) throw new AppError("Onboarding session unavailable", 410);
    const current = this.decode(id, raw);
    if (current.status !== expected) throw new AppError("Onboarding state changed", 409);
    if (Date.now() >= current.createdAt.getTime() + SESSION_TTL_MS) throw new AppError("Onboarding expired", 410);
    const updated = { ...current, ...changes, updatedAt: new Date() };
    const result = await this.deps.redis.eval(`
      if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
      redis.call('SET', KEYS[1], ARGV[2], 'KEEPTTL')
      return 1
    `, 1, this.key(id), raw, this.encode(updated));
    if (result !== 1) throw new AppError("Onboarding state changed", 409);
    if (["COMPLETED", "FAILED", "EXPIRED"].includes(updated.status)) await this.releaseActive(updated.userId, id);
    return updated;
  }
  private async releaseActive(userId: string, id: string) {
    await this.deps.redis.eval(`if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('DEL', KEYS[1]) end`, 1, this.active(userId), id);
  }
}
