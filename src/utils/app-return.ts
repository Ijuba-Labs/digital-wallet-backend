/** Server-configured destinations only; callback query parameters never select a URL. */
export const validateAppReturnUrl = (value: string): string => {
  const url = new URL(value);
  const appLink = url.protocol === "ijubapay:" && url.hostname === "approval" &&
    /^\/(wallet|transfer|checkout|merchant)$/.test(url.pathname) && !url.port;
  if (url.username || url.password || url.search || url.hash ||
      !(appLink || (url.protocol === "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) {
    throw new Error("App return URL must be HTTPS or ijubapay://approval/{wallet,transfer,checkout,merchant}, without credentials, query, or fragment");
  }
  return url.href;
};

export const appReturnDestination = (value: string, ids: Record<string, string>): string => {
  const url = new URL(validateAppReturnUrl(value));
  for (const [name, id] of Object.entries(ids)) url.searchParams.set(name, id);
  return url.href;
};
