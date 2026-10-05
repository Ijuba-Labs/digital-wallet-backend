import { z } from "zod";

export const recipientSearchSchema = z.object({
  q: z.string().trim().min(3).max(254).regex(/^[^\x00-\x1f\x7f]+$/),
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(20)).default(10),
}).strict();

export type RecipientSearchInput = z.infer<typeof recipientSearchSchema>;
