import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { connectDB } from '@/lib/db';
import { getConfig } from '@/lib/settings';

export const dynamic = 'force-dynamic';

/** Okta SSO (OIDC Authorization Code flow) — redirect ke Okta authorize endpoint. */
export async function GET() {
  await connectDB();
  const { okta, app } = await getConfig();
  if (!okta.clientId) return NextResponse.redirect(`${app.baseUrl}/login?error=okta_not_configured`);
  const state = randomBytes(16).toString('hex');
  const params = new URLSearchParams({
    client_id: okta.clientId,
    response_type: 'code',
    scope: 'openid profile email',
    redirect_uri: `${app.baseUrl}/api/auth/okta/callback`,
    state,
  });
  const res = NextResponse.redirect(`${okta.orgUrl}/oauth2/v1/authorize?${params}`);
  res.cookies.set('okta_state', state, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 600 });
  return res;
}
