import { beforeAll, afterAll, describe, expect, it } from "@jest/globals";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import type { Knex } from "knex";
import { createTestDatabase } from "../../tests/database";
import { TransferRepository } from "./transfer.repository";
import type { TransferStatus } from "@/types/transfer";

describe("Durable transfer cancellation", () => {
  let db: Knex;
  let repository: TransferRepository;
  const users = [randomUUID(), randomUUID()];
  const wallets = [randomUUID(), randomUUID()];
  const ids: string[] = [];
  const wallet = (id: string) => ({ id: `https://provider.example/${id}`, assetCode: "ZAR", assetScale: 2,
    authServer: "https://provider.example/auth", resourceServer: "https://provider.example" });
  beforeAll(async () => {
    db = await createTestDatabase(); repository = new TransferRepository(db);
    // Also verifies upgrading a pre-cancellation baseline preserves records.
    await createRequire(import.meta.url)("../database/knex-migrations/202610050002_transfer_cancellation.cjs").up(db);
    await db("users").insert(users.map(id => ({ id, email: `${id}@example.test` })));
    await db("wallets").insert(wallets.map((id, i) => ({ id, user_id: users[i], wallet_address_url: wallet(id).id,
      asset_code: "ZAR", asset_scale: 2, auth_server: wallet(id).authServer, resource_server: wallet(id).resourceServer })));
  });
  afterAll(async () => {
    if (db) {
      await db("transfers").whereIn("id", ids).del();
      await db("users").whereIn("id", users).del(); await db.destroy();
    }
  });
  async function reserve(status: TransferStatus = "CREATING") {
    const id = randomUUID(); ids.push(id);
    await repository.reserve({ id, sender_user_id: users[0]!, recipient_user_id: users[1]!,
      sender_wallet_id: wallets[0]!, recipient_wallet_id: wallets[1]!,
      sender_wallet: wallet(wallets[0]!), recipient_wallet: wallet(wallets[1]!),
      idempotency_key: id, request_hash: "a".repeat(64), description: null,
      debit_amount: { value: "1000", assetCode: "ZAR", assetScale: 2 }, expires_at: new Date(Date.now() + 60000) });
    await db("transfers").where({ id }).update({ status });
    return id;
  }
  it("cancels all pre-approval states despite an active lease and fences approval", async () => {
    for (const status of ["CREATING", "AWAITING_AUTHORIZATION", "FINALIZING"] as const) {
      const id = await reserve(status); const owner = randomUUID();
      await repository.claim(id, owner);
      const row = await repository.cancel(id, users[0]!);
      expect(row).toMatchObject({ status: "CANCELLED", lease_owner: owner, error_code: "USER_CANCELLED", cleanup_state: "PENDING" });
      expect(await repository.transition(id, owner, [status], { status: "AUTHORIZED" })).toBeUndefined();
      expect(await repository.claim(id, randomUUID())).toBeUndefined();
      await repository.release(id, owner);
      expect(await repository.claim(id, randomUUID())).toMatchObject({ status: "CANCELLED" });
    }
  });
  it("cannot cancel another sender or any approved/submitted/ended state", async () => {
    const own = await reserve();
    expect(await repository.cancel(own, users[1]!)).toBeUndefined();
    for (const status of ["AUTHORIZED", "SUBMITTING", "PENDING", "UNKNOWN", "COMPLETED", "FAILED", "EXPIRED"] as const) {
      const id = await reserve(status);
      expect(await repository.cancel(id, users[0]!)).toBeUndefined();
      expect((await repository.findById(id))?.status).toBe(status);
    }
  });
  it("approval and cancellation have exactly one winner when racing", async () => {
    for (let i = 0; i < 6; i++) {
      const id = await reserve("FINALIZING"); const owner = randomUUID();
      await repository.claim(id, owner);
      const [approval, cancellation] = await Promise.all([
        repository.transition(id, owner, ["FINALIZING"], { status: "AUTHORIZED" }),
        repository.cancel(id, users[0]!),
      ]);
      expect(Number(Boolean(approval)) + Number(Boolean(cancellation))).toBe(1);
      expect((await repository.findById(id))?.status).toBe(approval ? "AUTHORIZED" : "CANCELLED");
    }
  });
});
