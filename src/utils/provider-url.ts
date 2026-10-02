import { createUrlValidators } from "@open-rewards/payment-primitives";
import { AppError } from "./appError";
const validators = () => createUrlValidators({ origins: (process.env.OPEN_PAYMENTS_ALLOWED_ORIGINS ?? "").split(",").map(s => s.trim()).filter(Boolean), production: process.env.NODE_ENV === "production" }, (m, s) => new AppError(m, s));
export const validateProviderUrl = (value: string) => validators().validateProviderUrl(value);
export const validateWalletAddress = (value: string) => validators().validateWalletAddress(value);
