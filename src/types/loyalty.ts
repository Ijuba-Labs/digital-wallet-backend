import { z } from "zod";

export const barcodeFormats = ["CODE_128", "EAN_13", "EAN_8", "QR_CODE", "PDF_417", "UNKNOWN"] as const;
export const rolloutStatuses = ["CATALOGUE_ONLY", "DIGITAL_CARD_BETA", "DIGITAL_CARD_VERIFIED", "TEMPORARILY_DISABLED"] as const;
export const loyaltyCategories = ["GROCERY", "PHARMACY", "HEALTH_AND_BEAUTY", "FASHION", "FUEL", "CONVENIENCE", "HOME_IMPROVEMENT", "FURNITURE", "GENERAL_RETAIL", "DEPARTMENT_STORES", "OTHER"] as const;
const httpsUrl = z.string().url().max(2048).refine(value => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password;
});
const name = z.string().trim().min(1).max(200);
// A bounded, deliberately small regex language avoids administrator-supplied ReDoS.
// Supports anchored character classes with a single bounded quantifier only.
export const numberRulesSchema = z.object({
  minLength: z.number().int().min(1).max(64).optional(),
  maxLength: z.number().int().min(1).max(64).optional(),
  regex: z.string().max(100).regex(/^\^\[(?:0-9|A-Z|a-z|A-Za-z|A-Z0-9|a-z0-9|A-Za-z0-9)\]\{\d{1,2}(?:,\d{1,2})?\}\$$/).optional(),
}).strict().superRefine((rules, ctx) => {
  if ((rules.minLength ?? 1) > (rules.maxLength ?? 64)) ctx.addIssue({ code: "custom", message: "Invalid length bounds" });
  if (rules.regex) {
    const bounds = rules.regex.match(/\{(\d+)(?:,(\d+))?\}/);
    if (!bounds) return;
    const min = Number(bounds[1]), max = Number(bounds[2] ?? bounds[1]);
    if (min < 1 || max > 64 || min > max) ctx.addIssue({ code: "custom", message: "Invalid regex bounds" });
  }
});
export const programConfigurationSchema = z.object({
  retailerName: name,
  category: z.enum(loyaltyCategories),
  description: z.string().max(2000).optional(),
  logoUrl: httpsUrl.optional(),
  barcodeFormat: z.enum(barcodeFormats),
  cardNumberRules: numberRulesSchema.optional(),
  capabilities: z.object({ digitalCard: z.boolean(), staticBarcode: z.boolean(), manualEntry: z.boolean(), barcodeScanning: z.boolean(), rewardsInformation: z.boolean() }).strict(),
  verification: z.object({
    barcodeFormatVerified: z.boolean(), numberFormatVerified: z.boolean(), digitalReproductionAllowed: z.boolean(), templateVerified: z.boolean(),
    barcodeSource: httpsUrl.optional(), numberSource: httpsUrl.optional(), permissionSource: httpsUrl.optional(), templateSource: httpsUrl.optional(),
    verifiedAt: z.string().datetime({ offset: true }).optional(),
  }).strict(),
  rewardType: name.optional(),
  rewards: z.object({ explanation: z.string().max(2000), earn: z.string().max(2000).optional(), redeem: z.string().max(2000).optional() }).strict().optional(),
  officialUrl: httpsUrl.optional(),
  status: z.enum(rolloutStatuses),
  active: z.boolean(),
}).strict().superRefine((p, ctx) => {
  const v = p.verification;
  if (p.status === "DIGITAL_CARD_VERIFIED" && (!p.capabilities.digitalCard || !p.capabilities.staticBarcode || p.barcodeFormat === "UNKNOWN" ||
    !v.barcodeFormatVerified || !v.numberFormatVerified || !v.digitalReproductionAllowed || !v.templateVerified ||
    !v.barcodeSource || !v.numberSource || !v.permissionSource || !v.templateSource || !v.verifiedAt)) {
    ctx.addIssue({ code: "custom", message: "Verified checkout requires static capability and documented verification evidence" });
  }
});
const unit = z.number().min(0).max(1);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const cardTemplateSchema = z.object({
  aspectRatio: z.number().min(0.5).max(3),
  background: z.discriminatedUnion("type", [
    z.object({ type: z.literal("solid"), colors: z.array(color).length(1) }).strict(),
    z.object({ type: z.literal("gradient"), colors: z.array(color).min(2).max(4) }).strict(),
    z.object({ type: z.literal("asset"), assetUrl: httpsUrl }).strict(),
  ]),
  logo: z.object({ assetUrl: httpsUrl, x: unit, y: unit, width: unit.gt(0), height: unit.gt(0) }).strict().optional(),
  barcode: z.object({ x: unit, y: unit, width: unit.gt(0), height: unit.gt(0), backgroundColor: z.literal("#FFFFFF"), foregroundColor: z.literal("#000000"), showNumber: z.boolean() }).strict(),
  attribution: z.string().max(500).optional(),
}).strict().superRefine((t, ctx) => {
  for (const [key, box] of Object.entries({ barcode: t.barcode, logo: t.logo })) {
    if (box && (box.x + box.width > 1 + 1e-9 || box.y + box.height > 1 + 1e-9)) ctx.addIssue({ code: "custom", path: [key], message: "Template region exceeds card bounds" });
  }
});
export type BarcodeFormat = typeof barcodeFormats[number];
export type ProgramConfiguration = z.infer<typeof programConfigurationSchema>;
export type CardTemplateLayout = z.infer<typeof cardTemplateSchema>;
export interface CardTemplate extends CardTemplateLayout { id: string; programId: string; version: number }
export interface LoyaltyProgram extends ProgramConfiguration {
  id: string; slug: string; name: string; requiresCustomName: boolean;
  currentTemplateVersion: number | null; digitalCardSupported: boolean;
}
export const neutralTemplate: CardTemplateLayout = {
  aspectRatio: 85.60 / 53.98,
  background: { type: "solid", colors: ["#F3F0E8"] },
  barcode: { x: 0.07, y: 0.52, width: 0.86, height: 0.33, backgroundColor: "#FFFFFF", foregroundColor: "#000000", showNumber: true },
  attribution: "Independent loyalty wallet. No retailer affiliation is implied.",
};

export type ProgramVerification = ProgramConfiguration["verification"];
export interface CardInput {
  programId?: string;
  customProgramName?: string | null;
  nickname?: string | null;
  membershipNumber?: string | null;
  barcodePayload?: string | null;
  barcodeFormat?: string | null;
}
/** Public wallet DTO. Never add full private identifiers to this type. */
export interface CardSummary {
  id: string; programId: string; programName: string;
  customProgramName: string | null; nickname: string | null;
  membershipNumberMasked: string | null; barcodePayloadMasked: string | null;
  barcodeFormat: string | null; hasImage: boolean; imageDetection: "barcode" | "number" | null;
  templateVersion: number | null; createdAt: string; updatedAt: string;
}
/** Private detail model; ownership is always inferred from the authenticated user. */
export interface UserLoyaltyCard extends CardSummary {
  membershipNumber: string | null;
  barcodePayload: string | null;
}
export interface LoyaltyCheckoutBundle extends UserLoyaltyCard {
  program: LoyaltyProgram; template: CardTemplate;
  canGenerateBarcode: true; barcodePayload: string;
  effectiveTemplateVersion: number; checkedAt: string; offlineValidUntil: string;
}
