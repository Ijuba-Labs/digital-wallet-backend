import { Router } from 'express';
import { AuthController } from '@/types/auth';

export const createAuthRouter = (authController: AuthController) => {
    const router = Router();

    router.post('/register', authController.register);
    router.post('/login', authController.login);

    return router;
};