import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import jwt from "jsonwebtoken";
import sharp from "sharp";
import type Redis from "ioredis";
import { BarcodeFormat, QRCodeWriter } from "@zxing/library";
import { createApp } from "@/app";
import { env } from "@/config/env";
import { createTestDatabase } from "../../../../tests/database";
import type { Knex } from "knex";

describe("loyalty card vault", () => {
  let db: Knex;
  let app: ReturnType<typeof createApp>;
  const ids = ["47bb6a98-d535-4db6-bf90-c2090466a801", "47bb6a98-d535-4db6-bf90-c2090466a802"];
  const token = (index: number) => `Bearer ${jwt.sign({ id: ids[index], email: `loyalty-${index}@example.test` }, env.JWT_SECRET)}`;
  const url = "/api/v1/loyalty-cards";
  let xtra: Buffer;

  beforeAll(async () => {
    db = await createTestDatabase();
    app = createApp({ db, redis: { eval: async () => [1, 60000] } as unknown as Redis });
    xtra = await qrImage("SYNTHETIC-XTRA-00112233");
    await db("users").insert(ids.map((id, index) => ({ id, email: `loyalty-${index}@example.test` })));
  });
  afterAll(async () => {
    await db("users").whereIn("id", ids).del();
    await db.destroy();
  });

  async function qrImage(payload: string) {
    const matrix = new QRCodeWriter().encode(payload, BarcodeFormat.QR_CODE, 400, 400, new Map());
    const pixels = Buffer.alloc(400 * 400);
    for (let y = 0; y < 400; y++) for (let x = 0; x < 400; x++) pixels[y * 400 + x] = matrix.get(x, y) ? 0 : 255;
    return sharp(pixels, { raw: { width: 400, height: 400, channels: 1 } }).png().toBuffer();
  }

  it("lists public programs and requires auth for cards", async () => {
    const programs = await request(app).get("/api/v1/loyalty-programs").expect(200);
    expect(programs.body.data.map((p: any) => p.id)).toEqual(expect.arrayContaining(["xtra-savings", "clicks-clubcard", "smart-shopper", "other"]));
    await request(app).get(url).expect(401);
  });

  it("exposes versioned neutral templates and validates catalogue-only previews without saving", async () => {
    const details = await request(app).get("/api/v1/loyalty-programs/clicks-clubcard").expect(200);
    expect(details.body.data.digitalCardSupported).toBe(false);
    const template = await request(app).get("/api/v1/loyalty-programs/clicks-clubcard/template").query({ version: "1" }).expect(200);
    expect(template.body.data.version).toBe(1);
    await request(app).get("/api/v1/loyalty-programs/clicks-clubcard/template").query({ version: "-1" }).expect(400);
    const before = await db("loyalty_cards").where({ user_id: ids[0] }).count("* as count").first();
    const preview = await request(app).post(`${url}/preview`).set("Authorization", token(0))
      .send({ programId: "clicks-clubcard", membershipNumber: "111122223333" }).expect(200);
    expect(preview.body.data.canGenerateBarcode).toBe(false);
    expect(JSON.stringify(preview.body)).not.toContain("111122223333");
    expect(await db("loyalty_cards").where({ user_id: ids[0] }).count("* as count").first()).toEqual(before);
    await request(app).post(`${url}/preview`).send({ programId: "clicks-clubcard", membershipNumber: "111122223333" }).expect(401);
    const created = await request(app).post(url).set("Authorization", token(0))
      .send({ programId: "clicks-clubcard", membershipNumber: "111122223333" }).expect(201);
    await request(app).get(`${url}/${created.body.data.id}/checkout`).set("Authorization", token(0)).expect(409);
    await request(app).get(`${url}/${created.body.data.id}/checkout`).set("Authorization", token(1)).expect(404);
    await request(app).delete(`${url}/${created.body.data.id}`).set("Authorization", token(0)).expect(204);
  });

  it("saves number-only cards, masks lists, encrypts storage, and rejects duplicates", async () => {
    const created = await request(app).post(url).set("Authorization", token(0)).send({ programId: "clicks-clubcard", membershipNumber: "1234 5678 9012" }).expect(201);
    const id = created.body.data.id;
    expect(created.body.data.membershipNumberMasked).toBe("••••9012");
    expect(JSON.stringify(created.body)).not.toContain("1234 5678 9012");
    const row = await db("loyalty_cards").where({ id }).first();
    expect(row.membership_number_enc).not.toContain("1234 5678 9012");
    expect(row.barcode_format).toBeNull();
    const list = await request(app).get(url).set("Authorization", token(0)).expect(200);
    expect(list.headers["cache-control"]).toBe("no-store");
    expect(JSON.stringify(list.body)).not.toContain("1234 5678 9012");
    const presentation = await request(app).get(`${url}/${id}/presentation`).set("Authorization", token(0)).expect(200);
    expect(presentation.body.data.membershipNumber).toBe("1234 5678 9012");
    expect(presentation.body.data.barcodeFormat).toBeNull();
    await request(app).post(url).set("Authorization", token(0)).send({ programId: "clicks-clubcard", membershipNumber: "123456789012" }).expect(409);
    const anotherOwner = await request(app).post(url).set("Authorization", token(1)).send({ programId: "clicks-clubcard", membershipNumber: "123456789012" }).expect(201);
    await request(app).delete(`${url}/${anotherOwner.body.data.id}`).set("Authorization", token(1)).expect(204);
    await request(app).get(`${url}/${id}`).set("Authorization", token(1)).expect(404);
    await request(app).get(`${url}/${id}/presentation`).set("Authorization", token(1)).expect(404);
    await request(app).patch(`${url}/${id}`).set("Authorization", token(1)).send({ nickname: "stolen" }).expect(404);
    await request(app).delete(`${url}/${id}`).set("Authorization", token(1)).expect(404);
    await request(app).delete(`${url}/${id}`).set("Authorization", token(0)).expect(204);
  });

  it("accepts barcode-only and combined cards, and updates nicknames", async () => {
    const first = await request(app).post(url).set("Authorization", token(0)).send({ programId: "smart-shopper", barcodePayload: "ABC12345678", barcodeFormat: "CODE_128" }).expect(201);
    const id = first.body.data.id;
    expect(first.body.data.membershipNumberMasked).toBeNull();
    const presentation = await request(app).get(`${url}/${id}/presentation`).set("Authorization", token(0)).expect(200);
    expect(presentation.body.data.barcodePayload).toBe("ABC12345678");
    await request(app).patch(`${url}/${id}`).set("Authorization", token(0)).send({ nickname: "Groceries", membershipNumber: "9988776655" }).expect(200);
    await request(app).post(url).set("Authorization", token(0)).send({ programId: "other", customProgramName: "Local shop", membershipNumber: "1100220033", barcodePayload: "XYZ-1100220033", barcodeFormat: "QR_CODE" }).expect(201);
    await request(app).post(url).set("Authorization", token(0)).send({ programId: "other", customProgramName: "Another shop", membershipNumber: "1100220033" }).expect(201);
    await request(app).post(url).set("Authorization", token(0)).send({ programId: "other", customProgramName: "Local shop", membershipNumber: "1100220033" }).expect(409);
    await request(app).post(url).set("Authorization", token(0)).send({ programId: "other", membershipNumber: "44112233" }).expect(400);
    await request(app).post(url).set("Authorization", token(0)).send({ programId: "smart-shopper", barcodePayload: "without-format" }).expect(400);
  });

  it("accepts an image alone, uses a synthetic card image, replaces and deletes it", async () => {
    const created = await request(app).post(url).set("Authorization", token(0))
      .field("card", JSON.stringify({ programId: "xtra-savings" }))
      .attach("image", xtra, { filename: "xtra.png", contentType: "image/png" }).expect(201);
    const id = created.body.data.id;
    expect(created.body.data.hasImage).toBe(true);
    expect(created.body.data.imageDetection).toMatch(/barcode|number/);
    const row = await db("loyalty_cards").where({ id }).first();
    expect(row.image_enc).not.toContain(xtra.toString("base64").slice(0, 40));
    const image = await request(app).get(`${url}/${id}/image`).set("Authorization", token(0)).expect(200);
    expect(image.headers["content-type"]).toContain("image/jpeg");
    await request(app).get(`${url}/${id}/image`).set("Authorization", token(1)).expect(404);
    const replacement = await qrImage("LOYALTY-76543210");
    const updated = await request(app).put(`${url}/${id}/image`).set("Authorization", token(0))
      .attach("image", replacement, { filename: "qr.png", contentType: "image/png" }).expect(200);
    expect(updated.body.data.imageDetection).toBe("barcode");
    const blank = await sharp({ create: { width: 400, height: 300, channels: 3, background: "white" } }).png().toBuffer();
    await request(app).put(`${url}/${id}/image`).set("Authorization", token(0))
      .attach("image", blank, { filename: "blank.png", contentType: "image/png" }).expect(422);
    expect((await request(app).get(`${url}/${id}`).set("Authorization", token(0)).expect(200)).body.data.imageDetection).toBe("barcode");
    const presentation = await request(app).get(`${url}/${id}/presentation`).set("Authorization", token(0)).expect(200);
    expect(presentation.body.data.imageUrl).toBe(`${url}/${id}/image`);
    await request(app).delete(`${url}/${id}`).set("Authorization", token(0)).expect(204);
    await request(app).get(`${url}/${id}/image`).set("Authorization", token(0)).expect(404);
    const combined = await request(app).post(url).set("Authorization", token(0))
      .field("card", JSON.stringify({ programId: "clicks-clubcard", membershipNumber: "76543210", barcodePayload: "LOYALTY-76543210", barcodeFormat: "QR_CODE" }))
      .attach("image", replacement, { filename: "qr.png", contentType: "image/png" }).expect(201);
    const combinedPresentation = await request(app).get(`${url}/${combined.body.data.id}/presentation`).set("Authorization", token(0)).expect(200);
    expect(combinedPresentation.body.data.membershipNumber).toBe("76543210");
    expect(combinedPresentation.body.data.barcodePayload).toBe("LOYALTY-76543210");
    await request(app).delete(`${url}/${combined.body.data.id}`).set("Authorization", token(0)).expect(204);
  });

  it("rejects blank and invalid files before saving", async () => {
    const blank = await sharp({ create: { width: 400, height: 300, channels: 3, background: "white" } }).png().toBuffer();
    await request(app).post(url).set("Authorization", token(0)).field("card", JSON.stringify({ programId: "xtra-savings" }))
      .attach("image", blank, { filename: "blank.png", contentType: "image/png" }).expect(422);
    await request(app).post(url).set("Authorization", token(0)).field("card", JSON.stringify({ programId: "xtra-savings" }))
      .attach("image", Buffer.from("not an image"), { filename: "fake.png", contentType: "image/png" }).expect(400);
    const oldAssetDir = process.env.LOYALTY_OCR_ASSET_DIR;
    process.env.LOYALTY_OCR_ASSET_DIR = "/private/tmp/missing-loyalty-ocr-assets";
    try {
      await request(app).post(url).set("Authorization", token(0)).field("card", JSON.stringify({ programId: "xtra-savings" }))
        .attach("image", blank, { filename: "blank.png", contentType: "image/png" }).expect(503);
    } finally {
      if (oldAssetDir === undefined) delete process.env.LOYALTY_OCR_ASSET_DIR;
      else process.env.LOYALTY_OCR_ASSET_DIR = oldAssetDir;
    }
    expect(await db("loyalty_cards").where({ user_id: ids[0], program_id: "xtra-savings" })).toHaveLength(0);
  });
});
