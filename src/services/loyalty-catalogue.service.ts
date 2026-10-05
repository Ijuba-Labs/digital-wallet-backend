import type { Knex } from "knex";
import { z } from "zod";
import { AppError } from "@/utils/appError";
import { cardTemplateSchema, programConfigurationSchema, type LoyaltyProgram, type CardTemplate, type ProgramConfiguration } from "@/types/loyalty";

export const catalogueQuerySchema = z.object({
  q: z.string().trim().max(100).optional(), retailer: z.string().trim().max(100).optional(),
  category: z.string().max(100).optional(), rewardType: z.string().max(100).optional(),
  digitalCardSupported: z.enum(["true", "false"]).optional(),
}).strict();

export function checkoutAllowed(p: ProgramConfiguration, templateAvailable: boolean): boolean {
  const v = p.verification;
  return p.active && p.status === "DIGITAL_CARD_VERIFIED" && p.capabilities.digitalCard && p.capabilities.staticBarcode &&
    p.barcodeFormat !== "UNKNOWN" && v.barcodeFormatVerified && v.numberFormatVerified && v.digitalReproductionAllowed && v.templateVerified &&
    !!v.barcodeSource && !!v.numberSource && !!v.permissionSource && !!v.templateSource && !!v.verifiedAt && templateAvailable;
}
export class LoyaltyCatalogueService {
  constructor(private readonly db: Knex) {}
  private query() {
    return this.db("loyalty_programs as p").leftJoin("loyalty_card_templates as t", function () {
      this.on("p.id", "=", "t.program_id").andOn("p.current_template_version", "=", "t.version");
    }).select("p.*", "t.enabled as template_enabled");
  }
  private model(row: any): LoyaltyProgram {
    const parsed = programConfigurationSchema.safeParse(row.configuration);
    if (!parsed.success) throw new AppError("Loyalty program configuration is unavailable", 503);
    return { ...parsed.data, id: row.id, slug: row.id, name: row.name, requiresCustomName: row.requires_custom_name,
      currentTemplateVersion: row.current_template_version, digitalCardSupported: checkoutAllowed(parsed.data, row.template_enabled === true) };
  }
  async list(raw: unknown = {}) {
    const query = catalogueQuerySchema.safeParse(raw);
    if (!query.success) throw new AppError("Check your program search filters and try again", 400);
    const f = query.data;
    // The catalogue is small, and filtering the validated public model ensures the
    // support indicator uses exactly the same gate as checkout, not a stored flag.
    return (await this.query().orderBy("p.name")).map(row => this.model(row)).filter(p => p.active)
      .filter(p => !f.q || `${p.name} ${p.retailerName}`.toLowerCase().includes(f.q.toLowerCase()))
      .filter(p => !f.retailer || p.retailerName.toLowerCase().includes(f.retailer.toLowerCase()))
      .filter(p => !f.category || p.category === f.category)
      .filter(p => !f.rewardType || p.rewardType === f.rewardType)
      .filter(p => f.digitalCardSupported === undefined || p.digitalCardSupported === (f.digitalCardSupported === "true"));
  }
  async get(id: string) {
    const row = await this.query().where("p.id", id).first();
    if (!row) throw new AppError("Loyalty program not found", 404);
    return this.model(row);
  }
  async template(programId: string, version?: number): Promise<CardTemplate> {
    const p = await this.get(programId);
    const wanted = version ?? p.currentTemplateVersion;
    if (!wanted || !Number.isSafeInteger(wanted) || wanted < 1) throw new AppError("Card artwork is unavailable", 404);
    const row = await this.db("loyalty_card_templates").where({ program_id: programId, version: wanted, enabled: true }).first();
    if (!row) throw new AppError("This card artwork is temporarily unavailable", 409);
    const parsed = cardTemplateSchema.safeParse(row.template_json);
    if (!parsed.success) throw new AppError("Card artwork is unavailable", 503);
    return { ...parsed.data, id: `${programId}-v${wanted}`, programId, version: wanted };
  }
}
