import { wrapOpenPaymentsClient as sharedWrapper } from "@ijuba-labs/payment-primitives";
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


export const wrapOpenPaymentsClient = (client: AuthenticatedClient) => sharedWrapper(client, { validateProviderUrl, validateWalletAddress });
