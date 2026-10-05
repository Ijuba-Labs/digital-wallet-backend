import type { PaymentRateLimits } from "@/middlewares/rateLimiter.middleware";
import { Router, RequestHandler } from "express";
import type { OnboardingController } from "@/controllers/onboarding.controller";

export const createOnboardingRouter = (requireAuth: RequestHandler, onboardingController: OnboardingController,
  limits: PaymentRateLimits) => {
  const router = Router();

  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    next();
  });

  // The authorization server calls back without the app's bearer token.
  router.get("/callback", limits.callback, onboardingController.handleCallback);

  router.use(requireAuth);
  router.post("/start", onboardingController.startOnboarding);
  router.post("/:sessionId/consent", onboardingController.requestConsent);
  router.get("/:sessionId/status", onboardingController.getStatus);
  router.delete("/:sessionId", onboardingController.cancel);
  router.get("/success", onboardingController.getStatus);

  return router;
};
