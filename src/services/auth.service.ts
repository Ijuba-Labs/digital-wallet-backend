import type {
    AuthServiceDependencies,
    LoginInput,
    LoginResponse,
    RegisterInput,
    RegisterResponse
} from "@/types/auth";
import { AppError } from "@/utils/appError";
import { createAccessToken } from "@/utils/auth/auth-token";
import { hashPassword, verifyPassword } from "@/utils/auth/password";

export const createAuthService = ({ userRepository }: AuthServiceDependencies) => {
    return {
        register: async (user: RegisterInput): Promise<RegisterResponse> => {
            const existing = await userRepository.findByEmail(user.email);
            if (existing) {
                throw new AppError("A user with this email already exists.", 409);
            }

            const hashedPassword = await hashPassword(user.password);

            const savedUser = await userRepository.save({
                first_name: user.first_name,
                last_name: user.last_name,
                email: user.email,
                password_hash: hashedPassword,
                phone_number: user.phone_number
            });

            const userId = savedUser.id as string;
            const userEmail = savedUser.email as string;
            const { token, expiresIn, expiresAt } = createAccessToken({
                id: userId,
                email: userEmail
            });


            const { password_hash, ...publicUser } = savedUser;
            return {
                user: publicUser,
                accessToken: token,
                expiresIn,
                expiresAt
            };
        },

        login: async (userLogin: LoginInput): Promise<LoginResponse> => {
            const user = await userRepository.findByEmail(userLogin.email)
            if (!user) {
                throw new AppError("User account not found", 404);
            }

            const password = userLogin.password;
            const hash = user.password_hash as string;
            const hasAccess = await verifyPassword(password, hash);
            if (!hasAccess) {
                throw new AppError(`Incorrect email or password`, 401);
            }

            const userId = user.id as string;
            const userEmail = user.email as string;
            const { token, expiresAt, expiresIn } = createAccessToken({
                id: userId,
                email: userEmail
            });

            const { password_hash, ...publicUser } = user;

            return {
                user: publicUser,
                accessToken: token,
                expiresIn,
                expiresAt

            };

        },
    };
};