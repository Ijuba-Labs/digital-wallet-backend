import { AppError } from "./appError";

/** Wallet identifiers have no credentials, port, query, or fragment. Inspect the
 * raw authority because URL parsing removes an explicit default HTTPS port. */
export const validateWalletAddress = (value: string): string => {
  let url: URL;
  try { url = new URL(value); } catch { throw new AppError("Invalid wallet address", 400); }
  const authority = /^https:\/\/([^/?#]+)/i.exec(value)?.[1];
  if (!authority || /[\\\s\x00-\x1f]/.test(value) || url.protocol !== "https:" ||
      url.username || url.password || authority.includes("@") || value.includes("?") || value.includes("#") ||
      (authority.startsWith("[") ? !authority.endsWith("]") : authority.includes(":"))) {
    throw new AppError("Wallet address must use HTTPS without credentials, ports, query, or fragment", 400);
  }
  validateProviderUrl(url.href);
  return url.href;
};

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
