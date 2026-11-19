import { NextResponse } from 'next/server';
import { getDbStatus, query } from '@/lib/db';
import { getAiStatus } from '@/lib/gemini';
import { getStorageStatus } from '@/lib/gcs';

export const dynamic = 'force-dynamic';

/** Reports which backends are live, so the UI can be honest when running on dev fallbacks. */
export async function GET() {
  try {
    await query(`SELECT id, buyer_name, builder_name, project_name, tower, flat_number, bhk, possession_date, created_at FROM walks ORDER BY created_at DESC LIMIT 1`);
  } catch {
    // status below reports the failure
  }
  const ai = getAiStatus();
  const db = getDbStatus();
  const storage = getStorageStatus();
  return NextResponse.json({
    ai: { ...ai, live: Boolean(ai.lastOk) && (!ai.lastErrorAt || ai.lastOk! > ai.lastErrorAt) },
    db,
    storage,
  });
}
