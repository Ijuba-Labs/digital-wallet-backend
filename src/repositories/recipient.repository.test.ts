import { beforeAll, afterAll, describe, expect, it } from "@jest/globals";
import { randomUUID } from "node:crypto";
import type { Knex } from "knex";
import { createTestDatabase } from "../../tests/database";
import { RecipientRepository } from "./recipient.repository";

describe("Recipient search database eligibility", () => {
  let db: Knex;
  let repository: RecipientRepository;
  const ids = Array.from({ length: 9 }, () => randomUUID());
  beforeAll(async () => {
    db = await createTestDatabase();
    repository = new RecipientRepository(db);
    await db("users").insert(ids.map((id, i) => ({ id, first_name: i === 7 ? "Sip%ho" : i === 8 ? "Sip_ho" : "Sipho",
      last_name: `Dlamini ${i}`, email: `recipient-${id}@example.test`, phone_number: i === 1 ? "+27 (82) 123-4567" : null,
      password_hash: "secret", status: i === 2 ? "SUSPENDED" : i === 3 ? "PENDING_VERIFICATION" : "ACTIVE" })));
    await db("wallets").insert(ids.filter((_, i) => i !== 4).map((id) => ({ user_id: id,
      wallet_address_url: `https://wallet.example/${id}`, asset_code: "ZAR", asset_scale: 2,
      auth_server: "https://auth.example", resource_server: "https://resource.example",
      status: id === ids[5] ? "UNLINKED" : "LINKED", verified_at: id === ids[6] ? null : new Date() })));
    await db("wallets").insert({ user_id: ids[1], wallet_address_url: `https://wallet.example/${randomUUID()}`,
      asset_code: "ZAR", asset_scale: 2, auth_server: "https://auth.example", resource_server: "https://resource.example",
      status: "LINKED", verified_at: new Date() });
  });
  afterAll(async () => {
    if (db) { await db("users").whereIn("id", ids).del(); await db.destroy(); }
  });

  it("excludes self, inactive users, missing/unlinked/unverified wallets and duplicate wallets", async () => {
    expect(await repository.search(ids[0]!, { kind: "name", value: "sipho" }, 20)).toEqual([
      { recipientUserId: ids[1], displayName: "Sipho Dlamini 1" },
    ]);
  });
  it("supports full and reversed name prefixes with deterministic bounded results", async () => {
    const result = await repository.search(ids[0]!, { kind: "name", value: "dlamini" }, 2);
    expect(result).toHaveLength(2);
    expect(result).toEqual(await repository.search(ids[0]!, { kind: "name", value: "dlamini" }, 2));
    expect(await repository.search(ids[0]!, { kind: "name", value: "sipho dla" }, 10)).toHaveLength(1);
  });
  it("matches complete contacts only and returns no contact or wallet secrets", async () => {
    const email = `recipient-${ids[1]}@example.test`;
    const expected = [{ recipientUserId: ids[1], displayName: "Sipho Dlamini 1" }];
    expect(await repository.search(ids[0]!, { kind: "email", value: email }, 10)).toEqual(expected);
    expect(await repository.search(ids[0]!, { kind: "email", value: email.slice(0, -1) }, 10)).toEqual([]);
    expect(await repository.search(ids[0]!, { kind: "phone", value: "27821234567" }, 10)).toEqual(expected);
    expect(await repository.search(ids[0]!, { kind: "phone", value: "0821234567" }, 10)).toEqual([]);
  });
  it("treats SQL wildcards and injection strings literally", async () => {
    expect(await repository.search(ids[0]!, { kind: "name", value: "sip%" }, 10)).toEqual([
      { recipientUserId: ids[7], displayName: "Sip%ho Dlamini 7" },
    ]);
    expect(await repository.search(ids[0]!, { kind: "name", value: "sip_" }, 10)).toEqual([
      { recipientUserId: ids[8], displayName: "Sip_ho Dlamini 8" },
    ]);
    expect(await repository.search(ids[0]!, { kind: "name", value: "sip\\" }, 10)).toEqual([]);
    expect(await repository.search(ids[0]!, { kind: "name", value: "' OR 1=1 --" }, 10)).toEqual([]);
  });
});

describe("Recent recipients database history", () => {
  let db: Knex;
  let repository: RecipientRepository;
  const users = Array.from({ length: 11 }, () => randomUUID());
  const wallets = users.map(() => randomUUID());
  const transfers: string[] = [];
  const expected = (i: number) => ({ recipientUserId: users[i], displayName: `Recent ${i}` });
  async function transfer(sender: number, recipient: number, status: string, time: number, completed = true) {
    const id = randomUUID(); transfers.push(id);
    await db("transfers").insert({ id, sender_user_id: users[sender], recipient_user_id: users[recipient],
      sender_wallet_id: wallets[sender], recipient_wallet_id: wallets[recipient], sender_wallet: {}, recipient_wallet: {},
      idempotency_key: id, request_hash: "a".repeat(64), debit_amount: { value: "1000", assetCode: "ZAR", assetScale: 2 },
      status, expires_at: new Date("2027-01-01"), created_at: new Date(`2026-01-${String(time).padStart(2, "0")}T00:00:00Z`),
      completed_at: completed ? new Date(`2026-02-${String(time).padStart(2, "0")}T00:00:00Z`) : null });
  }
  beforeAll(async () => {
    db = await createTestDatabase(); repository = new RecipientRepository(db);
    await db("users").insert(users.map((id, i) => ({ id, first_name: "Recent", last_name: String(i),
      email: `${id}@example.test`, status: i === 4 ? "SUSPENDED" : "ACTIVE" })));
    await db("wallets").insert(users.map((id, i) => ({ id: wallets[i], user_id: id,
      wallet_address_url: `https://wallet.example/${wallets[i]}`, asset_code: "ZAR", asset_scale: 2,
      auth_server: "https://auth.example", resource_server: "https://resource.example",
      status: i === 5 ? "UNLINKED" : "LINKED", verified_at: i === 6 ? null : new Date() })));
    await db("wallets").insert({ user_id: users[2], wallet_address_url: `https://wallet.example/${randomUUID()}`,
      asset_code: "ZAR", asset_scale: 2, auth_server: "https://auth.example", resource_server: "https://resource.example",
      status: "LINKED", verified_at: new Date() });
    await transfer(0, 1, "COMPLETED", 10);
    await transfer(0, 2, "COMPLETED", 5);
    await transfer(0, 2, "COMPLETED", 20);
    for (const status of ["CREATING", "AWAITING_AUTHORIZATION", "FINALIZING", "AUTHORIZED", "SUBMITTING", "PENDING", "FAILED", "EXPIRED", "UNKNOWN", "CANCELLED"])
      await transfer(0, 3, status, 25);
    for (const i of [4, 5, 6]) await transfer(0, i, "COMPLETED", 25);
    await transfer(7, 8, "COMPLETED", 25);
    await transfer(8, 0, "COMPLETED", 25);
    await transfer(0, 9, "COMPLETED", 22);
    await transfer(0, 10, "COMPLETED", 22);
  });
  afterAll(async () => {
    if (db) {
      await db("transfers").whereIn("id", transfers).del();
      await db("users").whereIn("id", users).del();
      await db.destroy();
    }
  });
  it("deduplicates recipients and wallets, filters eligibility and isolates completed outgoing history", async () => {
    const tied = [9, 10].sort((a, b) => users[a]!.localeCompare(users[b]!));
    expect(await repository.recent(users[0]!, 20)).toEqual([...tied.map(expected), expected(2), expected(1)]);
  });
  it("applies the limit after deduplication with stable ordering", async () => {
    const first = await repository.recent(users[0]!, 2);
    expect(first).toEqual((await repository.recent(users[0]!, 20)).slice(0, 2));
    expect(await repository.recent(users[0]!, 2)).toEqual(first);
  });
  it("returns an empty list for a user with no completed outgoing transfers", async () => {
    expect(await repository.recent(users[1]!, 10)).toEqual([]);
  });
  it("uses the creation timestamp if a legacy completed transfer has no completion timestamp", async () => {
    await transfer(1, 2, "COMPLETED", 15, false);
    expect(await repository.recent(users[1]!, 10)).toEqual([expected(2)]);
  });
});
