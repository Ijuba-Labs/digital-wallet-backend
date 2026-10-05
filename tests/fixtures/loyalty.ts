import type { LoyaltyProgram } from "../../src/types/loyalty";
export const testProgram: LoyaltyProgram = {
  id: "test-rewards", slug: "test-rewards", name: "Synthetic Rewards", retailerName: "Test Retailer", category: "OTHER",
  barcodeFormat: "CODE_128", active: true, status: "DIGITAL_CARD_VERIFIED", requiresCustomName: false,
  currentTemplateVersion: 1, digitalCardSupported: true,
  cardNumberRules: { minLength: 8, maxLength: 12, regex: "^[0-9]{8,12}$" },
  capabilities: { digitalCard: true, staticBarcode: true, manualEntry: true, barcodeScanning: true, rewardsInformation: true },
  verification: { barcodeFormatVerified: true, numberFormatVerified: true, digitalReproductionAllowed: true, templateVerified: true,
    barcodeSource: "https://example.test/barcode", numberSource: "https://example.test/number", permissionSource: "https://example.test/permission", templateSource: "https://example.test/template", verifiedAt: "2026-10-05T00:00:00Z" },
};
