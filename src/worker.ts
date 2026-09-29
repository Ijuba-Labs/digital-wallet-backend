import db from "./config/database";
import { env } from "./config/env";
import { redisClient, disconnectRedis } from "./config/redis";
import { TransferRepository } from "./repositories/transfer.repository";
import { PaymentSessionRepository } from "./repositories/payment-session.repository";
import { TransferService } from "./services/transfer.service";
import { getOpenPaymentsClient } from "./utils/open-payment";
import { logger } from "./utils/logger";
import { assertEncryptionKeys } from "./utils/encryption-audit";

const service = new TransferService({
  transferRepository: new TransferRepository(db),
  paymentSessionRepository: new PaymentSessionRepository({ redis: redisClient }), getOpenPaymentsClient, apiPublicUrl: env.API_PUBLIC_URL
});

let stopping = false;
let wake: (() => void) | undefined;

for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { stopping = true; wake?.(); });

async function run() {
  await assertEncryptionKeys(db);
  logger.info({ event: "worker_started", concurrency: 4 }, "Payment recovery worker started");
  // PostgreSQL claims distribute work across processes; Redis availability is not required for reconciliation.
  while (!stopping) {
    const outcomes = await Promise.allSettled(Array.from({ length: 4 }, () => service.processNext()));
    for (const result of outcomes) if (result.status === "rejected") logger.error({ event: "worker_operation_failed" }, "Payment worker operation failed; retrying after lease release");
    if (!stopping) await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { wake = undefined; resolve(); }, 5000);
      wake = () => { clearTimeout(timer); wake = undefined; resolve(); };
    });
  }
}

try { await run(); }
catch { logger.fatal({ event: "worker_start_failed" }, "Could not start payment worker"); process.exitCode = 1; }
finally { await disconnectRedis().catch(() => { }); await db.destroy(); }
