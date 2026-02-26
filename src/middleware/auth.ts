import { Request, Response, NextFunction } from 'express';

export type UserRole = 'admin' | 'user';

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    role?: UserRole;
  }
}

/**
 * Wymaga zalogowania (dowolna rola).
 * Jeśli brak sesji → 401 dla API, redirect do /login dla stron.
 */
export const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
  if (req.session?.userId) {
    return next();
  }
  if (isApiRequest(req)) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
  } else {
    res.redirect('/login');
  }
};

/**
 * Wymaga roli admina.
 * Jeśli zalogowany, ale nie admin → 403. Jeśli niezalogowany → 401/redirect.
 */
export const requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.session?.userId) {
    if (isApiRequest(req)) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
    } else {
      res.redirect('/login');
    }
    return;
  }
  if (req.session.role !== 'admin') {
    if (isApiRequest(req)) {
      res.status(403).json({ success: false, error: 'Forbidden – admin only' });
    } else {
      res.redirect('/');
    }
    return;
  }
  next();
};

const isApiRequest = (req: Request): boolean => {
  return (
    req.originalUrl.startsWith('/ical') ||
    req.originalUrl.startsWith('/auth') ||
    req.headers['content-type']?.includes('application/json') ||
    req.headers['accept']?.includes('application/json') ||
    false
  );
};
