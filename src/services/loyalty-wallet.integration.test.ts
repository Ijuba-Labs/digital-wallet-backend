import { beforeAll, afterAll, describe, expect, it } from "@jest/globals";
import { createRequire } from "node:module";
import type { Knex } from "knex";
import { createTestDatabase } from "../../tests/database";
import { testProgram } from "../../tests/fixtures/loyalty";
import { neutralTemplate } from "@/types/loyalty";
import { LoyaltyService } from "./loyalty.service";
import { LoyaltyAdminService } from "./loyalty-admin.service";
const require = createRequire(import.meta.url);
const vaultMigration = require("../database/knex-migrations/202610050001_loyalty_cards.cjs");
const walletMigration = require("../database/knex-migrations/202610050003_loyalty_wallet.cjs");
const owner = "00000000-0000-4000-8000-000000000011";
const stranger = "00000000-0000-4000-8000-000000000012";
const { id, slug, name, currentTemplateVersion, requiresCustomName, digitalCardSupported, ...configuration } = testProgram;

describe("data-driven loyalty wallet with PostgreSQL", () => {
  let db: Knex, service: LoyaltyService, admin: LoyaltyAdminService;
  beforeAll(async () => {
    db = await createTestDatabase(); service = new LoyaltyService(db); admin = new LoyaltyAdminService(db);
    await db("users").insert([{ id: owner, email: "loyalty-wallet@test.invalid" }, { id: stranger, email: "loyalty-stranger@test.invalid" }]);
    await admin.publish({ id, name, configuration, template: { version: 1, layout: neutralTemplate } });
  });
  afterAll(async () => { await db("users").whereIn("id", [owner, stranger]).del(); await db.destroy(); });
  it("seeds neutral catalogue-only entries and supports search/filtering", async () => {
    const programs = await service.programs();
    const real = programs.filter(p => p.id !== id);
    expect(real.length).toBeGreaterThanOrEqual(7);
    expect(real.every(p => p.barcodeFormat === "UNKNOWN" && !p.digitalCardSupported && p.status === "CATALOGUE_ONLY")).toBe(true);
    expect((await service.programs({ q: "clicks", category: "HEALTH_AND_BEAUTY" })).map(p => p.id)).toEqual(["clicks-clubcard"]);
    expect((await service.programs({ digitalCardSupported: "true" })).map(p => p.id)).toEqual([id]);
    await expect(service.programs({ q: ["invalid"] })).rejects.toMatchObject({ statusCode: 400 });
    expect((await service.template("clicks-clubcard")).background).toEqual(neutralTemplate.background);
  });
  it("validates preview without persistence and retains independent exact barcode data", async () => {
    const input = { programId: id, membershipNumber: "00112233", barcodePayload: " DIFFERENT-001 ", barcodeFormat: "CODE_128" };
    const preview = await service.preview(input);
    expect(preview.canGenerateBarcode).toBe(true);
    expect(preview).not.toHaveProperty("barcodePayload");
    expect(await service.list(owner)).toHaveLength(0);
    await expect(service.preview({ ...input, barcodeFormat: "QR_CODE" })).rejects.toMatchObject({ statusCode: 422 });
    const created = await service.create(owner, input);
    const presentation = await service.presentation(owner, created.id);
    expect(presentation.canGenerateBarcode).toBe(false);
    expect(presentation.barcodePayload).toBe(input.barcodePayload);
    const checkout = await service.checkout(owner, created.id);
    expect(checkout.barcodePayload).toBe(input.barcodePayload);
    expect(checkout.membershipNumber).toBe(input.membershipNumber);
    expect(checkout.template.version).toBe(1);
    expect(checkout.program.digitalCardSupported).toBe(true);
    expect(new Date(checkout.offlineValidUntil).getTime() - new Date(checkout.checkedAt).getTime()).toBe(86400000);
    const stored = await db("loyalty_cards").where({ id: created.id }).first();
    expect(stored.barcode_payload_enc).not.toContain(input.barcodePayload);
    expect(stored.membership_number_enc).not.toContain(input.membershipNumber);
    expect(JSON.stringify(await service.list(owner))).not.toContain(input.membershipNumber);
    await expect(service.checkout(stranger, created.id)).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.replaceImage(stranger, created.id, { bytes: Buffer.from("invalid"), mime: "image/png" })).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.create(owner, input)).rejects.toMatchObject({ statusCode: 409 });
    await service.delete(owner, created.id);
  });
  it("never derives a barcode from a manually entered membership number", async () => {
    const card = await service.create(owner, { programId: id, membershipNumber: "77889900" });
    expect((await service.preview({ programId: id, membershipNumber: "77889900" })).canGenerateBarcode).toBe(false);
    await expect(service.checkout(owner, card.id)).rejects.toMatchObject({ statusCode: 422 });
    await service.delete(owner, card.id);
    const unverified = await service.create(owner, { programId: "smart-shopper", barcodePayload: "TEST-ONLY-001", barcodeFormat: "CODE_128" });
    await expect(service.checkout(owner, unverified.id)).rejects.toMatchObject({ statusCode: 409 });
    await service.delete(owner, unverified.id);
  });
  it("prevents racing duplicate saves, immutable-version overwrites and cross-program template references", async () => {
    const input = { programId: id, membershipNumber: "11223344", barcodePayload: "TEST-RACE-001", barcodeFormat: "CODE_128" };
    const results = await Promise.allSettled([service.create(owner, input), service.create(owner, input)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(r => r.status === "rejected").map(r => (r as PromiseRejectedResult).reason.statusCode)).toEqual([409]);
    const saved = (results.find(r => r.status === "fulfilled") as PromiseFulfilledResult<any>).value;
    await expect(db("loyalty_cards").where({ id: saved.id }).update({ template_version: 99 })).rejects.toMatchObject({ code: "23503" });
    await expect(admin.publish({ id, name, configuration, template: { version: 1, layout: neutralTemplate } })).rejects.toMatchObject({ statusCode: 409 });
    await admin.publish({ id, name, configuration, template: { version: 2, layout: { ...neutralTemplate, aspectRatio: 1.6 } } });
    expect((await service.checkout(owner, saved.id)).effectiveTemplateVersion).toBe(1);
    expect((await service.template(id)).version).toBe(2);
    await admin.disableTemplate(id, 1);
    await expect(service.checkout(owner, saved.id)).rejects.toMatchObject({ statusCode: 409 });
    // A nickname edit must not repin a disabled version to different artwork.
    await service.update(owner, saved.id, { nickname: "Test card" });
    expect((await service.get(owner, saved.id)).templateVersion).toBe(1);
    await service.delete(owner, saved.id);
  });
  it("honours immediate program disable and approved asset hosts", async () => {
    const card = await service.create(owner, { programId: id, barcodePayload: "TEST-DISABLE-001", barcodeFormat: "CODE_128" });
    await expect(admin.publish({ id, name, configuration: { ...configuration, logoUrl: "https://unapproved.test/logo.png" } })).rejects.toMatchObject({ statusCode: 400 });
    await admin.publish({ id, name, configuration: { ...configuration, status: "TEMPORARILY_DISABLED" } });
    await expect(service.checkout(owner, card.id)).rejects.toMatchObject({ statusCode: 409 });
    expect((await service.programDetails(id)).digitalCardSupported).toBe(false);
    await expect(service.create(owner, { programId: id, membershipNumber: "99990000" })).rejects.toMatchObject({ statusCode: 409 });
    expect(await service.list(owner)).toHaveLength(1);
    await service.delete(owner, card.id);
  });
  it("upgrades a populated legacy vault without rewriting membership data", async () => {
    await db.raw("CREATE SCHEMA loyalty_upgrade_test");
    // Migration functions require a Knex instance with its own search_path.
    const { default: knex } = await import("knex");
    const old = knex({ client: "pg", connection: db.client.config.connection, searchPath: ["loyalty_upgrade_test"] });
    try {
      await old.schema.createTable("users", t => { t.uuid("id").primary(); });
      await old("users").insert({ id: owner });
      await vaultMigration.up(old);
      await old("loyalty_cards").insert({ id: owner, user_id: owner, program_id: "clicks-clubcard", membership_number_enc: "synthetic-legacy-ciphertext", membership_number_mask: "••••1234" });
      await walletMigration.up(old);
      const row = await old("loyalty_cards").where({ id: owner }).first();
      expect(row.membership_number_enc).toBe("synthetic-legacy-ciphertext");
      expect(row.template_version).toBeNull();
      expect((await old("loyalty_programs").where({ id: "clicks-clubcard" }).first()).configuration.barcodeFormat).toBe("UNKNOWN");
      await walletMigration.up(old);
      expect(await old("loyalty_card_templates")).toHaveLength(7);
    } finally { await old.destroy(); await db.raw("DROP SCHEMA loyalty_upgrade_test CASCADE"); }
  });
});
