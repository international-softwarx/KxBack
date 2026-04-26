import { NextFunction, Request, Response } from 'express';
import { ITokenService, IUserRepository } from '../../domain/ports/ports';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      sessionId?: string;
      isAdmin?: boolean;
    }
  }
}

export function authMiddleware(token: ITokenService, users: IUserRepository) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, error: 'Token requerido.' });
      }

      const rawToken = authHeader.slice(7);
      const payload = token.verify(rawToken);

      if (!payload) {
        return res.status(401).json({ success: false, error: 'Token invalido o expirado.' });
      }

      const user = await users.findById(payload.userId);
      if (!user || !user.isActive) {
        return res.status(401).json({ success: false, error: 'Usuario no encontrado o inactivo.' });
      }

      const sessionExists = user.activeSessions.some((session) => session.sessionId === payload.sessionId);
      if (!sessionExists) {
        return res.status(401).json({ success: false, error: 'Sesion invalida. Inicia sesion nuevamente.' });
      }

      req.userId = payload.userId;
      req.sessionId = payload.sessionId;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export function adminMiddleware(adminToken: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = req.headers['x-admin-token'];
    if (!token || token !== adminToken) {
      return res.status(403).json({ success: false, error: 'Acceso denegado.' });
    }

    req.isAdmin = true;
    return next();
  };
}

export function errorHandler(error: Error, _req: Request, res: Response, _next: NextFunction) {
  // eslint-disable-next-line no-console
  console.error('[KX][ERROR]', error);
  res.status(500).json({ success: false, error: 'Error interno del servidor.' });
}

export function notFound(_req: Request, res: Response) {
  res.status(404).json({ success: false, error: 'Ruta no encontrada.' });
}