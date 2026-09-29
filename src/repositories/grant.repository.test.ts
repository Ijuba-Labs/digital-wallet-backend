import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";
import { randomUUID } from "node:crypto";
import type { Knex } from "knex";
import type { GrantWithAccessToken, PendingGrant, WalletAddress } from "@interledger/open-payments";
import { createTestDatabase } from "../../tests/database";
import { GrantRepository } from "./grant.repository";
import { createGrantCipher } from "@/utils/grant-encryption";
import { getWalletGrantScope } from "@/utils/grant-access";
import { env } from "@/config/env";

const wallet: WalletAddress = {
  id: "https://wallet.example/alice",
  assetCode: "ZAR",
  assetScale: 2,
  authServer: "https://auth.example",
  resourceServer: "https://resource.example",
};

const pendingGrant: PendingGrant = {
  continue: {
    access_token: { value: "secret-pending-continuation-token" },
    uri: "https://auth.example/continue/123",
  },
  interact: { redirect: "https://auth.example/consent", finish: "finish-nonce" },
};

const finalGrant: GrantWithAccessToken = {
  continue: {
    access_token: { value: "secret-final-continuation-token" },
    uri: "https://auth.example/continue/123",
  },
  access_token: {
    value: "secret-resource-token",
    manage: "https://auth.example/token/manage",
    access: getWalletGrantScope(wallet.id),
    expires_in: 3600,
  },
};

describe("Grant Repository", () => {
  let db: Knex;
  let repository: GrantRepository;
  let userId: string;
  let transactionId: string;

  beforeAll(async () => {
    db = await createTestDatabase();
    repository = new GrantRepository({ db, encryptionKey: env.GRANT_ENCRYPTION_KEY });
  });

  beforeEach(async () => {
    userId = randomUUID();
    transactionId = `onb_${randomUUID()}`;
    await db("users").insert({ id: userId, email: `${userId}@example.com` });
  });

  afterEach(async () => {
    await db("users").where({ id: userId }).del();
  });

  afterAll(async () => {
    await db.destroy();
  });

  const savePending = async (grant = pendingGrant) => {
    await repository.savePending({
      transactionId, userId, wallet, grant, scope: getWalletGrantScope(wallet.id),
    });
  };

  it("persists an encrypted pending grant linked to its user's wallet across repository instances", async () => {
    await savePending();
    const storedWallet = await db("wallets").where({ user_id: userId }).first();
    const row = await db("wallet_grants").where({ transaction_id: transactionId }).first();

    expect(storedWallet).toMatchObject({
      wallet_address_url: wallet.id, asset_code: "ZAR", asset_scale: 2,
      auth_server: wallet.authServer, resource_server: wallet.resourceServer,
    });
    expect(row).toMatchObject({ wallet_id: storedWallet.id, status: "PENDING", access_token_enc: null });
    expect(row.scope).toEqual(getWalletGrantScope(wallet.id));
    expect(row.pending_grant_enc).not.toContain(pendingGrant.continue.access_token.value);

    const reloaded = new GrantRepository({ db, encryptionKey: env.GRANT_ENCRYPTION_KEY });
    expect(await reloaded.getPending(transactionId)).toEqual(pendingGrant);
  });

  it("updates a repeated pending transaction without duplicating the wallet or grant", async () => {
    await savePending();
    const replacement = { ...pendingGrant, interact: { ...pendingGrant.interact, redirect: "https://auth.example/new-consent" } };
    await savePending(replacement);
    expect(await repository.getPending(transactionId)).toEqual(replacement);
    expect(await db("wallets").where({ user_id: userId })).toHaveLength(1);
    expect(await db("wallet_grants").where({ transaction_id: transactionId })).toHaveLength(1);
  });

  it("returns undefined for missing grants and deletes only the requested pending transaction", async () => {
    expect(await repository.getPending(transactionId)).toBeUndefined();
    await repository.deletePending(transactionId);
    await savePending();
    const secondId = `${transactionId}-second`;
    await repository.savePending({ transactionId: secondId, userId, wallet, grant: pendingGrant, scope: [] });

    await repository.deletePending(transactionId);
    expect(await repository.getPending(transactionId)).toBeUndefined();
    expect(await repository.getPending(secondId)).toEqual(pendingGrant);
  });

  it("atomically replaces pending credentials with the encrypted resource token and returned metadata", async () => {
    await savePending();
    const before = Date.now();
    await repository.saveFinalToken({ transactionId, grant: finalGrant, interactRef: "interaction-123" });
    const row = await db("wallet_grants").where({ transaction_id: transactionId }).first();

    expect(row).toMatchObject({
      status: "ACTIVE", pending_grant_enc: null,
      manage_url: finalGrant.access_token.manage, interact_ref: "interaction-123",
      scope: finalGrant.access_token.access,
    });
    expect(row.access_token_enc).not.toContain(finalGrant.access_token.value);
    const cipher = createGrantCipher(env.GRANT_ENCRYPTION_KEY);
    expect(cipher.decrypt(row.access_token_enc, `access:${transactionId}:${row.wallet_id}`))
      .toBe(finalGrant.access_token.value);
    expect(row.expires_at.getTime()).toBeGreaterThanOrEqual(before + 3600_000);
    expect(row.expires_at.getTime()).toBeLessThanOrEqual(Date.now() + 3600_000);
    expect(await repository.getPending(transactionId)).toBeUndefined();

    // A late cleanup call must not erase an active token.
    await repository.deletePending(transactionId);
    expect(await db("wallet_grants").where({ transaction_id: transactionId })).toHaveLength(1);
    await expect(savePending()).rejects.toMatchObject({ statusCode: 409 });
  });

  it("stores no expiry when the provider does not supply one", async () => {
    await savePending();
    const { expires_in, ...token } = finalGrant.access_token;
    await repository.saveFinalToken({ transactionId, grant: { ...finalGrant, access_token: token }, interactRef: "ref" });
    const row = await db("wallet_grants").where({ transaction_id: transactionId }).first();
    expect(row.expires_at).toBeNull();
  });

  it("rejects finalization without a pending transaction", async () => {
    await expect(repository.saveFinalToken({ transactionId, grant: finalGrant, interactRef: "ref" }))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it("rolls back wallet creation when a transaction belongs to a different wallet", async () => {
    await savePending();
    await expect(repository.savePending({
      transactionId, userId, wallet: { ...wallet, id: "https://wallet.example/other" },
      grant: pendingGrant, scope: [],
    })).rejects.toMatchObject({ statusCode: 409 });

    expect(await db("wallets").where({ user_id: userId })).toHaveLength(1);
    expect(await repository.getPending(transactionId)).toEqual(pendingGrant);
  });

  it("preserves pending credentials if finalization fails", async () => {
    await savePending();
    const invalidGrant = { ...finalGrant, access_token: { ...finalGrant.access_token, value: "" } };
    await expect(repository.saveFinalToken({ transactionId, grant: invalidGrant, interactRef: "ref" }))
      .rejects.toMatchObject({ statusCode: 502 });
    expect(await repository.getPending(transactionId)).toEqual(pendingGrant);
  });

  it("cannot decrypt pending credentials with a different encryption key", async () => {
    await savePending();
    const wrongKeyRepository = new GrantRepository({ db, encryptionKey: "ab".repeat(32) });
    await expect(wrongKeyRepository.getPending(transactionId)).rejects.toThrow();
  });
});
