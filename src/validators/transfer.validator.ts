import { z } from "zod";

export const createTransferSchema = z.object({
  recipientUserId: z.uuid(),
  senderWalletId: z.uuid().optional(),
  // Open Payments uses unsigned 64-bit integers encoded as strings, never floats.
  amount: z.string().regex(/^[1-9][0-9]{0,19}$/, "amount must be a positive integer string in minor units")
    .refine((value) => /^[1-9][0-9]{0,19}$/.test(value) && BigInt(value) <= 18446744073709551615n,
      "amount exceeds the Open Payments uint64 limit"),
  description: z.string().trim().min(1).max(280).optional(),
}).strict();

export const idempotencyKeySchema = z.string().min(1).max(128)
  .regex(/^[A-Za-z0-9._:-]+$/, "Idempotency-Key must contain only letters, numbers, '.', '_', ':', or '-'");

export const transferIdSchema = z.uuid();
export const transferCallbackSchema = z.object({
  transfer_id: transferIdSchema,
  interact_ref: z.string().min(1).max(2048).regex(/^[^\r\n]+$/),
  hash: z.string().min(1).max(128),
});

export const transferListSchema = z.object({
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(100)).default(20),
  offset: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(0).max(100000)).default(0),
});
