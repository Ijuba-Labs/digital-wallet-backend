import { AppError } from "@/utils/appError";
import type { LoyaltyProgram, CardInput } from "@/types/loyalty";

const invalid = () => new AppError("We couldn't verify this card number. Check it and try again, or scan your physical card", 422);
export function validateProgramCard(program: LoyaltyProgram, card: CardInput) {
  if (!program.active || program.status === "TEMPORARILY_DISABLED") throw new AppError("This loyalty program is temporarily unavailable", 409);
  if (card.membershipNumber && !program.capabilities.manualEntry) throw new AppError("Membership entry is unavailable for this program", 422);
  const rules = program.cardNumberRules;
  // Validate the exact supplied number. Never silently rewrite a barcode payload
  // or derive it from a membership number.
  if (card.membershipNumber && rules && (card.membershipNumber.length < (rules.minLength ?? 1) ||
    card.membershipNumber.length > (rules.maxLength ?? 64) || rules.regex && !new RegExp(rules.regex).test(card.membershipNumber))) throw invalid();
  if (card.barcodePayload && program.verification.barcodeFormatVerified && card.barcodeFormat !== program.barcodeFormat)
    throw new AppError("The scanned barcode doesn't match this program. Check that you selected the right card", 422);
  if (card.barcodePayload && program.digitalCardSupported) validateBarcodePayload(card.barcodePayload, card.barcodeFormat!);
}
export function validateBarcodePayload(value: string, format: string) {
  if (!value || value.length > 256 || /[\x00-\x1f\x7f]/.test(value)) throw invalid();
  if (format === "EAN_13" || format === "EAN_8") {
    const length = format === "EAN_13" ? 13 : 8;
    if (!new RegExp(`^[0-9]{${length}}$`).test(value)) throw invalid();
    let sum = 0;
    for (let i = length - 2, weight = 3; i >= 0; i--, weight = 4 - weight) sum += Number(value[i]) * weight;
    if ((10 - sum % 10) % 10 !== Number(value[length - 1])) throw invalid();
  } else if (format === "CODE_128") {
    if (!/^[\x20-\x7e]+$/.test(value)) throw invalid();
  } else if (!["QR_CODE", "PDF_417"].includes(format)) throw new AppError("This barcode format is not supported for checkout", 422);
}
