import type { Knex } from "knex";

export interface OnboardingRequestRecord {
  user_id: string;
  key_hash: string;
  request_hash: string;
  session_id: string;
  session_created_at: Date;
}

/** Persist retry identity, without storing the raw key or continuation secrets. */
export class OnboardingRequestRepository {
  constructor(private readonly db: Knex) {}
  async find(userId: string, keyHash: string): Promise<OnboardingRequestRecord | undefined> {
    return this.db("onboarding_requests").where({ user_id: userId, key_hash: keyHash }).first();
  }
  async reserve(input: OnboardingRequestRecord): Promise<{ record: OnboardingRequestRecord; created: boolean }> {
    const [record] = await this.db("onboarding_requests").insert(input).onConflict(["user_id", "key_hash"])
      .ignore().returning<OnboardingRequestRecord[]>("*");
    if (record) return { record, created: true };
    const existing = await this.find(input.user_id, input.key_hash);
    if (!existing) throw new Error("Onboarding reservation unavailable");
    return { record: existing, created: false };
  }
  async remove(record: OnboardingRequestRecord): Promise<void> {
    await this.db("onboarding_requests").where({ user_id: record.user_id, key_hash: record.key_hash,
      session_id: record.session_id }).del();
  }
}
