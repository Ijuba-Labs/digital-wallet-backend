import { env } from "@/config/env";

/**
 * Onboarding session lifecycle states.
 * Enforces valid transitions via the state machine in OnboardingService.
 */
export const OnboardingStatus = {
  /** Session created, wallet not yet resolved */
  PENDING: "PENDING",
  /** Wallet address resolved successfully */
  WALLET_RESOLVED: "WALLET_RESOLVED",
  CONSENT_REQUESTING: "CONSENT_REQUESTING",
  /** GNAP grant requested, waiting for user consent */
  CONSENT_PENDING: "CONSENT_PENDING",
  FINALIZING: "FINALIZING",
  /** User approved consent, grant finalized */
  COMPLETED: "COMPLETED",
  /** User denied consent or flow expired */
  FAILED: "FAILED",
  /** Session expired (configurable TTL) */
  EXPIRED: "EXPIRED",
} as const;

export type OnboardingStatusType =
  (typeof OnboardingStatus)[keyof typeof OnboardingStatus];

/**
 * Valid state transitions — the state machine definition.
 * Used by OnboardingService.transitionTo() to prevent invalid jumps.
 *
 * PENDING → WALLET_RESOLVED → CONSENT_REQUESTING → CONSENT_PENDING
 *         → FINALIZING → COMPLETED. Nonterminal steps can fail.
 * Expired sessions are rejected by the service and removed by Redis TTL.
 */
export const VALID_TRANSITIONS: Record<
  OnboardingStatusType,
  OnboardingStatusType[]
> = {
  PENDING: ["WALLET_RESOLVED", "FAILED", "EXPIRED"],
  WALLET_RESOLVED: ["CONSENT_REQUESTING", "FAILED", "EXPIRED"],
  CONSENT_REQUESTING: ["CONSENT_PENDING", "FAILED", "EXPIRED"],
  CONSENT_PENDING: ["FINALIZING", "FAILED", "EXPIRED"],
  FINALIZING: ["CONSENT_PENDING", "COMPLETED", "FAILED", "EXPIRED"],
  COMPLETED: [], // terminal
  FAILED: ["PENDING"], // allow retry from failed
  EXPIRED: [], // terminal
};

/** Validated minutes; the legacy environment name also means minutes. */
export const SESSION_TTL_MS = env.ONBOARDING_SESSION_TTL_MINUTES * 60 * 1000;
