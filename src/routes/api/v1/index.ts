import { Router } from "express";
import { urlRouter } from "./url.routes";
import { walletRouter } from "./wallet.routes";
import { onboardingRouter } from "./onboarding.routes";
import { redisRouter } from "./redis.routes";
import { createAuthRouter } from "./auth/auth.routes";
import { RouterDependencies } from "@/types/auth";

const router = Router();

// Mount domain routes
// All routes in urlRouter will be prefixed with /urls (e.g. /api/v1/urls/shorten)
router.use("/urls", urlRouter);
router.use("/redis", redisRouter);
// router.use(requireAuth);
router.use("/wallet", walletRouter);

// Onboarding routes
router.use("/onboarding", onboardingRouter);

export { router as v1Router };

export const createV1Router = ({ authController, requireAuth }: RouterDependencies) => {
    const router = Router();

    // Auth routes
    router.use("/auth", createAuthRouter(authController));

    return router;
};