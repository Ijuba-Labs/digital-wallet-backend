/**
 * @file auth.middleware.ts
 * @description Authentication and role-based authorization middleware.
 *
 * Best Practices:
 * 1. Extract Bearer token from the `Authorization` header.
 * 2. Verify and decode tokens (e.g. JWT) securely, checking expiry and signatures.
 * 3. Attach verified user payload to the request object (e.g. `req.user`).
 * 4. Provide reusable helper functions for role or permission checks (e.g. `requireRole('admin')`).
 * 5. Return a 401 Unauthorized for missing/invalid tokens, and 403 Forbidden for insufficient permissions.
 */
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AppError } from '../utils/appError';
import { env } from '../config/env';
import { UserAuthToken } from '@/types/user';
import { AuthMiddlewareDependencies } from '@/types/auth';

declare global {
    namespace Express {
        interface Request {
            user?: UserAuthToken;
        }
    }
}


// Source - https://stackoverflow.com/a/68431308
// Posted by Krisztián Balla
// Retrieved 2026-09-21, License - CC BY-SA 4.0

declare module "jsonwebtoken" {
    export interface JwtPayload extends UserAuthToken { }
}

export const createRequireAuth = ({ userRepository }: AuthMiddlewareDependencies) => {
    return async (req: Request, _res: Response, next: NextFunction) => {
        try {
            const authHeader = req.headers.authorization;

            if (!authHeader?.startsWith("Bearer ")) {
                return next(
                    new AppError("Access token is required", 401)
                );
            }

            const token = authHeader.split(" ")[1];

            if (!token) {
                return next(
                    new AppError("Access token is missing", 401)
                );
            }

            const decodedPayload = jwt.verify(
                token,
                env.JWT_SECRET
            );

            if (typeof decodedPayload === "string") {
                return next(
                    new AppError("Invalid token structure", 401)
                );
            }

            if (
                !decodedPayload.id ||
                !decodedPayload.email
            ) {
                return next(
                    new AppError("Invalid token payload", 401)
                );
            }

            const currentUser =
                await userRepository.findById(
                    decodedPayload.id
                );

            if (!currentUser) {
                return next(
                    new AppError(
                        "The user belonging to this token no longer exists.",
                        401
                    )
                );
            }

            if (currentUser.status === "SUSPENDED") {
                return next(
                    new AppError(
                        "Your account has been disabled. Please contact support.",
                        403
                    )
                );
            }

            req.user = {
                id: decodedPayload.id,
                email: decodedPayload.email,
            };

            return next();
        } catch (error) {
            if (error instanceof jwt.TokenExpiredError) {
                return next(
                    new AppError(
                        "Access token has expired",
                        401
                    )
                );
            }

            if (error instanceof jwt.JsonWebTokenError) {
                return next(
                    new AppError(
                        "Invalid access token",
                        401
                    )
                );
            }

            return next(error);
        }
    };
};