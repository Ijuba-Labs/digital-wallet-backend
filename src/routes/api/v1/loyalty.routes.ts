import { Router, type Request, type RequestHandler } from "express";
import busboy from "busboy";
import { AppError } from "@/utils/appError";
import { sendNoContent, sendSuccess } from "@/utils/apiResponse";
import type { LoyaltyService } from "@/services/loyalty.service";

interface Upload { bytes: Buffer; mime: string }

async function multipart(req: Request, requireCard: boolean): Promise<{ card: unknown; upload?: Upload }> {
  return new Promise((resolve, reject) => {
    let parser: ReturnType<typeof busboy>;
    // Busboy emits limit events when the configured count is reached, so use
    // one above the allowed count and reject any extra part ourselves.
    try { parser = busboy({ headers: req.headers, limits: { fields: requireCard ? 2 : 1, files: 2, parts: requireCard ? 3 : 2, fieldSize: 16_384, fileSize: 5 * 1024 * 1024 } }); }
    catch { reject(new AppError("Invalid multipart request", 400)); return; }
    let card: unknown;
    let upload: Upload | undefined;
    let failed: AppError | undefined;
    let fileCount = 0;
    let fieldCount = 0;
    parser.on("field", (name, value, info) => {
      fieldCount++;
      if (name !== "card" || !requireCard || info.valueTruncated || fieldCount > 1) { failed = new AppError("Invalid card part", 400); return; }
      try { card = JSON.parse(value); } catch { failed = new AppError("card part must contain JSON", 400); }
    });
    parser.on("file", (name, stream, info) => {
      fileCount++;
      if (name !== "image" || fileCount > 1) failed = new AppError("Invalid image part", 400);
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("limit", () => { failed = new AppError("Image exceeds 5 MB", 400); });
      stream.on("end", () => { upload = { bytes: Buffer.concat(chunks), mime: info.mimeType }; });
    });
    parser.on("partsLimit", () => { failed = new AppError("Too many multipart parts", 400); });
    parser.on("fieldsLimit", () => { failed = new AppError("Too many card parts", 400); });
    parser.on("filesLimit", () => { failed = new AppError("Too many image parts", 400); });
    parser.on("error", () => reject(new AppError("Invalid multipart request", 400)));
    req.on("aborted", () => reject(new AppError("Incomplete multipart request", 400)));
    parser.on("close", () => {
      if (failed) reject(failed);
      else if (requireCard && card === undefined) reject(new AppError("card part is required", 400));
      else if (!requireCard && !upload) reject(new AppError("image part is required", 400));
      else resolve({ card, upload });
    });
    req.pipe(parser);
  });
}

export function createLoyaltyRouter(requireAuth: RequestHandler, service: LoyaltyService, rateLimit: RequestHandler) {
  const router = Router();
  router.get("/loyalty-programs", async (req, res, next) => {
    try { sendSuccess(res, await service.programs(req.query)); } catch (error) { next(error); }
  });
  router.get("/loyalty-programs/:id", async (req, res, next) => {
    try { sendSuccess(res, await service.programDetails(String(req.params.id))); } catch (error) { next(error); }
  });
  router.get("/loyalty-programs/:id/template", async (req, res, next) => {
    try {
      if (Object.keys(req.query).some(key => key !== "version") || req.query.version !== undefined &&
        (typeof req.query.version !== "string" || !/^[1-9][0-9]{0,8}$/.test(req.query.version))) throw new AppError("Invalid template version", 400);
      sendSuccess(res, await service.template(String(req.params.id), req.query.version ? Number(req.query.version) : undefined));
    } catch (error) { next(error); }
  });
  router.use("/loyalty-cards", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  }, requireAuth, rateLimit);
  router.post("/loyalty-cards/preview", async (req, res, next) => {
    try {
      if (!req.is("application/json")) throw new AppError("Use JSON", 415);
      sendSuccess(res, await service.preview(req.body));
    } catch (error) { next(error); }
  });
  router.get("/loyalty-cards/:id/checkout", async (req, res, next) => {
    try { sendSuccess(res, await service.checkout(req.user!.id, String(req.params.id))); } catch (error) { next(error); }
  });
  router.get("/loyalty-cards", async (req, res, next) => {
    try { sendSuccess(res, await service.list(req.user!.id)); } catch (error) { next(error); }
  });
  router.post("/loyalty-cards", async (req, res, next) => {
    try {
      const isMultipart = req.is("multipart/form-data");
      if (!isMultipart && !req.is("application/json")) throw new AppError("Use JSON or multipart/form-data", 415);
      const { card, upload } = isMultipart ? await multipart(req, true) : { card: req.body, upload: undefined };
      sendSuccess(res, await service.create(req.user!.id, card, upload), 201);
    } catch (error) { next(error); }
  });
  router.get("/loyalty-cards/:id", async (req, res, next) => {
    try { sendSuccess(res, await service.get(req.user!.id, String(req.params.id))); } catch (error) { next(error); }
  });
  router.get("/loyalty-cards/:id/presentation", async (req, res, next) => {
    try { sendSuccess(res, await service.presentation(req.user!.id, String(req.params.id))); } catch (error) { next(error); }
  });
  router.get("/loyalty-cards/:id/image", async (req, res, next) => {
    try {
      const image = await service.image(req.user!.id, String(req.params.id));
      res.type(image.mime).send(image.bytes);
    } catch (error) { next(error); }
  });
  router.patch("/loyalty-cards/:id", async (req, res, next) => {
    try {
      if (!req.is("application/json")) throw new AppError("Use JSON", 415);
      sendSuccess(res, await service.update(req.user!.id, String(req.params.id), req.body));
    } catch (error) { next(error); }
  });
  router.put("/loyalty-cards/:id/image", async (req, res, next) => {
    try {
      if (!req.is("multipart/form-data")) throw new AppError("Use multipart/form-data", 415);
      const { upload } = await multipart(req, false);
      sendSuccess(res, await service.replaceImage(req.user!.id, String(req.params.id), upload!));
    } catch (error) { next(error); }
  });
  router.delete("/loyalty-cards/:id", async (req, res, next) => {
    try { await service.delete(req.user!.id, String(req.params.id)); sendNoContent(res); } catch (error) { next(error); }
  });
  return router;
}
