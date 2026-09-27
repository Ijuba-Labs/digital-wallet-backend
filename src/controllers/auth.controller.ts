import { Request, Response, NextFunction } from "express";
import { AppError } from "@/utils/appError";
import { sendSuccess } from "@/utils/apiResponse";
import { onboardingService } from "@/services/onboarding.service";
import {
    startOnboardingSchema,
    callbackQuerySchema,
} from "@/validators/onboarding.validator";
import { authLoginSchema, authRegisterSchema } from "@/validators/auth.validator";
import { AuthControllerDependencies } from "@/types/auth";

// class AuthController {
//     /**
//      * POST /api/v1/auth/register
//      * Registers a new user account
//      */
//     register = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
//         try {
//             const parsed = authRegisterSchema.safeParse(req.body);
//             if (!parsed.success) {
//                 const msg = parsed.error.issues.map((i) => i.message).join(", ");
//                 // parsed.treeifyError(err)
//                 throw new AppError(msg, 400, parsed.error.flatten().fieldErrors);
//             }

//             const registeredUser = await authService.register(parsed.data);

//             sendSuccess(res, registeredUser, 201);
//         } catch (error) {
//             next(error);
//         }
//     };

//     login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
//         try {
//             const parsed = authLoginSchema.safeParse(req.body);
//             if (!parsed.success) {
//                 const msg = parsed.error.issues.map((i) => i.message).join(", ");
//                 throw new AppError(msg, 400, parsed.error.flatten().fieldErrors);
//             }

//             const accessToken = await authService.login(parsed.data);

//             sendSuccess(res, { token: accessToken });
//         } catch (error) {
//             next(error);
//         }
//     };

// }

// export const authController = new AuthController();

// controllers/auth.controller.ts




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

                const accessToken = await authService.login(parsed.data);

                sendSuccess(res, { token: accessToken });
            } catch (error) {
                next(error);
            }
        },
    }
};
