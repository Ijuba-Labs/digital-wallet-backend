import { Router, Request, Response } from "express";
import { createV1Router, v1Router } from "./api/v1/index";
import { RouterDependencies } from "@/types/auth";
import { createAuthRouter } from "./api/v1/auth/auth.routes";
// import { checkDatabaseHealth } from '../config/database.js';

export const router = Router();

export const createRouter = ({ authController, requireAuth }: RouterDependencies) => {
  const router = Router();

  /**
 * API Version 1
 */
  router.use(
    "/api/v1",
    createV1Router({
      authController,
      requireAuth
    })
  );

  /**
  * Liveness probe
  */
  router.get(
    "/health",
    (_req: Request, res: Response) => {
      res.status(200).json({
        status: "ok",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      });
    }
  );

  /**
   * Readiness probe
   */
  router.get(
    "/health/ready",
    async (_req: Request, res: Response) => {
      try {
        // await checkDatabaseHealth();

        res.status(200).json({
          status: "ready",
          timestamp: new Date().toISOString(),
          services: {
            database: "up",
          },
        });
      } catch (error) {
        res.status(503).json({
          status: "unavailable",
          timestamp: new Date().toISOString(),
          services: {
            database: "down",
          },
          error:
            error instanceof Error
              ? error.message
              : "Dependency failure",
        });
      }
    }
  );

  return router;
};