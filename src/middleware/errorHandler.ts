import { Request, Response, NextFunction } from 'express';

/**
 * JSON 404 for unknown /api/* routes.
 * Must be registered AFTER all API routes.
 */
export const apiNotFound = (req: Request, res: Response) => {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `Cannot ${req.method} ${req.originalUrl}` },
  });
};

/**
 * Global error handler — catches unhandled errors from all routes, returns JSON.
 * Must be registered as Express 4-arg error middleware.
 */
export const globalErrorHandler = (
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction,
) => {
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal server error';

  if (status >= 500) {
    console.error(`[ERROR] ${req.method} ${req.originalUrl}:`, err.stack || err);
  }

  const code =
    status === 400
      ? 'VALIDATION_ERROR'
      : status === 401
        ? 'UNAUTHORIZED'
        : status === 403
          ? 'FORBIDDEN'
          : status === 404
            ? 'NOT_FOUND'
            : status === 409
              ? 'CONFLICT'
              : 'INTERNAL_ERROR';

  res.status(status).json({ error: { code, message } });
};
