import { createAuthenticatedClient, type AuthenticatedClient } from "@interledger/open-payments";
import { readFileSync } from "node:fs";
import { validateProviderUrl } from "./provider-url";

let clientPromise: Promise<AuthenticatedClient> | null = null;

export const getOpenPaymentsClient = (): Promise<AuthenticatedClient> => {
  if (!clientPromise) {
    clientPromise = createAuthenticatedClient({
      walletAddressUrl: validateProviderUrl(process.env.CLIENT_WALLET_ADDRESS_TEST_NET ?? ""),
      privateKey: readFileSync(process.env.PRIVATE_KEY_PATH_TEST_NET ?? "", "utf8"),
      keyId: process.env.KEY_ID_TEST_NET ?? "",
      requestTimeoutMs: 15000,
      // The SDK's debug logging includes raw request/response credentials.
      logLevel: "silent",
    }).then((client) => {
      // Validate every SDK entry point, including public reads and token management.
      for (const routes of Object.values(client)) {
        for (const [method, original] of Object.entries(routes)) {
          if (typeof original !== "function") continue;
          routes[method] = (...args: unknown[]) => {
            const request = args[0] as { url?: string } | undefined;
            if (request?.url) validateProviderUrl(request.url);
            return original(...args);
          };
        }
      }
      return client;
    }).catch((error) => { clientPromise = null; throw error; });
  }
  return clientPromise;
};
