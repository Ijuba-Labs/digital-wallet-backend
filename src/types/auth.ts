import type { PaymentRateLimits } from "@/middlewares/rateLimiter.middleware";
import { createUserRepository } from "@/repositories/user.repository";
import { User } from "./user";
import { createAuthService } from "@/services/auth.service";
import { createAuthController } from "@/controllers/auth.controller";
import { RequestHandler } from "express";
import type { OnboardingController } from "@/controllers/onboarding.controller";
import type { createWalletController } from "@/controllers/wallet.controller";
import type { TransferController } from "@/controllers/transfer.controller";

export interface RegisterInput extends User {
    password: string;
}

export interface LoginInput {
    email: string;
    password: string;
}

export interface RegisterResult {
    publicUser: Omit<User, "password_hash">;
    token: string;
}


export type RegisterResponse = {
    user: {
        id?: string;
        first_name?: string;
        last_name?: string;
        email?: string;
        phone_number?: string;
        status?: string;
        created_at?: string;
        updated_at?: string
    };
    accessToken?: string;
    expiresIn?: number;
    expiresAt: number;
};

export interface LoginResponse extends RegisterResponse { };

export type AuthToken = {
    token: string;
    expiresIn: number;
    expiresAt: number;
}

export type UserRepository = ReturnType<typeof createUserRepository>;

export type AuthServiceDependencies = {
    userRepository: UserRepository;
};

export type AuthService = ReturnType<typeof createAuthService>;

export type AuthControllerDependencies = {
    authService: AuthService;
};

export type AuthController = ReturnType<typeof createAuthController>;

export type RouterDependencies = {
    authController: AuthController;
    onboardingController: OnboardingController;
    walletController: ReturnType<typeof createWalletController>;
    transferController: TransferController;
    rateLimits: PaymentRateLimits;
    requireAuth: RequestHandler;
};

export type AuthMiddlewareDependencies = {
    userRepository: UserRepository;
};
