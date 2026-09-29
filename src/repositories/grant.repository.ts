import type { GrantRepositoryDependencies, SaveOwnershipInput, FinalizedOwnership } from "@/types/grant";
import type { LinkedWallet } from "@/types/wallet";
import { AppError } from "@/utils/appError";

export class GrantRepository {
  constructor(private readonly deps: GrantRepositoryDependencies) {}
  async listLinkedWallets(userId: string): Promise<LinkedWallet[]> {
    return this.deps.db("wallets").where({ user_id: userId }).whereNotNull("verified_at")
      .select("id", "wallet_address_url as walletAddressUrl", "public_name as publicName", "asset_code as assetCode",
        "asset_scale as assetScale", "status", "is_default as isDefault", "verified_at as verifiedAt", "created_at as createdAt", "updated_at as updatedAt")
      .orderBy("is_default", "desc").orderBy("created_at", "desc").orderBy("id", "asc");
  }
  async getFinalized(transactionId: string): Promise<FinalizedOwnership | undefined> {
    return this.deps.db("wallet_grants as g").join("wallets as w", "w.id", "g.wallet_id")
      .where({ "g.transaction_id": transactionId, "g.purpose": "ONBOARDING" })
      .first("w.user_id as userId", "w.wallet_address_url as walletAddressUrl", "g.callback_fingerprint as callbackFingerprint",
        "g.verified_at as completedAt", "g.client_id as clientId", "g.return_url as returnUrl");
  }
  async saveOwnership(input: SaveOwnershipInput): Promise<void> {
    await this.deps.db.transaction(async (trx) => {
      const existing = await trx("wallet_grants as g").join("wallets as w", "w.id", "g.wallet_id")
        .where("g.transaction_id", input.transactionId).first("g.callback_fingerprint", "w.user_id");
      if (existing) {
        if (existing.callback_fingerprint !== input.callbackFingerprint || existing.user_id !== input.userId) throw new AppError("Ownership transaction conflict", 409);
        return;
      }
      const [wallet] = await trx("wallets").insert({ user_id: input.userId, wallet_address_url: input.wallet.id,
        asset_code: input.wallet.assetCode, asset_scale: input.wallet.assetScale, auth_server: input.wallet.authServer,
        resource_server: input.wallet.resourceServer, public_name: input.wallet.publicName ?? null, verified_at: trx.fn.now() })
        .onConflict(["user_id", "wallet_address_url"]).merge({ asset_code: input.wallet.assetCode, asset_scale: input.wallet.assetScale,
          auth_server: input.wallet.authServer, resource_server: input.wallet.resourceServer, public_name: input.wallet.publicName ?? null,
          verified_at: trx.fn.now(), updated_at: trx.fn.now(), status: "ACTIVE" }).returning<{ id: string }[]>("id");
      await trx("wallet_grants").insert({ wallet_id: wallet.id, transaction_id: input.transactionId, purpose: "ONBOARDING",
        verified_subject_uri: input.wallet.id, verified_at: trx.fn.now(), callback_fingerprint: input.callbackFingerprint,
        client_id: input.clientId, return_url: input.returnUrl, access: "[]" });
    });
  }
}
