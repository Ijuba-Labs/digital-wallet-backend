import { z } from "zod";

/**
 * Validates the wallet address URL format.
 * Must be a valid HTTPS URL pointing to a wallet address endpoint.
 * Examples:
 *   - https://ilp.interledger-test.dev/ijubane
 *   - https://cloud-nine-wallet-backend/.well-known/pay
 */
const walletAddressUrl = z
  .url("walletAddressUrl must be a valid URL")
  .startsWith("https://", "walletAddressUrl must use HTTPS");

// .string({ error: "walletAddressUrl is required" })
// .url("walletAddressUrl must be a valid URL")
// .startsWith("https://", "walletAddressUrl must use HTTPS");

export const startOnboardingSchema = z.object({
  walletAddressUrl,
  clientId: z.enum(["api", "web", "mobile"]).default("api"),
}).strict();

export const consentOnboardingSchema = z.object({
  // No body needed — sessionId comes from route params
});

export const callbackQuerySchema = z.object({
  session_id: z.string({ error: "session_id is required" }).min(1).max(100),
  interact_ref: z.string({ error: "interact_ref is required" }).min(1).max(2048).regex(/^[^\r\n]+$/),
  hash: z.string({ error: "hash is required" }).min(1).max(128),
});

// Infer types from schemas
export type StartOnboardingInput = z.infer<typeof startOnboardingSchema>;
export type CallbackQuery = z.infer<typeof callbackQuerySchema>;
