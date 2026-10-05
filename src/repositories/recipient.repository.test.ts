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
