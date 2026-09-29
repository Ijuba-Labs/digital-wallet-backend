import type { Knex } from "knex";
import type { CredentialPurpose, NewTransfer, TransferCredential, TransferRecord, TransferRepositoryInterface,
  TransferStatus, TransferUpdates, TransferWallet } from "@/types/transfer";
import { AppError } from "@/utils/appError";

export class TransferRepository implements TransferRepositoryInterface {
  constructor(private readonly db: Knex) {}
  async findWallet(userId: string, walletId?: string): Promise<TransferWallet | undefined> {
    const q = this.db("wallets as w").join("users as u", "u.id", "w.user_id")
      .where({ "w.user_id": userId, "w.status": "ACTIVE", "u.status": "ACTIVE" }).whereNotNull("w.verified_at");
    if (walletId) q.andWhere("w.id", walletId);
    return q.orderBy("w.is_default", "desc").orderBy("w.created_at", "desc").orderBy("w.id", "asc")
      .first<TransferWallet>("w.id", "w.wallet_address_url as walletAddressUrl", "w.asset_code as assetCode", "w.asset_scale as assetScale");
  }
  async findById(id: string): Promise<TransferRecord | undefined> { return this.db("transfers").where({ id }).first(); }
  async findByIdempotencyKey(userId: string, key: string): Promise<TransferRecord | undefined> {
    return this.db("transfers").where({ sender_user_id: userId, idempotency_key: key }).first();
  }
  async reserve(input: NewTransfer) {
    const [row] = await this.db("transfers").insert(input).onConflict(["sender_user_id", "idempotency_key"])
      .ignore().returning<TransferRecord[]>("*");
    if (row) return { transfer: row, created: true };
    const transfer = await this.findByIdempotencyKey(input.sender_user_id, input.idempotency_key);
    if (!transfer) throw new Error("Reserved transfer missing");
    return { transfer, created: false };
  }
  private available(q: Knex.QueryBuilder) {
    return q.where((b) => b.whereNull("lease_until").orWhere("lease_until", "<=", this.db.fn.now()));
  }
  async claim(id: string, owner: string): Promise<TransferRecord | undefined> {
    const [row] = await this.available(this.db("transfers").where({ id }))
      .update({ lease_owner: owner, lease_until: this.db.raw("now() + interval '60 seconds'") }).returning<TransferRecord[]>("*");
    return row;
  }
  async claimDue(owner: string): Promise<TransferRecord | undefined> {
    return this.db.transaction(async (trx) => {
      const row = await this.available(trx("transfers").where("next_attempt_at", "<=", trx.fn.now()))
        .orderBy("next_attempt_at").forUpdate().skipLocked().first<TransferRecord>();
      if (!row) return undefined;
      const [claimed] = await trx("transfers").where({ id: row.id })
        .update({ lease_owner: owner, lease_until: trx.raw("now() + interval '60 seconds'") }).returning<TransferRecord[]>("*");
      return claimed;
    });
  }
  async renew(id: string, owner: string): Promise<boolean> {
    return (await this.db("transfers").where({ id, lease_owner: owner }).where("lease_until", ">", this.db.fn.now())
      .update({ lease_until: this.db.raw("now() + interval '60 seconds'") })) === 1;
  }
  async release(id: string, owner: string): Promise<void> {
    await this.db("transfers").where({ id, lease_owner: owner }).update({ lease_owner: null, lease_until: null });
  }
  async transition(id: string, owner: string, expected: TransferStatus[], updates: TransferUpdates): Promise<TransferRecord | undefined> {
    const q = this.db("transfers").where({ id, lease_owner: owner }).where("lease_until", ">", this.db.fn.now()).whereIn("status", expected);
    if (updates.sent_amount) q.andWhereRaw("COALESCE((sent_amount->>'value')::numeric, 0) <= ?::numeric", [updates.sent_amount.value]);
    if (updates.received_amount) q.andWhereRaw("COALESCE((received_amount->>'value')::numeric, 0) <= ?::numeric", [updates.received_amount.value]);
    const [row] = await q.update({ ...updates, updated_at: this.db.fn.now(),
      ...(updates.status ? { state_changed_at: this.db.raw("CASE WHEN status = ? THEN state_changed_at ELSE now() END", [updates.status]) } : {}) }).returning<TransferRecord[]>("*");
    return row;
  }
  async credential(id: string, purpose: CredentialPurpose): Promise<TransferCredential | undefined> {
    return this.db("transfer_credentials").where({ transfer_id: id, purpose }).first();
  }
  private async withOwner(id: string, owner: string, operation: (trx: Knex.Transaction) => Promise<void>) {
    await this.db.transaction(async (trx) => {
      const row = await trx("transfers").where({ id, lease_owner: owner }).where("lease_until", ">", trx.fn.now()).forUpdate().first();
      if (!row) throw new AppError("Transfer lease lost", 409);
      await operation(trx);
    });
  }
  async saveCredential(id: string, owner: string, credential: TransferCredential, expectedGeneration?: number): Promise<void> {
    await this.withOwner(id, owner, async (trx) => {
      const data = { ...credential, access: JSON.stringify(credential.access) };
      if (expectedGeneration === undefined) {
        await trx("transfer_credentials").insert(data);
      } else {
        const changed = await trx("transfer_credentials").where({ transfer_id: id, purpose: credential.purpose, generation: expectedGeneration }).update(data);
        if (changed !== 1) throw new AppError("Credential generation changed", 409);
      }
    });
  }
  async clearCredential(id: string, owner: string, purpose: CredentialPurpose): Promise<void> {
    await this.withOwner(id, owner, async (trx) => { await trx("transfer_credentials").where({ transfer_id: id, purpose }).del(); });
  }
  async list(userId: string, limit: number, offset: number): Promise<TransferRecord[]> {
    return this.db("transfers").where((q) => q.where("sender_user_id", userId).orWhere("recipient_user_id", userId))
      .orderBy("created_at", "desc").orderBy("id", "desc").limit(limit).offset(offset).select("*");
  }
}
