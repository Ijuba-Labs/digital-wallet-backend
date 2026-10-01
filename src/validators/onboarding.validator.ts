import { z } from "zod";

import { validateWalletAddress } from "@/utils/provider-url";

const walletAddressUrl = z.string().transform((value, ctx) => {
  try { return validateWalletAddress(value); }
  catch { ctx.addIssue({ code: "custom", message: "Invalid wallet address: require HTTPS without credentials, ports, query, or fragment" }); return z.NEVER; }
});

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
