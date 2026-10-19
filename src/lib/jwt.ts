// Edge-safe session helpers (dipakai juga oleh middleware) — jangan import mongoose di sini.
import { SignJWT, jwtVerify } from 'jose';

export const SESSION_COOKIE = 'iga_session';

export type Role = 'admin' | 'reviewer' | 'auditor';
export type SessionUser = { sub: string; email: string; name: string; role: Role };

const secret = () =>
  new TextEncoder().encode(process.env.AUTH_SECRET || 'dev-insecure-secret-change-me-please-32-chars');

export async function signSession(u: SessionUser) {
  return new SignJWT({ ...u })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('12h')
    .sign(secret());
}

export async function verifySession(token?: string | null): Promise<SessionUser | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload as unknown as SessionUser;
  } catch {
    return null;
  }
}
