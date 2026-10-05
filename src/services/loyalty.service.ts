import { createHmac, hkdfSync, randomUUID, createHash } from "node:crypto";
import type { Knex } from "knex";
import { createCipher } from "@ijuba-labs/payment-primitives";
import { loadKeyring } from "@/utils/grant-encryption";
import { AppError } from "@/utils/appError";
import { LoyaltyCatalogueService } from "./loyalty-catalogue.service";
import { validateProgramCard, validateBarcodePayload } from "./loyalty-validation";
import { checkLoyaltyImage, type CheckedLoyaltyImage } from "./loyalty-image.service";

import type { CardInput, CardSummary, LoyaltyCheckoutBundle } from "@/types/loyalty";
export type { CardInput } from "@/types/loyalty";

const allowed = new Set(["programId", "customProgramName", "nickname", "membershipNumber", "barcodePayload", "barcodeFormat"]);
const formatNames = new Set(["CODE_128", "CODE_39", "EAN_13", "EAN_8", "UPC_A", "UPC_E", "ITF", "QR_CODE", "DATA_MATRIX", "PDF_417", "AZTEC", "CODABAR"]);
export const maskLoyaltyNumber = (value: string) => {
  const compact = value.replace(/\s/g, "");
  const visible = Math.min(4, Math.max(0, compact.length - 2));
  return `••••${visible ? compact.slice(-visible) : ""}`;
};
const identifier = (value: string) => value.replace(/[\s-]/g, "").toUpperCase();

function parseInput(raw: unknown, partial = false): CardInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new AppError("Card must be an object", 400);
  const input = raw as Record<string, unknown>;
  if (Object.keys(input).some(key => !allowed.has(key))) throw new AppError("Unknown card field", 400);
  if (partial && !Object.keys(input).length) throw new AppError("No card changes supplied", 400);
  for (const [key, value] of Object.entries(input)) {
    if (value !== null && (typeof value !== "string" || value.length > 256)) throw new AppError(`Invalid ${key}`, 400);
  }
  const card = Object.fromEntries(Object.entries(input).map(([key, value]) => [key, typeof value === "string" && key !== "barcodePayload" ? value.trim() : value])) as CardInput;
  if (!partial && !card.programId) throw new AppError("programId is required", 400);
  return card;
}

export class LoyaltyService {
  private readonly ring = loadKeyring();
  private readonly cipher = createCipher(this.ring, "wallet-backend:loyalty:v1");
  private readonly catalogue: LoyaltyCatalogueService;
  constructor(private readonly db: Knex) { this.catalogue = new LoyaltyCatalogueService(db); }

  private encrypt(value: string | null | undefined, id: string, field: string) {
    return value ? this.cipher.encrypt(value, `loyalty-${field}:${id}`) : null;
  }
  private decrypt(value: string | null, id: string, field: string): string | null {
    return value ? this.cipher.decrypt(value, `loyalty-${field}:${id}`) : null;
  }
  private fingerprints(values: string[], customProgramName?: string | null) {
    const scope = customProgramName ? `other:${identifier(customProgramName)}:` : "";
    const normalized = [...new Set(values.filter(Boolean).map(value => scope + identifier(value)))];
    return [...new Set(Object.values(this.ring.keys).flatMap(key => {
      const hmacKey = Buffer.from(hkdfSync("sha256", Buffer.from(key, "hex"), Buffer.from("wallet-backend:loyalty:v1"), Buffer.from("duplicate-index"), 32));
      return normalized.map(value => createHmac("sha256", hmacKey).update(value).digest("hex"));
    }))];
  }
  private async program(programId: string | undefined, customName: string | null | undefined) {
    const program = programId && await this.catalogue.get(programId);
    if (!program) throw new AppError("Unknown loyalty program", 400);
    if (program.requiresCustomName && !customName) throw new AppError("customProgramName is required for Other", 400);
    if (!program.requiresCustomName && customName) throw new AppError("customProgramName is only allowed for Other", 400);
    return program;
  }
  private validate(card: CardInput, image: CheckedLoyaltyImage | null) {
    if (!card.membershipNumber && !card.barcodePayload && !image) throw new AppError("A number, barcode, or accepted image is required", 400);
    if (card.membershipNumber && (!/^[\p{L}\p{N} -]{3,64}$/u.test(card.membershipNumber) || !/[\p{N}]/u.test(card.membershipNumber)))
      throw new AppError("Invalid membershipNumber", 400);
    if (card.barcodePayload && (card.barcodePayload.length > 256 || /[\x00-\x1f\x7f]/.test(card.barcodePayload)))
      throw new AppError("Invalid barcodePayload", 400);
    if (!!card.barcodePayload !== !!card.barcodeFormat || card.barcodeFormat && !formatNames.has(card.barcodeFormat))
      throw new AppError("A supported barcodeFormat is required with barcodePayload", 400);
    if (card.nickname && card.nickname.length > 80 || card.customProgramName && card.customProgramName.length > 100)
      throw new AppError("Card name is too long", 400);
  }
  private metadata(row: any): CardSummary {
    return {
      id: row.id, programId: row.program_id, programName: row.program_name,
      customProgramName: row.custom_program_name, nickname: row.nickname,
      membershipNumberMasked: row.membership_number_mask,
      barcodePayloadMasked: row.barcode_payload_mask,
      barcodeFormat: row.barcode_format, hasImage: !!row.image_enc,
      templateVersion: row.template_version,
      imageDetection: row.image_detection, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
    };
  }
  private query(userId: string) {
    return this.db("loyalty_cards as c").join("loyalty_programs as p", "p.id", "c.program_id")
      .where("c.user_id", userId).select("c.*", "p.name as program_name");
  }
  private async owned(userId: string, id: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new AppError("Card not found", 404);
    const row = await this.query(userId).andWhere("c.id", id).first();
    if (!row) throw new AppError("Card not found", 404);
    return row;
  }
  async programs(filters: unknown = {}) { return this.catalogue.list(filters); }
  async programDetails(id: string) { return this.catalogue.get(id); }
  async template(programId: string, version?: number) { return this.catalogue.template(programId, version); }
  async preview(raw: unknown) {
    const card = parseInput(raw);
    const program = await this.program(card.programId, card.customProgramName);
    this.validate(card, null);
    validateProgramCard(program, card);
    const template = await this.catalogue.template(program.id);
    return { program, template, membershipNumberMasked: card.membershipNumber ? maskLoyaltyNumber(card.membershipNumber) : null,
      barcodePayloadMasked: card.barcodePayload ? maskLoyaltyNumber(card.barcodePayload) : null,
      canGenerateBarcode: program.digitalCardSupported && !!card.barcodePayload,
      // The client already holds the private values; do not echo them.
      barcodeFormat: program.digitalCardSupported ? program.barcodeFormat : "UNKNOWN" };
  }
  async checkout(userId: string, id: string): Promise<LoyaltyCheckoutBundle> {
    const row = await this.owned(userId, id);
    const program = await this.catalogue.get(row.program_id);
    if (!program.digitalCardSupported) throw new AppError("Digital checkout is unavailable for this program. Use your physical card or the retailer's app", 409);
    const template = await this.catalogue.template(row.program_id, row.template_version ?? undefined);
    const barcodePayload = this.decrypt(row.barcode_payload_enc, id, "barcode");
    if (!barcodePayload || row.barcode_format !== program.barcodeFormat) throw new AppError("Scan your physical card again before using digital checkout", 422);
    validateBarcodePayload(barcodePayload, program.barcodeFormat);
    const checkedAt = new Date();
    return { ...this.metadata(row), program, template, canGenerateBarcode: true,
      membershipNumber: this.decrypt(row.membership_number_enc, id, "number"), barcodePayload,
      effectiveTemplateVersion: template.version,
      checkedAt: checkedAt.toISOString(), offlineValidUntil: new Date(checkedAt.getTime() + 24 * 60 * 60 * 1000).toISOString() };
  }
  async list(userId: string) {
    return (await this.query(userId).orderBy("c.created_at", "desc")).map(row => this.metadata(row));
  }
  async get(userId: string, id: string) { return this.metadata(await this.owned(userId, id)); }
  async presentation(userId: string, id: string) {
    const row = await this.owned(userId, id);
    const program = await this.catalogue.get(row.program_id);
    return { ...this.metadata(row), canGenerateBarcode: false, digitalCardSupported: program.digitalCardSupported, membershipNumber: this.decrypt(row.membership_number_enc, id, "number"),
      barcodePayload: this.decrypt(row.barcode_payload_enc, id, "barcode"),
      imageUrl: row.image_enc ? `/api/v1/loyalty-cards/${id}/image` : null };
  }
  async image(userId: string, id: string) {
    const row = await this.owned(userId, id);
    if (!row.image_enc) throw new AppError("Card image not found", 404);
    return { mime: row.image_mime as string, bytes: Buffer.from(this.decrypt(row.image_enc, id, "image")!, "base64") };
  }
  private async persist(userId: string, id: string, card: CardInput, image: CheckedLoyaltyImage | null, existing?: any) {
    const program = await this.program(card.programId, card.customProgramName);
    this.validate(card, image);
    validateProgramCard(program, card);
    const imageBytes = image?.bytes ?? (existing?.image_enc ? Buffer.from(this.decrypt(existing.image_enc, id, "image")!, "base64") : null);
    const detectedValue = image?.detectedValue ?? (existing?.image_detection_value_enc ? this.decrypt(existing.image_detection_value_enc, id, "detected") : null);
    const values = [card.membershipNumber ?? "", card.barcodePayload ?? "", detectedValue ?? ""];
    if (imageBytes) values.push(`IMAGE:${createHash("sha256").update(imageBytes).digest("hex")}`);
    const fingerprints = this.fingerprints(values, card.programId === "other" ? card.customProgramName : null);
    const row = {
      user_id: userId, program_id: card.programId, custom_program_name: card.customProgramName || null, nickname: card.nickname || null,
      membership_number_enc: this.encrypt(card.membershipNumber, id, "number"), membership_number_mask: card.membershipNumber ? maskLoyaltyNumber(card.membershipNumber) : null,
      barcode_payload_enc: this.encrypt(card.barcodePayload, id, "barcode"), barcode_payload_mask: card.barcodePayload ? maskLoyaltyNumber(card.barcodePayload) : null,
      barcode_format: card.barcodeFormat || null,
      template_version: existing?.program_id === card.programId ? existing.template_version : program.currentTemplateVersion,
      image_enc: imageBytes ? this.encrypt(imageBytes.toString("base64"), id, "image") : null,
      image_mime: imageBytes ? "image/jpeg" : null,
      image_detection: image?.detection ?? existing?.image_detection ?? null,
      image_detection_value_enc: detectedValue ? this.encrypt(detectedValue, id, "detected") : null,
      updated_at: this.db.fn.now(),
    };
    try {
      await this.db.transaction(async trx => {
        if (existing) {
          await trx("loyalty_card_identifiers").where({ card_id: id }).del();
          await trx("loyalty_cards").where({ id, user_id: userId }).update(row);
        } else await trx("loyalty_cards").insert({ id, ...row });
        await trx("loyalty_card_identifiers").insert(fingerprints.map(fingerprint => ({ card_id: id, user_id: userId, program_id: card.programId, fingerprint })));
      });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "23505") throw new AppError("Card already exists for this program", 409);
      throw error;
    }
    return this.get(userId, id);
  }
  async create(userId: string, raw: unknown, upload?: { bytes: Buffer; mime: string }) {
    const card = parseInput(raw);
    const image = upload ? await checkLoyaltyImage(upload.bytes, upload.mime) : null;
    return this.persist(userId, randomUUID(), card, image);
  }
  async update(userId: string, id: string, raw: unknown) {
    const row = await this.owned(userId, id);
    const change = parseInput(raw, true);
    const card: CardInput = {
      programId: row.program_id, customProgramName: row.custom_program_name, nickname: row.nickname,
      membershipNumber: this.decrypt(row.membership_number_enc, id, "number"),
      barcodePayload: this.decrypt(row.barcode_payload_enc, id, "barcode"), barcodeFormat: row.barcode_format,
      ...change,
    };
    if (change.programId && change.programId !== "other" && change.customProgramName === undefined) card.customProgramName = null;
    if (change.barcodePayload === null && change.barcodeFormat === undefined) card.barcodeFormat = null;
    return this.persist(userId, id, card, null, row);
  }
  async replaceImage(userId: string, id: string, upload: { bytes: Buffer; mime: string }) {
    const row = await this.owned(userId, id);
    const image = await checkLoyaltyImage(upload.bytes, upload.mime);
    const card: CardInput = { programId: row.program_id, customProgramName: row.custom_program_name, nickname: row.nickname,
      membershipNumber: this.decrypt(row.membership_number_enc, id, "number"),
      barcodePayload: this.decrypt(row.barcode_payload_enc, id, "barcode"), barcodeFormat: row.barcode_format };
    return this.persist(userId, id, card, image, row);
  }
  async delete(userId: string, id: string) {
    await this.owned(userId, id);
    await this.db("loyalty_cards").where({ id, user_id: userId }).del();
  }
}
