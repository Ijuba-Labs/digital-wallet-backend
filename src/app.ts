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
// import helmet from "helmet";
import { createRouter, router } from "./routes/index";
import { errorMiddleware } from "./middlewares/error.middleware";
import { AppError } from "./utils/appError";
import { httpLogger } from "./middlewares/logger.middleware";
import { createUserRepository } from "./repositories/user.repository";
import { Knex } from "knex";
import { createAuthService } from "./services/auth.service";
import { createAuthController } from "./controllers/auth.controller";
import { createRequireAuth } from "./middlewares/auth.middleware";

export const app: Application = express();


export const createApp = (db: Knex): Application => {
  const app = express();

  app.use(express.json());

  app.use(httpLogger);
  // Middlewares
  // app.use(helmet());
  app.use(cors());
  app.use(express.json());

  const userRepository = createUserRepository(db);

  const authService = createAuthService({
    userRepository
  });

  const authController = createAuthController({
    authService
  })

  const requireAuth = createRequireAuth({
    userRepository,
  });

  // Routes
  app.use("/", createRouter({
    authController,
    requireAuth
  }));

  // Catch 404 (Route Not Found) and pass to error handler
  app.use((req: Request, _res: Response, next: NextFunction) => {
    next(new AppError(`Route ${req.method} ${req.originalUrl} not found`, 404));
  });

  app.use(errorMiddleware);
  return app;
}