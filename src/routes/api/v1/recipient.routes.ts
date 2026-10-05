import { Router, type RequestHandler } from "express";
import type { RecipientService } from "@/services/recipient.service";
import { recipientSearchSchema } from "@/validators/recipient.validator";
import { AppError } from "@/utils/appError";
import { sendSuccess } from "@/utils/apiResponse";

export function createRecipientRouter(requireAuth: RequestHandler, limitSearch: RequestHandler, service: RecipientService) {
  const router = Router();
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  }, requireAuth);
  router.get("/search", limitSearch, async (req, res, next) => {
    try {
      const input = recipientSearchSchema.safeParse(req.query);
      if (!input.success) throw new AppError("Use q with 3–254 characters and limit between 1 and 20", 400);
      if (!req.user?.id) throw new AppError("Access token is required", 401);
      sendSuccess(res, await service.search(req.user.id, input.data));
    } catch (error) { next(error); }
  });
  return router;
}
