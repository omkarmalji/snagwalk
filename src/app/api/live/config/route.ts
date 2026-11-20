import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** Where the browser opens the Gemini Live relay (a separate Cloud Run service). null hides the live inspector. */
export function GET() {
  return NextResponse.json({ url: process.env.LIVE_URL || null }, { headers: { 'cache-control': 'no-store' } });
}
