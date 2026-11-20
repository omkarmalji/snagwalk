import { NextRequest, NextResponse } from 'next/server';
import { getStore } from '@/lib/store';
import { defaultRoomsFor, parseBhk } from '@/lib/shared';
import { isUuid, serializeWalk } from '@/lib/walks';

const MAX_LEN = 120;

function clean(v: unknown): string {
  return String(v ?? '').trim().slice(0, MAX_LEN);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const buyer_name = clean(body.buyer_name);
    const builder = clean(body.builder_name ?? body.builder);
    const project = clean(body.project_name ?? body.project);
    const tower = clean(body.tower);
    const flat_number = clean(body.flat_number);
    const bhk = parseBhk(body.bhk);
    const possession_date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.possession_date))
      ? String(body.possession_date)
      : new Date().toISOString().slice(0, 10);

    const missing = Object.entries({ buyer_name, builder, project, tower, flat_number })
      .filter(([, v]) => !v)
      .map(([k]) => k);
    if (missing.length) {
      return NextResponse.json({ error: 'Please fill in every field.', fields: missing }, { status: 400 });
    }

    // One atomic write: the walk and every room provisioned for its BHK.
    const walk = await getStore().createWalk(
      { buyer_name, builder_name: builder, project_name: project, tower, flat_number, bhk, possession_date },
      defaultRoomsFor(bhk)
    );

    return NextResponse.json({ walk: serializeWalk(walk) }, { status: 201 });
  } catch (error) {
    console.error('[api/walks] create failed:', error);
    return NextResponse.json({ error: 'Could not create the walk. Please try again.' }, { status: 500 });
  }
}

/**
 * Lists walks by id. The client keeps the ids of walks created on this device,
 * so one buyer never sees another buyer's walks (there is no auth in this MVP).
 */
export async function GET(request: NextRequest) {
  try {
    const ids = (request.nextUrl.searchParams.get('ids') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(isUuid)
      .slice(0, 20);
    if (ids.length === 0) return NextResponse.json({ walks: [] });

    const store = getStore();
    const rows = await store.getWalks(ids);
    const snagLists = await Promise.all(rows.map((w) => store.listSnagsByWalk(w.id)));
    const walks = rows.map((w, i) => ({ ...serializeWalk(w), snag_count: snagLists[i].length }));
    return NextResponse.json({ walks });
  } catch (error) {
    console.error('[api/walks] list failed:', error);
    return NextResponse.json({ error: 'Could not load walks.' }, { status: 500 });
  }
}
