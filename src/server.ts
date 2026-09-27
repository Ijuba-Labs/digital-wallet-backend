/**
 * @file server.ts
 * @description Server entry point and process lifecycle management.
 *
 * Best Practices:
 * 1. Keep server bootstrap separate from application configuration (`app.ts`) to enable integration testing without starting network listeners.
 * 2. Connect to databases, caches, and background message queues before listening on the port.
 * 3. Handle process signals (SIGTERM, SIGINT) for graceful shutdown (finish in-flight HTTP requests, close open sockets and database connections).
 * 4. Catch `uncaughtException` and `unhandledRejection` to log critical failures before exiting cleanly.
 */
import http from "node:http";
// import { app } from "./app";
import { env } from "./config/env";
import { logger } from "./utils/logger";
import { connectRedis, disconnectRedis } from "./config/redis";
import { createApp } from "./app";
import knexClient from "./config/database";

const app = createApp(knexClient);

const server = http.createServer(app);

async function startServer(): Promise<void> {
  try {

    await connectRedis();

    server.listen(env.PORT, () => {
      logger.info(`Server running in ${env.NODE_ENV} mode on port ${env.PORT}`);
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to start server");
    process.exit(1);
  }
}


// Graceful Shutdown Handler
function setupGracefulShutdown(): void {
  const signals: NodeJS.Signals[] = ["SIGTERM", "SIGINT"];

  for (const signal of signals) {
    process.on(signal, async () => {
      logger.info(`Received ${signal}, initiating graceful shutdown...`);

      await disconnectRedis();

      server.close(async (err) => {
        if (err) {
          logger.error({ err }, "Error closing HTTP server");
          process.exit(1);
        }

        try {
          // Disconnect DB and clean up open handles
          // await disconnectDB();
          logger.info("Clean shutdown complete.");
          process.exit(0);
        } catch (cleanupErr) {
          logger.error({ err: cleanupErr }, "Error during cleanup");
          process.exit(1);
        }
      });

      // Force exit after timeout if open connections hang
      setTimeout(() => {
        logger.error("Forced shutdown due to timeout");
        process.exit(1);
      }, 10000).unref();
    });
  }

  // Handle unexpected crashes
  process.on("uncaughtException", (error) => {
    logger.fatal({ err: error }, "Uncaught Exception");
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    logger.fatal({ reason }, "Unhandled Promise Rejection");
    process.exit(1);
  });
}

setupGracefulShutdown();
void startServer();
