import { Request, Response, NextFunction } from "express";
import { AppError } from "@/utils/appError";
import { sendSuccess } from "@/utils/apiResponse";
import { authLoginSchema, authRegisterSchema } from "@/validators/auth.validator";
import { AuthControllerDependencies } from "@/types/auth";

export const createAuthController = ({ authService }: AuthControllerDependencies) => {
    return {
        register: async (req: Request, res: Response, next: NextFunction) => {
            try {
                const parsed = authRegisterSchema.safeParse(req.body);
                if (!parsed.success) {
                    const msg = parsed.error.issues.map((i) => i.message).join(", ");
                    // parsed.treeifyError(err)
                    throw new AppError(msg, 400, parsed.error.flatten().fieldErrors);
                }

                const registeredUser = await authService.register(parsed.data);

                sendSuccess(res, registeredUser, 201);
            } catch (error) {
                next(error);
            }
        },

        login: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
            try {
                const parsed = authLoginSchema.safeParse(req.body);
                if (!parsed.success) {
                    const msg = parsed.error.issues.map((i) => i.message).join(", ");
                    throw new AppError(msg, 400, parsed.error.flatten().fieldErrors);
                }

                const loggedUser = await authService.login(parsed.data);

                sendSuccess(res, loggedUser, 200);
            } catch (error) {
                next(error);
            }
        },
    }
};
