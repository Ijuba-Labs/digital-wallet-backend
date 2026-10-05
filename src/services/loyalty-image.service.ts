import path from "node:path";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { BinaryBitmap, HybridBinarizer, MultiFormatOneDReader, QRCodeReader, DataMatrixReader, PDF417Reader, RGBLuminanceSource } from "@zxing/library";
import { createWorker, PSM } from "tesseract.js";
import { AppError } from "@/utils/appError";

export interface CheckedLoyaltyImage {
  bytes: Buffer;
  mime: "image/jpeg";
  detection: "barcode" | "number";
  detectedValue: string;
}

const plausibleNumber = (text: string): string | undefined => {
  // Require a substantial digit run; a logo or a date alone must not pass.
  const matches = text.match(/(?:\d[ -]?){8,24}/g) ?? [];
  return matches.map(s => s.replace(/[^0-9]/g, "")).find(s => s.length >= 8 && s.length <= 24);
};

async function withinDetectionDeadline<T>(promise: Promise<T>, failed?: Promise<never>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Image detection timed out")), 15_000);
  });
  try { return await Promise.race(failed ? [promise, failed, timeout] : [promise, timeout]); }
  finally { if (timer) clearTimeout(timer); }
}

export async function checkLoyaltyImage(bytes: Buffer, declaredMime: string): Promise<CheckedLoyaltyImage> {
  if (!(["image/png", "image/jpeg"].includes(declaredMime)) || !bytes.length || bytes.length > 5 * 1024 * 1024)
    throw new AppError("Image must be a PNG or JPEG no larger than 5 MB", 400);
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if ((declaredMime === "image/png" && !png) || (declaredMime === "image/jpeg" && !jpeg))
    throw new AppError("Image content does not match its file type", 400);
  let normalized: Buffer;
  let width: number;
  let height: number;
  try {
    const metadata = await sharp(bytes, { limitInputPixels: 25_000_000 }).metadata();
    width = metadata.width ?? 0; height = metadata.height ?? 0;
    if (metadata.pages && metadata.pages > 1 || width < 100 || height < 80 || width > 6000 || height > 6000)
      throw new AppError("Image dimensions are unsupported", 400);
    // Re-encoding strips EXIF, profiles, comments, and other source metadata.
    normalized = await sharp(bytes, { limitInputPixels: 25_000_000 }).rotate().flatten({ background: "white" })
      .jpeg({ quality: 90 }).toBuffer();
    const dimensions = await sharp(normalized).metadata();
    width = dimensions.width!; height = dimensions.height!;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("Invalid image", 400);
  }

  try {
    const { data } = await sharp(normalized).greyscale().raw().toBuffer({ resolveWithObject: true });
    const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(new Uint8ClampedArray(data), width, height)));
    for (const reader of [new MultiFormatOneDReader(), new QRCodeReader(), new DataMatrixReader(), new PDF417Reader()]) {
      try {
        const result = reader.decode(bitmap);
        if (result.getText()) return { bytes: normalized, mime: "image/jpeg", detection: "barcode", detectedValue: result.getText() };
      } catch (error) {
        if (!(error instanceof Error && ["NotFoundException", "FormatException", "ChecksumException"].includes(error.name))) throw error;
      }
    }
  } catch (error) {
    throw new AppError("Image detection is unavailable", 503);
  }

  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
  try {
    const assetDir = process.env.LOYALTY_OCR_ASSET_DIR ?? path.resolve(process.cwd(), "assets/tesseract");
    const model = await readFile(path.join(assetDir, "eng.traineddata.gz"));
    if (createHash("sha256").update(model).digest("hex") !== "45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91")
      throw new Error("OCR model checksum mismatch");
    let reportFailure: (error: Error) => void = () => undefined;
    const workerFailure = new Promise<never>((_, reject) => { reportFailure = reject; });
    worker = await withinDetectionDeadline(createWorker("eng", 1, {
      langPath: assetDir,
      cacheMethod: "none",
      gzip: true,
      errorHandler: (error) => reportFailure(new Error(String(error))),
    }), workerFailure);
    await withinDetectionDeadline(worker.setParameters({ tessedit_char_whitelist: "0123456789 -", tessedit_pageseg_mode: PSM.SPARSE_TEXT }));
    const { data } = await withinDetectionDeadline(worker.recognize(normalized));
    const number = plausibleNumber(data.text);
    if (!number) throw new AppError("No barcode or membership number detected in image", 422);
    return { bytes: normalized, mime: "image/jpeg", detection: "number", detectedValue: number };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("Image detection is unavailable", 503);
  } finally {
    if (worker) await worker.terminate().catch(() => undefined);
  }
}
