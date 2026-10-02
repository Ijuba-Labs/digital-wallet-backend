import { callbackFingerprint as fingerprint } from "@ijuba-labs/payment-primitives";
import { AppError } from "./appError";
export { createInteractionNonce, verifyInteractionHash, type GrantInteraction } from "@ijuba-labs/payment-primitives";
export const callbackFingerprint = (ref: string, hash: string) => { try { return fingerprint(ref, hash); } catch { throw new AppError("Invalid callback proof", 400); } };
