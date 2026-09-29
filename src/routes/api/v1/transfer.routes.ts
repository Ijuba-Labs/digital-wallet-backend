import type { PaymentRateLimits } from "@/middlewares/rateLimiter.middleware";
import { Router, type RequestHandler } from "express";
import type { TransferController } from "@/controllers/transfer.controller";

export const createTransferRouter = (requireAuth: RequestHandler, controller: TransferController, limits: PaymentRateLimits) => {
  const router = Router();
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    next();
  });
  // The provider's browser redirect uses GNAP proof verification, not an app JWT.
  router.get("/callback", limits.callback, controller.handleCallback);
  router.use(requireAuth);
  router.post("/", limits.create, controller.create);
  router.get("/", limits.status, controller.list);
  router.get("/:id", limits.status, controller.get);
  return router;
};
