import type { Request, Response, NextFunction } from "express";
import type { ZodType } from "zod";
import type { TransferService } from "@/services/transfer.service";
import { AppError } from "@/utils/appError";
import { sendSuccess } from "@/utils/apiResponse";
import {
  createTransferSchema, idempotencyKeySchema, transferCallbackSchema, transferDeclineCallbackSchema, transferIdSchema, transferListSchema,
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
  constructor(private readonly service: Pick<TransferService, "create" | "handleCallback" | "handleDecline" | "get" | "list" | "cancel" | "cancelByKey">) {}

  cancelByKey = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try { sendSuccess(res, await this.service.cancelByKey(userId(req), parse(idempotencyKeySchema, req.get("Idempotency-Key")))); }
    catch (error) {
      if (error instanceof AppError && error.statusCode === 409 && error.details) res.setHeader("Retry-After", "1");
      next(error);
    }
  };

  cancel = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try { sendSuccess(res, await this.service.cancel(userId(req), parse(transferIdSchema, req.params.id))); }
    catch (error) { next(error); }
  };

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
      const result = req.query.result === "grant_rejected"
        ? await (async () => {
          const query = parse(transferDeclineCallbackSchema, req.query);
          return this.service.handleDecline(query.transfer_id, query.cancel_token);
        })()
        : await (async () => {
          const query = parse(transferCallbackSchema, req.query);
          return this.service.handleCallback(query.transfer_id, query.interact_ref, query.hash);
        })();
      const processing = ["AWAITING_AUTHORIZATION", "FINALIZING", "SUBMITTING"].includes(result.status);
      if (processing) res.setHeader("Retry-After", String(("retryAfter" in result ? result.retryAfter : undefined) ?? 2));
      if (result.status === "CANCELLED") {
        res.status(200).type("html").send('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Payment cancelled</title></head><body><h1>Payment cancelled</h1><p>No payment was submitted. Return to your application.</p></body></html>');
        return;
      }
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
