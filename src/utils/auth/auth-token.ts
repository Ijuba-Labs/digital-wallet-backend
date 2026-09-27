import { env } from '@/config/env';
import { AuthToken } from '@/types/auth';
import { UserAuthToken } from '@/types/user';
import jwt, { JwtPayload } from 'jsonwebtoken';

const { JWT_SECRET } = env;

export const createAccessToken = (user: UserAuthToken): AuthToken => {
    const token = jwt.sign({
        id: user.id,
        email: user.email
    },
        JWT_SECRET, {
        expiresIn: '15m'
    });

    const decoded = jwt.decode(token) as JwtPayload;
    const expiresIn = decoded.exp! - Math.floor(Date.now() / 1000) as number;

    return {
        token,
        expiresIn,
        expiresAt: decoded.exp!,
    };
}