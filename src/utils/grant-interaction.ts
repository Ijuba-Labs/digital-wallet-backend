import { callbackFingerprint as fingerprint } from "@open-rewards/payment-primitives";
import { AppError } from "./appError";
export { createInteractionNonce, verifyInteractionHash, type GrantInteraction } from "@open-rewards/payment-primitives";
export const callbackFingerprint = (ref: string, hash: string) => { try { return fingerprint(ref, hash); } catch { throw new AppError("Invalid callback proof", 400); } };
