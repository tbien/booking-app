import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { AppEnv } from '../index';
import { requireAdmin } from '../middleware/auth';
import { createAuthToken, verifyAuthToken } from '../lib/jwt';
import { AdminCredentials } from '../../../src/models/AdminCredentials';

const BCRYPT_ROUNDS = 12;
const SESSION_DAYS = 7;

const router = new Hono<AppEnv>();

// POST /auth/login
router.post('/auth/login', async (c) => {
  const { password } = await c.req.json<{ password?: string }>();

  if (!password) {
    return c.json({ success: false, error: 'Brak hasła' }, 400);
  }

  const credentials = await AdminCredentials.findOne({ userId: 'admin' });
  if (!credentials) {
    return c.json(
      {
        success: false,
        error: 'Admin password not initialized. Run: npm run init-admin',
      },
      500,
    );
  }

  const valid = await bcrypt.compare(password, credentials.passwordHash);
  if (!valid) {
    return c.json({ success: false, error: 'Nieprawidłowe hasło' }, 401);
  }

  const token = await createAuthToken('admin', 'admin', c.env.SESSION_SECRET);
  setCookie(c, 'auth_token', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: SESSION_DAYS * 24 * 3600,
    path: '/',
  });

  return c.json({ success: true, role: 'admin' });
});

// POST /auth/logout
router.post('/auth/logout', (c) => {
  deleteCookie(c, 'auth_token', { path: '/' });
  return c.json({ success: true });
});

// GET /auth/me — check current session
router.get('/auth/me', async (c) => {
  const token = getCookie(c, 'auth_token');
  if (token) {
    const payload = await verifyAuthToken(token, c.env.SESSION_SECRET);
    if (payload) {
      return c.json({ success: true, role: payload.role, userId: payload.userId });
    }
  }
  return c.json({ success: true, role: 'user', userId: null });
});

// POST /auth/change-password (admin only)
router.post('/auth/change-password', requireAdmin, async (c) => {
  const { currentPassword, newPassword } = await c.req.json<{
    currentPassword?: string;
    newPassword?: string;
  }>();

  if (!currentPassword || !newPassword) {
    return c.json({ success: false, error: 'Wymagane: currentPassword i newPassword' }, 400);
  }

  if (newPassword.length < 8) {
    return c.json({ success: false, error: 'Nowe hasło musi mieć co najmniej 8 znaków' }, 400);
  }

  const credentials = await AdminCredentials.findOne({ userId: 'admin' });
  if (!credentials) {
    return c.json({ success: false, error: 'Brak poświadczeń w bazie' }, 500);
  }

  const valid = await bcrypt.compare(currentPassword, credentials.passwordHash);
  if (!valid) {
    return c.json({ success: false, error: 'Nieprawidłowe aktualne hasło' }, 401);
  }

  const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await AdminCredentials.updateOne({ userId: 'admin' }, { $set: { passwordHash: newHash } });

  return c.json({ success: true, message: 'Hasło zostało zmienione' });
});

export default router;
