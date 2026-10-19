import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await connectDB();
    return NextResponse.json({ ok: true, db: mongoose.connection.readyState === 1 ? 'connected' : 'connecting', time: new Date() });
  } catch (e: any) {
    return NextResponse.json({ ok: false, db: 'down', error: e.message }, { status: 503 });
  }
}
