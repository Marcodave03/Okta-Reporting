import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getConfig } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await connectDB();
    const { okta } = await getConfig();
    return NextResponse.json({ okta: !!(okta.clientId && okta.clientSecret && okta.orgUrl && !okta.orgUrl.includes('your-org')), orgUrl: okta.orgUrl });
  } catch {
    return NextResponse.json({ okta: false });
  }
}
