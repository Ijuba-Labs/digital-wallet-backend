/**
 * @file logger.ts
 * @description Structured application logger instance (e.g. Pino or Winston).
 *
 * Best Practices:
 * 1. Output structured JSON logs in production for ingestion into monitoring systems (Datadog, CloudWatch, ELK).
 * 2. Use colorized, human-readable formatting in local development (`pino-pretty`).
 * 3. Support log levels: `trace`, `debug`, `info`, `warn`, `error`, `fatal`.
 * 4. Never use raw `console.log` in production code.
 */
import pino from "pino";
import { env } from "../config/env.js";

const logger = pino({
  level: env.LOG_LEVEL || (env.NODE_ENV === "production" ? "info" : "debug"),
  // Pretty-print only in development
  transport:
    env.NODE_ENV !== "production"
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:yyyy-mm-dd HH:MM:ss",
            ignore: "pid,hostname,req,res",
          },
        }
      : undefined,
  // Standard redact list to prevent accidental credential leakage
  redact: { paths: ["membershipNumber", "barcodePayload", "cardNumber", "barcodeValue", "*.membershipNumber", "*.barcodePayload", "*.cardNumber", "*.barcodeValue", "req.body", "res.body", "req.headers.authorization", "password", "token", "creditCard", "accessToken", "access_token", "pendingGrant", "token_enc", "*.access_token", "*.accessToken", "*.token_enc"], censor: "[REDACTED]" },
});
export { logger };
