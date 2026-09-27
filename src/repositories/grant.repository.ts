import { logger } from "@/utils/logger";
// import { memoryDb } from "../config/database";
import { PendingGrant } from "@interledger/open-payments";

export const memoryDb = {
  pendingGrants: new Map<string, PendingGrant>(),
  finalTokens: new Map<string, string>(),
};
export class GrantRepository {
  public async savePending(
    transactionId: string,
    grant: PendingGrant,
  ): Promise<void> {
    memoryDb.pendingGrants.set(transactionId, grant);
    logger.info(`[DB] Saved pending grant for TX: ${transactionId}`);
  }

  public async getPending(transactionId: string): Promise<PendingGrant> {
    const grant = memoryDb.pendingGrants.get(transactionId) as PendingGrant;
    return grant;
  }

  public async deletePending(transactionId: string): Promise<void> {
    memoryDb.pendingGrants.delete(transactionId);
  }

  public async saveFinalToken(
    userId: string,
    accessToken: string,
  ): Promise<void> {
    memoryDb.finalTokens.set(userId, accessToken);
  }
}

export const grantRepository = new GrantRepository();
