import { Request, Response, NextFunction } from "express";
import { AppError } from "@/utils/appError";
import { sendSuccess, sendNoContent } from "@/utils/apiResponse";
import { logger } from "@/utils/logger";
import type { OnboardingService } from "@/services/onboarding.service";
import {
  startOnboardingSchema,
  callbackQuerySchema,
} from "@/validators/onboarding.validator";
import { idempotencyKeySchema } from "@/validators/transfer.validator";

export class OnboardingController {
  constructor(private readonly onboardingService: Pick<OnboardingService, "start" | "requestConsent" | "handleCallback" | "getStatus" | "cancel">) { }
  /**
   * POST /api/v1/onboarding/start
   * Begins the onboarding flow: creates session and resolves wallet.
   */
  startOnboarding = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      // 1. Validate input
      const parsed = startOnboardingSchema.safeParse(req.body);
      if (!parsed.success) {
        const msg = parsed.error.issues.map((i) => i.message).join(", ");
        throw new AppError(msg, 400, parsed.error.flatten().fieldErrors);
      }

      const userId = req.user?.id;
      if (!userId) throw new AppError("Access token is required", 401);
      const key = idempotencyKeySchema.optional().safeParse(req.get("Idempotency-Key"));
      if (!key.success) throw new AppError("Invalid Idempotency-Key", 400);
      // 3. Delegate to service
      const result = await this.onboardingService.start({
        walletAddressUrl: parsed.data.walletAddressUrl,
        clientId: parsed.data.clientId,
        userId,
        idempotencyKey: key.data,
      });

      // 4. Respond
      if (key.data) res.setHeader("Idempotency-Replayed", String(result.idempotencyReplayed ?? false));
      sendSuccess(res, result, result.idempotencyReplayed ? 200 : 201);
    } catch (error) {
      if (error instanceof AppError && error.statusCode === 503) res.setHeader("Retry-After", "2");
      next(error);
    }
  };
  /**
   * POST /api/v1/onboarding/:sessionId/consent
   * Requests GNAP grant and returns the redirect URL for user consent.
   */
  requestConsent = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const sessionId = req.params.sessionId as string;
      if (!sessionId) throw new AppError("sessionId is required", 400);

      const userId = req.user?.id;
      if (!userId) throw new AppError("Access token is required", 401);

      const result = await this.onboardingService.requestConsent(sessionId, userId);
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/v1/onboarding/callback
   * OAuth/GNAP callback — finalizes the grant after user consent.
   * Verifies the interaction and returns to the session's registered client.
   */
  handleCallback = async (
    req: Request,
    res: Response,
    _next: NextFunction,
  ): Promise<void> => {
    let invalidFields: string[] | undefined;
    try {
      const parsed = callbackQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        invalidFields = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? "query")))];
        throw new AppError("Invalid callback parameters", 400);
      }

      const { session_id, interact_ref, hash } = parsed.data;

      const result = await this.onboardingService.handleCallback(
        session_id,
        interact_ref,
        hash,
      );

      if (result.returnUrl) {
        const destination = new URL(result.returnUrl);
        destination.searchParams.set("session_id", result.sessionId);
        res.redirect(302, destination.href);
        return;
      }

      const processing = result.status === "FINALIZING";
      if (processing) {
        res.setHeader("Retry-After", "2");
        // The provider may require a second continuation after its wait period.
        // Revisit this same proof-bearing URL without reflecting it in HTML.
        res.setHeader("Refresh", "2");
      }
      res.status(processing ? 202 : 200).type("html").send(
        processing
          ? "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>Connecting your wallet</title></head><body><h1>Connecting your wallet</h1><p>Please keep this page open while we finish connecting your wallet. It will refresh automatically.</p></body></html>"
          : "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>Wallet connected</title></head><body><h1>Authorization received</h1><p>Your wallet is connected. Close this browser tab and return to your app.</p></body></html>",
      );
    } catch (error) {
      // Unverified callbacks never select a destination or expose provider errors.
      const statusCode = error instanceof AppError ? error.statusCode : 500;
      const reason = error instanceof AppError ? ({
        "Invalid onboarding callback": "hash_mismatch",
        "Callback proof mismatch": "callback_proof_mismatch",
        "Onboarding interaction state unavailable": "interaction_state_missing",
        "Onboarding expired": "session_expired",
        "Onboarding not found": "session_not_found",
        "Interaction consumed": "callback_replay",
        "Consent unavailable": "consent_unavailable",
        "Onboarding state changed": "state_conflict",
        "Ownership verification failed; check onboarding status": "grant_continuation_failed",
        "Invalid callback parameters": "invalid_callback_parameters",
      } as Record<string, string>)[error.message] ?? "invalid_callback_request" : "internal_error";
      const candidate = req.query.session_id;
      const sessionId = typeof candidate === "string" && /^onb_[0-9a-fA-F-]{36}$/.test(candidate) ? candidate : undefined;
      const hash = req.query.hash;
      const hashFormat = typeof hash !== "string" ? "missing" : /^[A-Za-z0-9_-]{43}$/.test(hash) ? "base64url"
        : /^[A-Za-z0-9+/]{43}=?$/.test(hash) ? "base64" : "invalid";
      logger.warn({ event: "onboarding_callback_failed", reason, statusCode,
        ...(sessionId ? { sessionId } : {}), ...(reason === "hash_mismatch" ? { hashFormat } : {}),
        ...(invalidFields ? { invalidFields,
          presentFields: ["session_id", "interact_ref", "hash"].filter((field) => Object.hasOwn(req.query, field)) } : {}) },
        "Wallet authorization callback rejected");
      res.status(statusCode).type("html").send(
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>Wallet authorization</title></head><body><h1>Unable to complete authorization</h1><p>Return to your application to check status or start a new onboarding session.</p></body></html>",
      );
    }
  };

  /**
   * GET /api/v1/onboarding/:sessionId/status
   * Polls the current onboarding session status.
   */
  getStatus = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const sessionId = (req.params.sessionId ?? req.query.session_id) as string;
      if (!sessionId) throw new AppError("sessionId is required", 400);

      const userId = req.user?.id;
      if (!userId) throw new AppError("Access token is required", 401);

      const result = await this.onboardingService.getStatus(sessionId, userId);
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  cancel = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.id) throw new AppError("Access token is required", 401);
      await this.onboardingService.cancel(String(req.params.sessionId), req.user.id);
      sendNoContent(res);
    } catch (error) { next(error); }
  };
}
