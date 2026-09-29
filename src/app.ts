/**
 * @file app.ts
 * @description Express / Fastify application setup and middleware registration.
 *
 * Best Practices:
 * 1. Initialize the app instance (e.g. `const app = express()`).
 * 2. Attach security headers early using libraries like `helmet`.
 * 3. Configure CORS policies with restricted origins in production.
 * 4. Parse incoming payloads (`express.json()`, `express.urlencoded()`).
 * 5. Attach request logging and rate limiting middlewares.
 * 6. Mount primary route entry points (e.g. `/api/v1`).
 * 7. Mount the centralized 404 handler and error-handling middleware last.
 * 8. Export the app instance without calling `.listen()`.
 */

import express, { Application, Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import { createRouter } from "./routes/index";
import { errorMiddleware } from "./middlewares/error.middleware";
import { AppError } from "./utils/appError";
import { httpLogger } from "./middlewares/logger.middleware";
import { createUserRepository } from "./repositories/user.repository";
import { createAuthService } from "./services/auth.service";
import { createAuthController } from "./controllers/auth.controller";
import { createRequireAuth } from "./middlewares/auth.middleware";
import { OnboardingService } from "./services/onboarding.service";
import { OnboardingRepository } from "./repositories/onboarding.repository";
import { AppDependencies } from "./types";
import { redisClient } from "./config/redis";
import { getOpenPaymentsClient } from "@/utils/open-payment";
import { GrantRepository } from "./repositories/grant.repository";
import { logger } from "./utils/logger";
import { env } from "./config/env";
import { OnboardingController } from "./controllers/onboarding.controller";
import { WalletService } from "./services/wallet.service";
import { createWalletController } from "./controllers/wallet.controller";
import { createOnboardingConfig } from "./config/onboarding";
import { TransferRepository } from "./repositories/transfer.repository";
import { PaymentSessionRepository } from "./repositories/payment-session.repository";
import { TransferService } from "./services/transfer.service";
import { createPaymentRateLimits } from "./middlewares/rateLimiter.middleware";
import { TransferController } from "./controllers/transfer.controller";

export const createApp = ({ db, redis }: AppDependencies): Application => {
  const app = express();

  app.use(httpLogger);
  // Middlewares
  app.use(helmet());
  app.set("trust proxy", env.TRUSTED_PROXY_CIDRS.split(",").map((s) => s.trim()).filter(Boolean));
  app.use(cors({ origin: env.CORS_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean) }));
  app.use(express.json());

  const userRepository = createUserRepository(db);
  const grantRepository = new GrantRepository({ db });
  const onboardingRepository = new OnboardingRepository({
    redis: redis ?? redisClient,
  });
  const authService = createAuthService({
    userRepository
  });
  const authController = createAuthController({
    authService
  })
  const requireAuth = createRequireAuth({
    userRepository,
  });

  const onboardingService = new OnboardingService({
    onboardingRepository,
    grantRepository,
    getOpenPaymentsClient,
    logger,
    config: createOnboardingConfig({
      apiPublicUrl: env.API_PUBLIC_URL,
      webReturnUrl: env.ONBOARDING_WEB_RETURN_URL,
      mobileReturnUrl: env.ONBOARDING_MOBILE_RETURN_URL,
      allowLocalHttp: env.NODE_ENV !== "production",
    }),
  });
  const onboardingController = new OnboardingController(onboardingService);
  const walletService = new WalletService({ grantRepository, getOpenPaymentsClient });
  const walletController = createWalletController(walletService);
  const rateLimits = createPaymentRateLimits(redis ?? redisClient);
  const transferService = new TransferService({
    transferRepository: new TransferRepository(db),
    paymentSessionRepository: new PaymentSessionRepository({
      redis: redis ?? redisClient, encryptionKey: env.GRANT_ENCRYPTION_KEY,
    }),
    getOpenPaymentsClient,
    consumeWalletLimit: rateLimits.wallet,
    apiPublicUrl: env.API_PUBLIC_URL,
  });
  const transferController = new TransferController(transferService);

  // Routes
  app.use("/", createRouter({
    authController,
    onboardingController,
    walletController,
    transferController,
    rateLimits,
    requireAuth
  }));

  // Catch 404 (Route Not Found) and pass to error handler
  app.use((req: Request, _res: Response, next: NextFunction) => {
    next(new AppError(`Route ${req.method} ${req.originalUrl.split("?")[0]} not found`, 404));
  });

  app.use(errorMiddleware);
  return app;
}
