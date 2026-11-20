import { NextResponse } from 'next/server';
import { getStoreStatus } from '@/lib/store';
import { getAiStatus } from '@/lib/gemini';
import { getStorageStatus } from '@/lib/gcs';

export const dynamic = 'force-dynamic';

/** Reports which backends are live, so the UI can be honest when running on dev fallbacks. */
export async function GET() {
  const ai = getAiStatus();
  const db = await getStoreStatus();
  const storage = getStorageStatus();
  return NextResponse.json({
    ai: { ...ai, live: Boolean(ai.lastOk) && (!ai.lastErrorAt || ai.lastOk! > ai.lastErrorAt) },
    db,
    storage,
  });
}
