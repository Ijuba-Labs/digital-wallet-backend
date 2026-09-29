import type { Request, Response, NextFunction } from "express";
import type { ZodType } from "zod";
import type { TransferService } from "@/services/transfer.service";
import { AppError } from "@/utils/appError";
import { sendSuccess } from "@/utils/apiResponse";
import {
  createTransferSchema, idempotencyKeySchema, transferCallbackSchema, transferIdSchema, transferListSchema,
} from "@/validators/transfer.validator";

const parse = <T>(schema: ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError("Invalid transfer request", 400, result.error.flatten());
  return result.data;
};

const userId = (req: Request): string => {
  if (!req.user?.id) throw new AppError("Access token is required", 401);
  return req.user.id;
};

export class TransferController {
  constructor(private readonly service: Pick<TransferService, "create" | "handleCallback" | "get" | "list">) {}

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const input = parse(createTransferSchema, req.body);
      const key = parse(idempotencyKeySchema, req.get("Idempotency-Key"));
      const result = await this.service.create(userId(req), input, key);
      res.setHeader("Location", `/api/v1/transfers/${result.transfer.transferId}`);
      sendSuccess(res, result.transfer, result.created ? 201 : 200);
    } catch (error) { next(error); }
  };

  get = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      sendSuccess(res, await this.service.get(userId(req), parse(transferIdSchema, req.params.id)));
    } catch (error) { next(error); }
  };

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { limit, offset } = parse(transferListSchema, req.query);
      sendSuccess(res, await this.service.list(userId(req), limit, offset));
    } catch (error) { next(error); }
  };

  handleCallback = async (req: Request, res: Response): Promise<void> => {
    try {
      const query = parse(transferCallbackSchema, req.query);
      const result = await this.service.handleCallback(query.transfer_id, query.interact_ref, query.hash);
      const processing = ["AWAITING_AUTHORIZATION", "FINALIZING", "SUBMITTING"].includes(result.status);
      if (processing) res.setHeader("Retry-After", String(result.retryAfter ?? 2));
      res.status(processing ? 202 : 200).type("html").send(
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Payment authorization</title></head><body><h1>Payment authorization received</h1><p>Return to your application to check transfer status.</p>' +
        (processing ? '<p>Authorization is still processing. Refresh this page after a few seconds to continue.</p>' : '') +
        '</body></html>',
      );
    } catch (error) {
      // Callback proofs and upstream errors must never enter generic error logs.
      res.status(error instanceof AppError ? error.statusCode : 500).type("html").send(
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Payment authorization</title></head><body><h1>Unable to complete payment authorization</h1><p>Return to your application and check this transfer before starting another payment.</p></body></html>',
      );
    }
  };
}
