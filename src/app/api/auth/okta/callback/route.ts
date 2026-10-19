import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { ensureBootstrap } from '@/lib/bootstrap';
import { getConfig } from '@/lib/settings';
import { AppUser } from '@/lib/models';
import { signSession } from '@/lib/jwt';
import { audit } from '@/lib/audit';
import { setSessionCookie } from '@/lib/cookies';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  await connectDB();
  await ensureBootstrap();
  const { okta, app } = await getConfig();
  const fail = (reason: string) => NextResponse.redirect(`${app.baseUrl}/login?error=${encodeURIComponent(reason)}`);
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  if (!code || !state || state !== req.cookies.get('okta_state')?.value) return fail('invalid_state');

  try {
    const tokenRes = await fetch(`${okta.orgUrl}/oauth2/v1/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${app.baseUrl}/api/auth/okta/callback`,
        client_id: okta.clientId,
        client_secret: okta.clientSecret,
      }),
    });
    if (!tokenRes.ok) return fail('token_exchange_failed');
    const tokens = await tokenRes.json();
    const infoRes = await fetch(`${okta.orgUrl}/oauth2/v1/userinfo`, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    if (!infoRes.ok) return fail('userinfo_failed');
    const info = await infoRes.json();
    const email = String(info.email || info.preferred_username || '').toLowerCase();
    if (!email) return fail('no_email');

    let user = await AppUser.findOne({ email });
    if (!user) user = await AppUser.create({ email, name: info.name || email, role: 'reviewer', authSource: 'okta' });
    if (!user.active) return fail('user_disabled');
    user.lastLoginAt = new Date();
    await user.save();
    const token = await signSession({ sub: String(user._id), email: user.email, name: user.name, role: user.role });
    await audit(email, 'auth.login', 'okta-sso');
    const res = NextResponse.redirect(`${app.baseUrl}/dashboard`);
    setSessionCookie(res, token);
    res.cookies.set('okta_state', '', { path: '/', maxAge: 0 });
    return res;
  } catch (e: any) {
    return fail(e.message);
  }
}
