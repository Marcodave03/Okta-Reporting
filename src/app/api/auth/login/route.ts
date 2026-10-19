import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { connectDB } from '@/lib/db';
import { ensureBootstrap } from '@/lib/bootstrap';
import { AppUser } from '@/lib/models';
import { signSession } from '@/lib/jwt';
import { setSessionCookie } from '@/lib/cookies';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    await connectDB();
    await ensureBootstrap();
  } catch (e: any) {
    return NextResponse.json({ error: `Database tidak tersedia: ${e.message}` }, { status: 503 });
  }
  const { email, password } = await req.json().catch(() => ({}));
  const user = await AppUser.findOne({ email: String(email || '').toLowerCase().trim(), active: true });
  if (!user || !user.passwordHash || !(await bcrypt.compare(String(password || ''), user.passwordHash))) {
    await audit(String(email || 'unknown'), 'auth.login.failed', 'local');
    return NextResponse.json({ error: 'Email atau password salah' }, { status: 401 });
  }
  user.lastLoginAt = new Date();
  await user.save();
  const token = await signSession({ sub: String(user._id), email: user.email, name: user.name, role: user.role });
  await audit(user.email, 'auth.login', 'local');
  const res = NextResponse.json({ ok: true, preferences: user.preferences });
  setSessionCookie(res, token);
  return res;
}
