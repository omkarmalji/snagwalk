import { NextRequest, NextResponse } from 'next/server';
import { getNumberedSnags, getWalk, isUuid, letterFingerprint, unpackLetter } from '@/lib/walks';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ walkId: string }> }) {
  try {
    const { walkId } = await params;
    if (!isUuid(walkId)) return NextResponse.json({ error: 'Walk not found' }, { status: 404 });

    const found = await getWalk(walkId);
    if (!found) return NextResponse.json({ error: 'Walk not found' }, { status: 404 });

    const { rooms: roomDocs, snags, groups } = await getNumberedSnags(walkId);

    const rooms = roomDocs.map((r) => {
      const checklist = r.checklist;
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
