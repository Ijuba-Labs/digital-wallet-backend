import { OnboardingStatusType } from "@/constants/onboarding";
import { GrantRepository } from "@/repositories/grant.repository";
import { OnboardingRepository } from "@/repositories/onboarding.repository";
import { logger } from "@/utils/logger";
import { getOpenPaymentsClient } from "@/utils/open-payment";
import { WalletAddress, PendingGrant } from "@interledger/open-payments";
import Redis from "ioredis";
import type { OnboardingClientId, OnboardingConfig } from "@/config/onboarding";
import type { GrantInteraction } from "@/utils/grant-interaction";

/** Input DTO — what the client sends to start onboarding */
export interface OnboardingStartInput {
  walletAddressUrl: string;
  userId: string; // from auth middleware after signup
  clientId?: OnboardingClientId;
}

/** The persisted onboarding session */
export interface OnboardingSession {
  id: string;
  userId: string;
  walletAddressUrl: string;
  status: OnboardingStatusType;
  clientId: OnboardingClientId;
  returnUrl: string | null;
  interaction?: GrantInteraction;
  callbackFingerprint?: string;
  pendingGrant?: PendingGrant;
  continueAfter?: number;
  interactionSent?: boolean;

  /** Resolved wallet metadata (populated after WALLET_RESOLVED) */
  wallet?: WalletAddress;

  redirectUrl?: string;

  /** Timestamps */
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;

  /** Error info if FAILED */
  failureReason?: string;
}


export interface OnboardingStatusResponse {
  sessionId: string;
  status: OnboardingStatusType;
  wallet?: WalletAddress;
  redirectUrl?: string;
  linkedAt?: Date;
  clientId: OnboardingClientId;
  expiresAt: Date;
}

export type OnboardingCallbackResult = {
  sessionId: string;
  status: OnboardingStatusType;
  returnUrl: string | null;
};

// export type OnboardingRepository = ReturnType<typeof createOnboardingRepository>

export type OnboardingServiceDependencies = {
  onboardingRepository: Pick<OnboardingRepository, "save" | "findById" | "findActiveByUserId" | "transition">;
  grantRepository: Pick<GrantRepository, "saveOwnership" | "getFinalized">;
  getOpenPaymentsClient: typeof getOpenPaymentsClient;
  logger: typeof logger;
  config: OnboardingConfig;
};

export type OnboardingRepositoryDependencies = {
redis: Redis
}
