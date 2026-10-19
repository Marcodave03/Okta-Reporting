import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from './jwt';

export function setSessionCookie(res: NextResponse, token: string) {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: (process.env.APP_BASE_URL || '').startsWith('https'),
    maxAge: 12 * 3600,
  });
}
