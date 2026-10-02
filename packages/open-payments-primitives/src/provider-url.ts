export class PaymentError extends Error { constructor(message: string, public readonly statusCode = 502) { super(message); } }
export const createUrlValidators = (config: { origins: string[]; production?: boolean }, error: (message: string, status: number) => Error = (m, s) => new PaymentError(m, s)) => {

/** Wallet identifiers have no credentials, port, query, or fragment. Inspect the
 * raw authority because URL parsing removes an explicit default HTTPS port. */
const validateWalletAddress = (value: string): string => {
  let url: URL;
  try { url = new URL(value); } catch { throw error("Invalid wallet address", 400); }
  const authority = /^https:\/\/([^/?#]+)/i.exec(value)?.[1];
  if (!authority || /[\\\s\x00-\x1f]/.test(value) || url.protocol !== "https:" ||
      url.username || url.password || authority.includes("@") || value.includes("?") || value.includes("#") ||
      (authority.startsWith("[") ? !authority.endsWith("]") : authority.includes(":"))) {
    throw error("Wallet address must use HTTPS without credentials, ports, query, or fragment", 400);
  }
  validateProviderUrl(url.href);
  return url.href;
};

/** Only configured provider origins may receive credentials or outbound requests. */
const validateProviderUrl = (value: string): string => {
  let url: URL;
  try { url = new URL(value); } catch { throw error("Invalid provider URL", 502); }
  const origins = config.origins;
  if (url.protocol !== "https:" || url.username || url.password || url.hash ||
      (origins.length > 0 && !origins.includes(url.origin)) ||
      (config.production && origins.length === 0)) {
    throw error("Provider URL is not permitted", 502);
  }
  // Return the exact string supplied, including an intentionally absent slash.
  return value;
};

return { validateWalletAddress, validateProviderUrl };
};
