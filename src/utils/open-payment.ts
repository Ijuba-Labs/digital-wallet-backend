import { createAuthenticatedClient, type AuthenticatedClient } from "@interledger/open-payments";
import { readFileSync } from "node:fs";
import { validateProviderUrl, validateWalletAddress } from "./provider-url";

let clientPromise: Promise<AuthenticatedClient> | null = null;

export const getOpenPaymentsClient = (): Promise<AuthenticatedClient> => {
  if (!clientPromise) {
    clientPromise = createAuthenticatedClient({
      walletAddressUrl: validateWalletAddress(process.env.CLIENT_WALLET_ADDRESS_TEST_NET ?? ""),
      privateKey: readFileSync(process.env.PRIVATE_KEY_PATH_TEST_NET ?? "", "utf8"),
      keyId: process.env.KEY_ID_TEST_NET ?? "",
      requestTimeoutMs: 15000,
      // The SDK's debug logging includes raw request/response credentials.
      logLevel: "silent",
    }).then(wrapOpenPaymentsClient).catch((error) => { clientPromise = null; throw error; });
  }
  return clientPromise;
};


/** Explicit SDK adapter: SDK additions and signature changes are checked by TypeScript. */
export const wrapOpenPaymentsClient = (client: AuthenticatedClient): AuthenticatedClient => {
  const resource = <T extends { url: string }>(args: T): T => {
    validateProviderUrl(args.url);
    return args;
  };
  const collection = <T extends { url: string; walletAddress: string }>(args: T): T => {
    validateWalletAddress(args.walletAddress);
    return resource(args);
  };
  return {
    walletAddress: {
      get: async (args) => {
        const wallet = await client.walletAddress.get({ ...args, url: validateWalletAddress(args.url) });
        validateWalletAddress(wallet.id);
        validateProviderUrl(wallet.authServer);
        validateProviderUrl(wallet.resourceServer);
        return wallet;
      },
      getKeys: (args) => client.walletAddress.getKeys(resource(args)),
      getDIDDocument: (args) => client.walletAddress.getDIDDocument(resource(args)),
    },
    grant: {
      request: (args, body, override) => client.grant.request(resource(args), body, override),
      continue: (args, body) => client.grant.continue(resource(args), body),
      cancel: (args) => client.grant.cancel(resource(args)),
    },
    token: {
      rotate: (args) => client.token.rotate(resource(args)),
      revoke: (args) => client.token.revoke(resource(args)),
    },
    incomingPayment: {
      get: (args) => client.incomingPayment.get(resource(args)),
      getPublic: (args) => client.incomingPayment.getPublic(resource(args)),
      complete: (args) => client.incomingPayment.complete(resource(args)),
      list: (args, pagination) => client.incomingPayment.list(collection(args), pagination),
      create: (args, body) => {
        validateWalletAddress(body.walletAddress);
        return client.incomingPayment.create(resource(args), body);
      },
    },
    outgoingPayment: {
      get: (args) => client.outgoingPayment.get(resource(args)),
      getGrantSpentAmounts: (args) => client.outgoingPayment.getGrantSpentAmounts(resource(args)),
      list: (args, pagination) => client.outgoingPayment.list(collection(args), pagination),
      create: (args, body) => {
        validateWalletAddress(body.walletAddress);
        if ("quoteId" in body) validateProviderUrl(body.quoteId);
        else validateProviderUrl(body.incomingPayment);
        return client.outgoingPayment.create(resource(args), body);
      },
    },
    quote: {
      get: (args) => client.quote.get(resource(args)),
      create: (args, body) => {
        validateWalletAddress(body.walletAddress);
        if (typeof body.receiver === "string") validateProviderUrl(body.receiver);
        return client.quote.create(resource(args), body);
      },
    },
  };
};
