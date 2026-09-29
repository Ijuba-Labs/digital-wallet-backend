import type { getOpenPaymentsClient } from "@/utils/open-payment";
import type { GrantRepository } from "@/repositories/grant.repository";
import type { WalletAddress } from "@interledger/open-payments";
export type Wallet = WalletAddress;
export class WalletService {
  constructor(private readonly deps: { grantRepository: GrantRepository; getOpenPaymentsClient: typeof getOpenPaymentsClient }) {}
  async listLinkedWallets(userId: string) { return this.deps.grantRepository.listLinkedWallets(userId); }
  async getWalletAddress(walletAddressUrl: string): Promise<WalletAddress> {
    const client = await this.deps.getOpenPaymentsClient();
    return client.walletAddress.get({ url: walletAddressUrl });
  }
}
