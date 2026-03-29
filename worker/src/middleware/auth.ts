/**
 * Auth middleware for Hono (CF Workers).
 * Replaces express-session + connect-mongo with JWT stored in an HttpOnly cookie.
 */
import { createMiddleware } from 'hono/factory';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { AppEnv } from '../index';
import { verifyAuthToken, createAuthToken } from '../lib/jwt';

/** Runs on every request — extracts JWT from cookie and populates context variables. */
export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const token = getCookie(c, 'auth_token');
  if (token) {
    const payload = await verifyAuthToken(token, c.env.SESSION_SECRET);
    if (payload) {
      c.set('userId', payload.userId);
      c.set('role', payload.role);
    }
  }
  await next();
});

/**
 * Guard: requires ANY authenticated user.
 * For API requests (Accept: application/json) returns 401 JSON, otherwise 401 text.
 */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  await next();
});

/** Guard: requires admin role. */
export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const userId = c.get('userId');
  const role = c.get('role');
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  if (role !== 'admin') {
    return c.json({ success: false, error: 'Forbidden – admin only' }, 403);
  }
  await next();
});

export { createAuthToken, getCookie, setCookie, deleteCookie };
