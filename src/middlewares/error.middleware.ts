/**
 * @file error.middleware.ts
 * @description Centralized application error handling middleware.
 *
 * Best Practices:
 * 1. Must have the 4-argument signature `(err, req, res, next)` in Express to be recognized as an error handler.
 * 2. Distinguish between operational errors (known application exceptions with status codes) and programmer/unexpected bugs (500 Internal Server Error).
 * 3. Log unexpected 500 errors with full stack traces; hide sensitive internal details/stack traces from clients in production.
 * 4. Return structured, consistent JSON error responses (e.g. `{ success: false, error: { message, code, details } }`).
 */

import { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/appError";
import { sendError } from "../utils/apiResponse";
// import { logger } from '../utils/logger.js';

function errorMiddleware(
  err: Error | AppError,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction,
): void {
  // Identify operational errors vs unexpected bugs
  const isAppError = err instanceof AppError;
  const statusCode = isAppError ? err.statusCode : 500;
  const message =
    isAppError ? err.message : "Internal Server Error";
  const details = isAppError ? err.details : undefined;

  // Never log callback queries, provider payloads, or credential-bearing errors.
  const path = req.originalUrl.split("?")[0];
  console.error({ method: req.method, path, statusCode, error: isAppError ? message : "Unhandled error" });
  if (isAppError && statusCode === 429 && details && typeof details === "object" && "retryAfter" in details) {
    res.setHeader("Retry-After", String(details.retryAfter));
  }

  // Send uniform JSON error response via apiResponse helper
  sendError(res, message, statusCode, details);
}
export { errorMiddleware };
