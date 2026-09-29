import type { Request, Response, NextFunction } from "express";
import type { WalletService } from "@/services/wallet.service";
import { AppError } from "@/utils/appError";
import { sendSuccess } from "@/utils/apiResponse";
export const createWalletController = (service: WalletService) => ({
  listLinkedWallets: async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) throw new AppError("Access token is required", 401);
      sendSuccess(res, { wallets: await service.listLinkedWallets(req.user.id) });
    } catch (error) { next(error); }
  },
  verifyWalletAddress: async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (typeof req.body?.walletAddressUrl !== "string") throw new AppError("Wallet address is required", 400);
      sendSuccess(res, await service.getWalletAddress(req.body.walletAddressUrl));
    } catch (error) { next(error); }
  },
});
