import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ walkId: string }> }
) {
  try {
    const { walkId } = await params;

    if (!walkId || walkId === 'undefined' || walkId === 'null') {
      return NextResponse.json({ error: 'Valid Walk ID is required' }, { status: 400 });
    }

    // Guardrail Rule 3: Parameterized queries only
    // Using exact AlloyDB column names: (id, buyer_name, builder_name, project_name, tower, flat_number, bhk, possession_date, letter_text, created_at)
    const walkResult = await query(
      `SELECT id, buyer_name, builder_name, project_name, tower, flat_number, bhk, possession_date, letter_text, created_at
       FROM walks WHERE id = $1`,
      [walkId]
    );

    if (!walkResult.rows || walkResult.rows.length === 0) {
      return NextResponse.json({ error: 'Walk not found' }, { status: 404 });
    }

    const row = walkResult.rows[0];
    const walk = {
      ...row,
      builder: row.builder_name,
      project: row.project_name,
      bhk: `${row.bhk} BHK`,
    };

    // Fetch rooms (exact column: room_type, status)
    const roomsResult = await query(
      `SELECT id, walk_id, room_type, status, checklist, created_at
       FROM rooms WHERE walk_id = $1
       ORDER BY created_at ASC`,
      [walkId]
    );

    // Fetch snags count per room
    const snagsResult = await query(
      `SELECT room_id, count(*)::int as snag_count
       FROM snags WHERE walk_id = $1
       GROUP BY room_id`,
      [walkId]
    );

    const snagCountMap = new Map<string, number>();
    for (const r of snagsResult.rows || []) {
      snagCountMap.set(r.room_id, Number(r.snag_count));
    }

    const roomsWithCounts = (roomsResult.rows || []).map((r) => ({
      ...r,
      room_name: r.room_type,
      snag_count: snagCountMap.get(r.id) || 0,
    }));

    return NextResponse.json({
      walk,
      rooms: roomsWithCounts,
    });
  } catch (error: any) {
    console.error('Error fetching walk details:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch walk details' },
      { status: 500 }
    );
  }
}
