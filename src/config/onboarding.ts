import { AppError } from "@/utils/appError";

export type OnboardingClientId = "api" | "web" | "mobile";

export type OnboardingConfig = {
  apiPublicUrl: string;
  returnUrls: Readonly<Partial<Record<OnboardingClientId, string | null>>>;
};

export const createOnboardingConfig = (input: {
  apiPublicUrl: string;
  webReturnUrl?: string;
  mobileReturnUrl?: string;
  allowLocalHttp?: boolean;
}): OnboardingConfig => {
  const validateUrl = (value: string, name: string, allowLocalHttp: boolean): URL => {
    const url = new URL(value);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.username || url.password || url.hash || url.search ||
        (url.protocol !== "https:" && !(allowLocalHttp && local && url.protocol === "http:")) ||
        (local && !allowLocalHttp)) {
      throw new Error(`${name} must be an HTTPS URL without credentials, query, or fragment (local HTTP is allowed only in development)`);
    }
    return url;
  };

  const api = validateUrl(input.apiPublicUrl, "API_PUBLIC_URL", input.allowLocalHttp ?? false);
  if (api.pathname !== "/") throw new Error("API_PUBLIC_URL must contain only the public API origin");

  const returnUrls: Partial<Record<OnboardingClientId, string | null>> = { api: null };
  if (input.webReturnUrl) {
    returnUrls.web = validateUrl(input.webReturnUrl, "ONBOARDING_WEB_RETURN_URL", input.allowLocalHttp ?? false).href;
  }
  if (input.mobileReturnUrl) {
    returnUrls.mobile = validateUrl(input.mobileReturnUrl, "ONBOARDING_MOBILE_RETURN_URL", false).href;
  }
  return { apiPublicUrl: api.origin, returnUrls: Object.freeze(returnUrls) };
};

export const getOnboardingReturnUrl = (config: OnboardingConfig, clientId: OnboardingClientId): string | null => {
  const destination = config.returnUrls[clientId];
  if (destination === undefined) throw new AppError("Onboarding client is not configured", 400);
  return destination;
};
