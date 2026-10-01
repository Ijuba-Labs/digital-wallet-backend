import type { getOpenPaymentsClient } from "@/utils/open-payment";
import type { GrantRepository } from "@/repositories/grant.repository";
import type { WalletAddress } from "@interledger/open-payments";
import { validateProviderUrl, validateWalletAddress } from "@/utils/provider-url";
export type Wallet = WalletAddress;
export class WalletService {
  constructor(private readonly deps: { grantRepository: GrantRepository; getOpenPaymentsClient: typeof getOpenPaymentsClient }) {}
  async listLinkedWallets(userId: string) { return this.deps.grantRepository.listLinkedWallets(userId); }
  async getWalletAddress(walletAddressUrl: string): Promise<WalletAddress> {
    const url = validateWalletAddress(walletAddressUrl);
    const client = await this.deps.getOpenPaymentsClient();
    const wallet = await client.walletAddress.get({ url });
    const id = validateWalletAddress(wallet.id);
    validateProviderUrl(wallet.authServer);
    validateProviderUrl(wallet.resourceServer);
    return { ...wallet, id };
  }
}
