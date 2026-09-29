import { AppError } from "./appError";

/** Only configured provider origins may receive credentials or outbound requests. */
export const validateProviderUrl = (value: string): string => {
  let url: URL;
  try { url = new URL(value); } catch { throw new AppError("Invalid provider URL", 502); }
  const origins = (process.env.OPEN_PAYMENTS_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (url.protocol !== "https:" || url.username || url.password || url.hash ||
      (origins.length > 0 && !origins.includes(url.origin)) ||
      (process.env.NODE_ENV === "production" && origins.length === 0)) {
    throw new AppError("Provider URL is not permitted", 502);
  }
  // Return the exact string supplied, including an intentionally absent slash.
  return value;
};
