import { NextRequest, NextResponse } from 'next/server';
import { getStore } from '@/lib/store';
import { getWalk, isUuid } from '@/lib/walks';

/** Add a custom room (e.g. "Study", "Servant Room") to a walk. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ walkId: string }> }) {
  try {
    const { walkId } = await params;
    if (!isUuid(walkId) || !(await getWalk(walkId))) {
      return NextResponse.json({ error: 'Walk not found' }, { status: 404 });
    }
    const { room_name } = await request.json();
    const name = String(room_name ?? '').trim().slice(0, 60);
    if (!name) return NextResponse.json({ error: 'Room name is required' }, { status: 400 });

    const r = await getStore().addRoom(walkId, name);
    return NextResponse.json(
      {
        room: {
          id: r.id,
          room_name: r.room_type,
          status: r.status,
          checklist: [],
          snag_count: 0,
          severities: { critical: 0, major: 0, minor: 0 },
          thumbs: [],
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[api/walks/:id/rooms] failed:', error);
    return NextResponse.json({ error: 'Could not add the room.' }, { status: 500 });
  }
}
