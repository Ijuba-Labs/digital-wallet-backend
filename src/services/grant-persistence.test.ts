import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { createHash, randomUUID } from "node:crypto";
import type { Knex } from "knex";
import type { AuthenticatedClient, GrantWithAccessToken, PendingGrant, WalletAddress } from "@interledger/open-payments";
import { createTestDatabase } from "../../tests/database";
import { GrantRepository } from "@/repositories/grant.repository";
import { OnboardingRepository } from "@/repositories/onboarding.repository";
import { OnboardingService } from "./onboarding.service";
import { WalletService } from "./wallet.service";
import type { OnboardingSession } from "@/types/onboarding";
import { redisClient } from "@/config/redis";
import { env } from "@/config/env";
import { logger } from "@/utils/logger";
import { createGrantCipher } from "@/utils/grant-encryption";
import { getWalletGrantScope } from "@/utils/grant-access";
import { createOnboardingConfig } from "@/config/onboarding";

const wallet: WalletAddress = {
  id: "https://wallet.example/alice", assetCode: "ZAR", assetScale: 2,
  authServer: "https://auth.example", resourceServer: "https://resource.example",
};
const pending: PendingGrant = {
  continue: { uri: "https://auth.example/continue", access_token: { value: "continue-token" } },
  interact: { redirect: "https://auth.example/consent", finish: "finish-nonce" },
};
const finalized: GrantWithAccessToken = {
  continue: { ...pending.continue, access_token: { value: "new-continue-token" } },
  access_token: {
    value: "resource-access-token", manage: "https://auth.example/manage",
    access: getWalletGrantScope(wallet.id),
  },
};

describe("Grant persistence through service callers", () => {
  let db: Knex;
  let userId: string;
  let grantRepository: GrantRepository;

  beforeAll(async () => {
    db = await createTestDatabase();
    grantRepository = new GrantRepository({ db, encryptionKey: env.GRANT_ENCRYPTION_KEY });
  });

  beforeEach(async () => {
    userId = randomUUID();
    await db("users").insert({ id: userId, email: `${userId}@example.com` });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await db("users").where({ id: userId }).del();
  });

  afterAll(async () => { await db.destroy(); });

  const createClient = () => {
    const continueGrant = jest.fn<AuthenticatedClient["grant"]["continue"]>().mockResolvedValue(finalized);
    const client = {
      walletAddress: { get: jest.fn<AuthenticatedClient["walletAddress"]["get"]>().mockResolvedValue(wallet) },
      grant: {
        request: jest.fn<AuthenticatedClient["grant"]["request"]>().mockResolvedValue(pending),
        continue: continueGrant,
      },
    } as unknown as AuthenticatedClient;
    return { getOpenPaymentsClient: async () => client, continueGrant };
  };

  const expectFinalToken = async (transactionId: string) => {
    const row = await db("wallet_grants").where({ transaction_id: transactionId }).first();
    const storedWallet = await db("wallets").where({ id: row.wallet_id }).first();
    expect(storedWallet.user_id).toBe(userId);
    expect(row.status).toBe("ACTIVE");
    expect(createGrantCipher(env.GRANT_ENCRYPTION_KEY)
      .decrypt(row.access_token_enc, `access:${transactionId}:${row.wallet_id}`))
      .toBe(finalized.access_token.value);
  };

  it("links onboarding grants to the authenticated user and finalizes them before completing the session", async () => {
    const onboardingRepository = new OnboardingRepository({ redis: redisClient });
    let session: OnboardingSession;
    jest.spyOn(onboardingRepository, "findActiveByUserId").mockResolvedValue(null);
    jest.spyOn(onboardingRepository, "save").mockImplementation(async (value) => { session = value; });
    jest.spyOn(onboardingRepository, "findById").mockImplementation(async () => session);
    jest.spyOn(onboardingRepository, "transition").mockImplementation(async (_id, _expectedStatus, updates) => {
      session = { ...session, ...updates };
      return session;
    });
    const { getOpenPaymentsClient, continueGrant } = createClient();
    const service = new OnboardingService({ onboardingRepository, grantRepository, getOpenPaymentsClient, logger,
      config: createOnboardingConfig({ apiPublicUrl: env.API_PUBLIC_URL, allowLocalHttp: true }),
    });

    const started = await service.start({ userId, walletAddressUrl: wallet.id });
    const consent = await service.requestConsent(started.sessionId, userId);
    expect(consent.status).toBe("CONSENT_PENDING");
    expect(await grantRepository.getPending(started.sessionId)).toEqual(pending);

    const interaction = (await onboardingRepository.findById(started.sessionId))!.interaction!;
    const hash = createHash("sha256").update([
      interaction.clientNonce, interaction.finishNonce, "interaction-ref", interaction.grantRequestUrl,
    ].join("\n")).digest("base64");
    const result = await service.handleCallback(started.sessionId, "interaction-ref", hash);
    expect(result.status).toBe("COMPLETED");
    expect(continueGrant).toHaveBeenCalledWith({
      accessToken: pending.continue.access_token.value, url: pending.continue.uri,
    }, { interact_ref: "interaction-ref" });
    await expectFinalToken(started.sessionId);
    expect((await onboardingRepository.findById(started.sessionId))?.accessToken).toBeUndefined();
  });

  it("uses the caller's user and resolved wallet in the legacy service without generating a fake user", async () => {
    const service = new WalletService({ grantRepository, ...createClient() });
    const result = await service.requestGrant(wallet.id, userId);
    expect(result).toMatchObject({ redirectUrl: pending.interact.redirect });
    expect(result).not.toHaveProperty("grant");
    await service.finilizeGrant(result.transactionId, "interaction-ref");
    await expectFinalToken(result.transactionId);
  });
});
