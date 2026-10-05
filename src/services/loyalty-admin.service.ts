import type { Knex } from "knex";
import { z } from "zod";
import { AppError } from "@/utils/appError";
import { programConfigurationSchema, cardTemplateSchema } from "@/types/loyalty";

export const publicationSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100),
  name: z.string().trim().min(1).max(200),
  configuration: programConfigurationSchema,
  template: z.object({ version: z.number().int().positive(), layout: cardTemplateSchema }).strict().optional(),
}).strict();
/** Operator-only service. Do not expose through customer JWT authentication. */
export class LoyaltyAdminService {
  constructor(private readonly db: Knex, private readonly approvedAssetHosts: string[] = []) {}
  async publish(raw: unknown) {
    const parsed = publicationSchema.safeParse(raw);
    if (!parsed.success) throw new AppError("Invalid loyalty publication configuration", 400);
    const p = parsed.data;
    const assets = [p.configuration.logoUrl, p.template?.layout.logo?.assetUrl,
      p.template?.layout.background.type === "asset" ? p.template.layout.background.assetUrl : undefined].filter(Boolean) as string[];
    if (assets.some(asset => !this.approvedAssetHosts.includes(new URL(asset).host))) throw new AppError("Use an approved loyalty asset CDN host", 400);
    await this.db.transaction(async trx => {
      // Serialize publications even for a previously nonexistent program.
      await trx.raw("SELECT pg_advisory_xact_lock(hashtext(?))", [`loyalty-program:${p.id}`]);
      const current = await trx("loyalty_programs").where({ id: p.id }).first();
      if (!current) await trx("loyalty_programs").insert({ id: p.id, name: p.name, requires_custom_name: p.id === "other", configuration: JSON.stringify(p.configuration) });
      let version: number | null = current?.current_template_version ?? null;
      if (p.template) {
        const last = await trx("loyalty_card_templates").where({ program_id: p.id }).max("version as version").first();
        if (p.template.version <= Number(last?.version ?? 0)) throw new AppError("Publish a new template version; existing versions are immutable", 409);
        version = p.template.version;
        await trx("loyalty_card_templates").insert({ program_id: p.id, version, template_json: JSON.stringify(p.template.layout) });
      }
      const template = version && await trx("loyalty_card_templates").where({ program_id: p.id, version, enabled: true }).first();
      if (p.configuration.status === "DIGITAL_CARD_VERIFIED" && !template) throw new AppError("Verified checkout requires an enabled template", 409);
      await trx("loyalty_programs").where({ id: p.id }).update({ name: p.name, configuration: JSON.stringify(p.configuration), current_template_version: version, updated_at: trx.fn.now() });
    });
  }
  async disableTemplate(programId: string, version: number) {
    if (!Number.isSafeInteger(version) || version < 1) throw new AppError("Invalid template version", 400);
    const changed = await this.db("loyalty_card_templates").where({ program_id: programId, version }).update({ enabled: false });
    if (!changed) throw new AppError("Template not found", 404);
  }
}
