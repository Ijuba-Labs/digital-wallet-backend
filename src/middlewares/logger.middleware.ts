/**
 * @file logger.middleware.ts
 * @description HTTP request/response logging middleware.
 *
 * Best Practices:
 * 1. Log essential request details: HTTP method, URL path, status code, response time, and user-agent.
 * 2. Attach a unique request ID (correlation ID via `X-Request-Id` header) to trace requests through log streams.
 * 3. Never log sensitive information such as passwords, auth tokens, or payment card numbers (sanitize/redact fields).
 * 4. Leverage production-ready logging libraries like `pino-http` or `morgan`.
 */
import { pinoHttp } from "pino-http";
import crypto from "node:crypto";
import { logger } from "../utils/logger.js";

const httpLogger = pinoHttp({
  logger,
  // Callback query strings contain interaction proofs; do not persist them in logs.
  serializers: {
    req: (req) => ({ id: req.id, method: req.method, url: req.url?.split("?")[0] }),
  },
  // Use existing header or generate a new UUID for tracing
  genReqId: (req) =>
    (req.headers["x-request-id"] as string) || crypto.randomUUID(),
  customLogLevel: (_req, res, err) => {
    if (res.statusCode >= 500 || err) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
  customSuccessMessage: (req, res) =>
    `${req.method} ${req.url?.split("?")[0]} completed with ${res.statusCode}`,
  customErrorMessage: (req, res, err) =>
    `${req.method} ${req.url?.split("?")[0]} failed with ${res.statusCode}: ${err.message}`,
});
export { httpLogger };
