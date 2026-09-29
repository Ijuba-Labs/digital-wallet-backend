import type { Knex } from "knex";
import type { GrantRequest, WalletAddress } from "@interledger/open-payments";
import type { OnboardingClientId } from "@/config/onboarding";
export type GrantScope = NonNullable<GrantRequest["access_token"]>["access"];
export type GrantRepositoryDependencies = { db: Knex };
export interface SaveOwnershipInput {
  transactionId: string; userId: string; wallet: WalletAddress; callbackFingerprint: string;
  clientId: OnboardingClientId; returnUrl: string | null;
}
export interface FinalizedOwnership {
  userId: string; walletAddressUrl: string; callbackFingerprint: string;
  completedAt: Date; clientId: OnboardingClientId; returnUrl: string | null;
}
