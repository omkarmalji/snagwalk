import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { defaultRoomsFor, parseBhk } from '@/lib/shared';
import { isUuid, serializeWalk, type WalkRow } from '@/lib/walks';

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

    // Guardrail: parameterized SQL only.
    const walkRes = await query<WalkRow>(
      `INSERT INTO walks (buyer_name, builder_name, project_name, tower, flat_number, bhk, possession_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, buyer_name, builder_name, project_name, tower, flat_number, bhk, possession_date, letter_text, created_at`,
      [buyer_name, builder, project, tower, flat_number, bhk, possession_date]
    );
    const walk = walkRes.rows[0];
    if (!walk) throw new Error('Failed to create walk');

    for (const roomType of defaultRoomsFor(bhk)) {
      await query(
        `INSERT INTO rooms (walk_id, room_type, status, checklist)
         VALUES ($1, $2, $3, $4)
         RETURNING id, walk_id, room_type, status, checklist, created_at`,
        [walk.id, roomType, 'pending', JSON.stringify([])]
      );
    }

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

    const res = await query<WalkRow>(
      `SELECT id, buyer_name, builder_name, project_name, tower, flat_number, bhk, possession_date, letter_text, created_at
       FROM walks WHERE id = ANY($1::uuid[])
       ORDER BY created_at DESC`,
      [ids]
    );
    const counts = await Promise.all(
      res.rows.map((w) => query(`SELECT room_id, count(*)::int AS snag_count FROM snags WHERE walk_id = $1 GROUP BY room_id`, [w.id]))
    );
    const walks = res.rows.map((w, i) => ({
      ...serializeWalk(w),
      snag_count: counts[i].rows.reduce((n, r) => n + Number(r.snag_count), 0),
    }));
    return NextResponse.json({ walks });
  } catch (error) {
    console.error('[api/walks] list failed:', error);
    return NextResponse.json({ error: 'Could not load walks.' }, { status: 500 });
  }
}
