import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getNumberedSnags, getWalk, isUuid, letterFingerprint, unpackLetter } from '@/lib/walks';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ walkId: string }> }) {
  try {
    const { walkId } = await params;
    if (!isUuid(walkId)) return NextResponse.json({ error: 'Walk not found' }, { status: 404 });

    const found = await getWalk(walkId);
    if (!found) return NextResponse.json({ error: 'Walk not found' }, { status: 404 });

    const roomsRes = await query(
      `SELECT id, walk_id, room_type, status, checklist, created_at
       FROM rooms WHERE walk_id = $1
       ORDER BY created_at ASC`,
      [walkId]
    );
    const { snags, groups } = await getNumberedSnags(walkId);

    const rooms = roomsRes.rows.map((r) => {
      let checklist = r.checklist;
      if (typeof checklist === 'string') {
        try {
          checklist = JSON.parse(checklist);
        } catch {
          checklist = [];
        }
      }
      const roomSnags = snags.filter((s) => s.room_id === r.id);
      return {
        id: r.id,
        room_name: r.room_type,
        status: r.status,
        checklist: Array.isArray(checklist) ? checklist : [],
        snag_count: roomSnags.length,
        severities: {
          critical: roomSnags.filter((s) => s.severity === 'critical').length,
          major: roomSnags.filter((s) => s.severity === 'major').length,
          minor: roomSnags.filter((s) => s.severity === 'minor').length,
        },
        thumbs: roomSnags.slice(-3).map((s) => s.photo_url),
      };
    });

    const letter = unpackLetter(found.letterText);
    return NextResponse.json({
      walk: found.walk,
      rooms,
      letter: letter
        ? { exists: true, stale: letter.fp !== letterFingerprint(found.walk, groups), source: letter.source }
        : { exists: false, stale: false, source: null },
    });
  } catch (error) {
    console.error('[api/walks/:id] failed:', error);
    return NextResponse.json({ error: 'Could not load this walk.' }, { status: 500 });
  }
}
