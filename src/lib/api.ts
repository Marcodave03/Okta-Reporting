import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from './db';
import { ensureBootstrap } from './bootstrap';
import { SESSION_COOKIE, SessionUser, verifySession } from './jwt';
import { HttpError } from './errors';

export { HttpError };

export type Ctx = { req: NextRequest; user: SessionUser; params: Record<string, string>; body: any; query: URLSearchParams };

/** Wrapper route handler: auth + role check + koneksi DB + error handling JSON. */
export function route(fn: (ctx: Ctx) => Promise<any>, opts: { roles?: string[] } = {}) {
  return async (req: NextRequest, context: { params?: any } = {}) => {
    try {
      const user = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
      if (!user) throw new HttpError(401, 'Unauthorized');
      if (opts.roles && !opts.roles.includes(user.role)) throw new HttpError(403, 'Anda tidak memiliki akses untuk aksi ini');
      await connectDB();
      await ensureBootstrap();
      let body: any = null;
      if (!['GET', 'HEAD'].includes(req.method)) {
        try {
          body = await req.json();
        } catch {
          body = {};
        }
      }
      const result = await fn({ req, user, params: context.params || {}, body, query: req.nextUrl.searchParams });
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (e: any) {
      const status = e instanceof HttpError ? e.status : e?.name === 'CastError' ? 400 : 500;
      if (status === 500) console.error('[api]', req.method, req.nextUrl.pathname, e);
      return NextResponse.json({ error: e?.message || 'Server error' }, { status });
    }
  };
}

export const ADMIN = { roles: ['admin'] };
export const ADMIN_AUDITOR = { roles: ['admin', 'auditor'] };

export function fileResponse(buffer: Buffer, mime: string, filename: string) {
  return new NextResponse(new Uint8Array(buffer), {
    headers: { 'Content-Type': mime, 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' },
  });
}

export function pick<T extends object>(obj: any, keys: (keyof T | string)[]): Partial<T> {
  const out: any = {};
  for (const k of keys as string[]) if (obj && obj[k] !== undefined) out[k] = obj[k];
  return out;
}
