import { Router, Request, Response, RequestHandler } from "express";
import type { createWalletController } from "@/controllers/wallet.controller";

export const createWalletRouter = (requireAuth: RequestHandler, walletController: ReturnType<typeof createWalletController>) => {
const router = Router();

router.get("/", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  next();
}, requireAuth, walletController.listLinkedWallets);

// Route: GET /api/v1/urls/shorten?url=https://...
router.post("/verify", walletController.verifyWalletAddress);
// Grant creation is available only through authenticated onboarding.
// All grant callbacks go through onboarding's verified callback handler.

/**
 * GET /health (or /health/live)
 * Liveness probe - lightweight check to confirm the HTTP process is responsive.
 */
router.get("/redirect", (_req: Request, res: Response) => {
  res.status(200).json({
    status: "Test route for grant request redirect!",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

return router;
};
