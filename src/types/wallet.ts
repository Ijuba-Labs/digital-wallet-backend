export interface LinkedWallet {
  id: string;
  walletAddressUrl: string;
  publicName: string | null;
  assetCode: string;
  assetScale: number;
  status: "LINKED" | "UNLINKED";
  isDefault: boolean;
  verifiedAt: Date | null;
  developmentFixture?: boolean;
  createdAt: Date;
  updatedAt: Date;
}
