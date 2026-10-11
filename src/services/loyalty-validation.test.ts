import { describe, expect, it } from "@jest/globals";
import { cardTemplateSchema, neutralTemplate, programConfigurationSchema } from "@/types/loyalty";
import { checkoutAllowed } from "./loyalty-catalogue.service";
import { validateBarcodePayload, validateProgramCard } from "./loyalty-validation";
import { maskLoyaltyNumber } from "./loyalty.service";

import { testProgram } from "../../tests/fixtures/loyalty";

describe("loyalty safety contracts", () => {
  it("requires every verification flag, evidence, enabled artwork and verified rollout", () => {
    expect(checkoutAllowed(testProgram, true)).toBe(true);
    expect(checkoutAllowed(testProgram, false)).toBe(false);
    for (const key of ["barcodeFormatVerified", "numberFormatVerified", "digitalReproductionAllowed", "templateVerified"] as const)
      expect(checkoutAllowed({ ...testProgram, verification: { ...testProgram.verification, [key]: false } }, true)).toBe(false);
    for (const status of ["CATALOGUE_ONLY", "DIGITAL_CARD_BETA", "TEMPORARILY_DISABLED"] as const)
      expect(checkoutAllowed({ ...testProgram, status }, true)).toBe(false);
    expect(checkoutAllowed({ ...testProgram, active: false }, true)).toBe(false);
    expect(checkoutAllowed({ ...testProgram, capabilities: { ...testProgram.capabilities, staticBarcode: false } }, true)).toBe(false);
    expect(checkoutAllowed({ ...testProgram, verification: { ...testProgram.verification, permissionSource: undefined } }, true)).toBe(false);
  });
  it("checks exact membership rules without deriving payload", () => {
    expect(() => validateProgramCard(testProgram, { membershipNumber: "00112233" })).not.toThrow();
    for (const value of ["123", "1234 5678", "abcd1234"]) expect(() => validateProgramCard(testProgram, { membershipNumber: value })).toThrow();
    expect(() => validateProgramCard(testProgram, { membershipNumber: "00112233", barcodePayload: "DIFFERENT-001", barcodeFormat: "CODE_128" })).not.toThrow();
    expect(() => validateProgramCard(testProgram, { barcodePayload: "00112233", barcodeFormat: "QR_CODE" })).toThrow(/doesn't match/);
  });
  it("validates EAN checksums and CODE 128 encoding limits", () => {
    expect(() => validateBarcodePayload("4006381333931", "EAN_13")).not.toThrow();
    expect(() => validateBarcodePayload("96385074", "EAN_8")).not.toThrow();
    for (const [value, format] of [["4006381333932", "EAN_13"], ["96385075", "EAN_8"], ["123", "EAN_8"], ["café", "CODE_128"], ["abc", "UNKNOWN"], ["abc\n", "QR_CODE"]])
      expect(() => validateBarcodePayload(value!, format!)).toThrow();
  });
  it("masks short numbers as well as wallet identifiers", () => {
    expect(maskLoyaltyNumber("0011 2233 4455")).toBe("••••4455");
    expect(maskLoyaltyNumber("12")).toBe("••••");
    expect(maskLoyaltyNumber("123")).toBe("••••3");
  });
  it("validates normalized artwork, solid barcode colors, approved URL schemes and safe rules", () => {
    expect(cardTemplateSchema.safeParse(neutralTemplate).success).toBe(true);
    for (const barcode of [{ ...neutralTemplate.barcode, x: -0.1 }, { ...neutralTemplate.barcode, width: 1 }, { ...neutralTemplate.barcode, foregroundColor: "#777777" }])
      expect(cardTemplateSchema.safeParse({ ...neutralTemplate, barcode }).success).toBe(false);
    const { id, slug, name, requiresCustomName, currentTemplateVersion, digitalCardSupported, ...configuration } = testProgram;
    expect(programConfigurationSchema.safeParse(configuration).success).toBe(true);
    expect(programConfigurationSchema.safeParse({ ...configuration, cardNumberRules: { regex: "^(a+)+$" } }).success).toBe(false);
    expect(programConfigurationSchema.safeParse({ ...configuration, logoUrl: "http://example.test/logo.png" }).success).toBe(false);
    expect(programConfigurationSchema.safeParse({ ...configuration, verification: { ...configuration.verification, barcodeSource: undefined } }).success).toBe(false);
  });
});


describe("managed card artwork", () => {
  const layout = {
    aspectRatio: 1.6, cornerRadius: 0.045,
    background: { type: "gradient", colors: ["#43206A", "#692268", "#43206A"] },
    brand: { text: "XTRA SAVINGS", x: 0.3, y: 0.1, width: 0.6, height: 0.26,
      color: "#FFF200", fontSize: 0.12, fontFamily: "CONDENSED", letterSpacing: 0.18 },
    stripes: { color: "#241038", opacity: 0.18, count: 6 },
    barcode: { x: 0.022, y: 0.46, width: 0.956, height: 0.49, cornerRadius: 0.035,
      backgroundColor: "#FFFFFF", foregroundColor: "#000000", showNumber: true, numberGroupSize: 4 },
  };
  it("accepts optional layout fields and retains legacy templates", () => {
    expect(cardTemplateSchema.safeParse(layout).success).toBe(true);
    expect(cardTemplateSchema.safeParse(neutralTemplate).success).toBe(true);
  });
  it("rejects out-of-bounds branding, excessive decoration, invalid grouping and embedded personal data", () => {
    for (const candidate of [
      { ...layout, brand: { ...layout.brand, x: 0.9 } },
      { ...layout, stripes: { ...layout.stripes, opacity: 0.9 } },
      { ...layout, barcode: { ...layout.barcode, numberGroupSize: 0 } },
      { ...layout, barcode: { ...layout.barcode, value: "personal-number" } },
      { ...layout, cornerRadius: 0.8 },
    ]) expect(cardTemplateSchema.safeParse(candidate).success).toBe(false);
  });
});


describe("card materials", () => {
  it("accepts supported materials while preserving old templates", () => {
    for (const material of ["FLAT", "MATTE_PLASTIC", "GLOSSY_PLASTIC"])
      expect(cardTemplateSchema.safeParse({ ...neutralTemplate, background: { ...neutralTemplate.background, material } }).success).toBe(true);
    expect(cardTemplateSchema.safeParse({ ...neutralTemplate, background: { ...neutralTemplate.background, material: "UNKNOWN" } }).success).toBe(false);
  });
});
