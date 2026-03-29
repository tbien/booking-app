/**
 * JWT utilities for Cloudflare Workers.
 * Uses Hono's built-in sign/verify which relies on the Web Crypto API.
 */
import { sign, verify } from 'hono/jwt';

export interface AuthPayload {
  userId: string;
  role: 'admin' | 'user';
  exp: number;
}

const SESSION_DAYS = 7;

export async function createAuthToken(
  userId: string,
  role: 'admin' | 'user',
  secret: string,
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 24 * 3600;
  return sign({ userId, role, exp }, secret, 'HS256');
}

export async function verifyAuthToken(token: string, secret: string): Promise<AuthPayload | null> {
  try {
    const payload = (await verify(token, secret, 'HS256')) as unknown as AuthPayload;
    return payload;
  } catch {
    return null;
  }
}
