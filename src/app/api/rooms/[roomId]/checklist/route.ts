import { NextRequest, NextResponse } from 'next/server';
import { generateRoomChecklist, type ChecklistItem } from '@/lib/gemini';
import { getStore } from '@/lib/store';
import { isUuid } from '@/lib/walks';

type Ctx = { params: Promise<{ roomId: string }> };

/** The room plus the walk details Gemini uses for context. */
async function loadRoom(roomId: string) {
  const store = getStore();
  const room = await store.getRoom(roomId);
  if (!room) return null;
  const walk = await store.getWalk(room.walk_id);
  return { ...room, bhk: walk?.bhk ?? 2, project_name: walk?.project_name ?? '' };
}

async function regenerate(room: { id: string; room_type: string; bhk: number; project_name: string }) {
  const { data, source } = await generateRoomChecklist(room.room_type, {
    bhk: `${room.bhk} BHK`,
    project: room.project_name,
  });
  await getStore().setChecklist(room.id, data);
  return { checklist: data, source };
}

/** Returns the saved checklist, generating it with Gemini the first time. */
export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const { roomId } = await params;
    if (!isUuid(roomId)) return NextResponse.json({ error: 'Room not found' }, { status: 404 });
    const room = await loadRoom(roomId);
    if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 });

    const checklist = room.checklist;
    if (Array.isArray(checklist) && checklist.length > 0) {
      return NextResponse.json({ checklist, source: 'saved' });
    }
    return NextResponse.json(await regenerate(room));
  } catch (error) {
    console.error('[api/checklist] GET failed:', error);
    return NextResponse.json({ error: 'Could not load the checklist.' }, { status: 500 });
  }
}

/** Force a fresh checklist from Gemini. */
export async function POST(_req: NextRequest, { params }: Ctx) {
  try {
    const { roomId } = await params;
    if (!isUuid(roomId)) return NextResponse.json({ error: 'Room not found' }, { status: 404 });
    const room = await loadRoom(roomId);
    if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 });
    return NextResponse.json(await regenerate(room));
  } catch (error) {
    console.error('[api/checklist] POST failed:', error);
    return NextResponse.json({ error: 'Could not regenerate the checklist.' }, { status: 500 });
  }
}

/** Save ticked items. */
export async function PUT(request: NextRequest, { params }: Ctx) {
  try {
    const { roomId } = await params;
    if (!isUuid(roomId)) return NextResponse.json({ error: 'Room not found' }, { status: 404 });
    const { checklist } = await request.json();
    if (!Array.isArray(checklist) || checklist.length > 20) {
      return NextResponse.json({ error: 'Invalid checklist' }, { status: 400 });
    }
    const safe: ChecklistItem[] = checklist.map((it, i) => ({
      id: String(it?.id ?? i + 1).slice(0, 12),
      item: String(it?.item ?? '').slice(0, 300),
      category: String(it?.category ?? 'other').slice(0, 30),
      checked: Boolean(it?.checked),
    }));
    if (!(await getStore().setChecklist(roomId, safe))) {
      return NextResponse.json({ error: 'Room not found' }, { status: 404 });
    }
    return NextResponse.json({ checklist: safe });
  } catch (error) {
    console.error('[api/checklist] PUT failed:', error);
    return NextResponse.json({ error: 'Could not save the checklist.' }, { status: 500 });
  }
}
