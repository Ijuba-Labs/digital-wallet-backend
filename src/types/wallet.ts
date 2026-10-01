export interface LinkedWallet {
  id: string;
  walletAddressUrl: string;
  publicName: string | null;
  assetCode: string;
  assetScale: number;
  status: "LINKED" | "UNLINKED";
  isDefault: boolean;
  verifiedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
