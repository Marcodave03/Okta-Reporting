import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await connectDB();
    return NextResponse.json({ ok: true, db: 'connected', time: new Date() });
  } catch (e: any) {
    return NextResponse.json({ ok: false, db: 'down', error: e.message }, { status: 503 });
  }
}
