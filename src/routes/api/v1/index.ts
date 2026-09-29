import { Router } from "express";
import { RouterDependencies } from "@/types/auth";
import { createAuthRouter } from "./auth/auth.routes";
import { urlRouter } from "./url.routes";
import { redisRouter } from "./redis.routes";
import { createWalletRouter } from "./wallet.routes";
import { createOnboardingRouter } from "./onboarding.routes";
import { createTransferRouter } from "./transfer.routes";

export const createV1Router = ({ authController, onboardingController, walletController, transferController, rateLimits, requireAuth }: RouterDependencies) => {
  const router = Router();

  router.use("/auth", createAuthRouter(authController));
  router.use("/urls", urlRouter);
  router.use("/redis", redisRouter);
  router.use("/wallet", createWalletRouter(requireAuth, walletController));
  router.use("/onboarding", createOnboardingRouter(requireAuth, onboardingController, rateLimits));
  router.use("/transfers", createTransferRouter(requireAuth, transferController, rateLimits));

  return router;
};
