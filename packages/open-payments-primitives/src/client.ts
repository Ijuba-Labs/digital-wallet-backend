import { createAuthenticatedClient, type AuthenticatedClient } from "@interledger/open-payments";
import { createUrlValidators } from "./provider-url.js";
export const createPaymentClient = async (config: { walletAddressUrl: string; privateKey: string; keyId: string; origins: string[]; production?: boolean }) => {
  const validators = createUrlValidators(config);
  return wrapOpenPaymentsClient(await createAuthenticatedClient({ walletAddressUrl: validators.validateWalletAddress(config.walletAddressUrl), privateKey: config.privateKey, keyId: config.keyId, requestTimeoutMs: 15000, logLevel: "silent" }), validators);
};
/** Explicit SDK adapter: SDK additions and signature changes are checked by TypeScript. */
export const wrapOpenPaymentsClient = (client: AuthenticatedClient, { validateProviderUrl, validateWalletAddress }: ReturnType<typeof createUrlValidators>): AuthenticatedClient => {
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
      get: async (...[args]: Parameters<typeof client.walletAddress.get>) => {
        const wallet = await client.walletAddress.get({ ...args, url: validateWalletAddress(args.url) });
        validateWalletAddress(wallet.id);
        validateProviderUrl(wallet.authServer);
        validateProviderUrl(wallet.resourceServer);
        return wallet;
      },
      getKeys: (...[args]: Parameters<typeof client.walletAddress.getKeys>) => client.walletAddress.getKeys(resource(args)),
      getDIDDocument: (...[args]: Parameters<typeof client.walletAddress.getDIDDocument>) => client.walletAddress.getDIDDocument(resource(args)),
    },
    grant: {
      request: (...[args, body, override]: Parameters<typeof client.grant.request>) => client.grant.request(resource(args), body, override),
      continue: (...[args, body]: Parameters<typeof client.grant.continue>) => client.grant.continue(resource(args), body),
      cancel: (...[args]: Parameters<typeof client.grant.cancel>) => client.grant.cancel(resource(args)),
    },
    token: {
      rotate: (...[args]: Parameters<typeof client.token.rotate>) => client.token.rotate(resource(args)),
      revoke: (...[args]: Parameters<typeof client.token.revoke>) => client.token.revoke(resource(args)),
    },
    incomingPayment: {
      get: (...[args]: Parameters<typeof client.incomingPayment.get>) => client.incomingPayment.get(resource(args)),
      getPublic: (...[args]: Parameters<typeof client.incomingPayment.getPublic>) => client.incomingPayment.getPublic(resource(args)),
      complete: (...[args]: Parameters<typeof client.incomingPayment.complete>) => client.incomingPayment.complete(resource(args)),
      list: (...[args, pagination]: Parameters<typeof client.incomingPayment.list>) => client.incomingPayment.list(collection(args), pagination),
      create: (...[args, body]: Parameters<typeof client.incomingPayment.create>) => {
        validateWalletAddress(body.walletAddress);
        return client.incomingPayment.create(resource(args), body);
      },
    },
    outgoingPayment: {
      get: (...[args]: Parameters<typeof client.outgoingPayment.get>) => client.outgoingPayment.get(resource(args)),
      getGrantSpentAmounts: (...[args]: Parameters<typeof client.outgoingPayment.getGrantSpentAmounts>) => client.outgoingPayment.getGrantSpentAmounts(resource(args)),
      list: (...[args, pagination]: Parameters<typeof client.outgoingPayment.list>) => client.outgoingPayment.list(collection(args), pagination),
      create: (...[args, body]: Parameters<typeof client.outgoingPayment.create>) => {
        validateWalletAddress(body.walletAddress);
        if ("quoteId" in body) validateProviderUrl(body.quoteId);
        else validateProviderUrl(body.incomingPayment);
        return client.outgoingPayment.create(resource(args), body);
      },
    },
    quote: {
      get: (...[args]: Parameters<typeof client.quote.get>) => client.quote.get(resource(args)),
      create: (...[args, body]: Parameters<typeof client.quote.create>) => {
        validateWalletAddress(body.walletAddress);
        if (typeof body.receiver === "string") validateProviderUrl(body.receiver);
        return client.quote.create(resource(args), body);
      },
    },
  };
};
