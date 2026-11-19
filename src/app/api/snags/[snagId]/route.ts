import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { VALID_CATEGORIES, VALID_SEVERITIES, type SnagCategory, type SnagSeverity } from '@/lib/gemini';
import { isUuid } from '@/lib/walks';

type Ctx = { params: Promise<{ snagId: string }> };

export async function PUT(request: NextRequest, { params }: Ctx) {
  try {
    const { snagId } = await params;
    if (!isUuid(snagId)) return NextResponse.json({ error: 'Snag not found' }, { status: 404 });
    const body = await request.json();
    const category = String(body.category ?? '');
    const severity = String(body.severity ?? '');
    const description = String(body.description ?? '').trim().slice(0, 1000);
    const location_note = String(body.location_note ?? '').trim().slice(0, 200) || null;

    if (!VALID_CATEGORIES.includes(category as SnagCategory)) {
      return NextResponse.json({ error: 'Pick a valid category.' }, { status: 400 });
    }
    if (!VALID_SEVERITIES.includes(severity as SnagSeverity)) {
      return NextResponse.json({ error: 'Pick a valid severity.' }, { status: 400 });
    }
    if (!description) {
      return NextResponse.json({ error: 'Describe the defect.' }, { status: 400 });
    }

    const res = await query(
      `UPDATE snags SET category = $1, severity = $2, description = $3, location_note = $4 WHERE id = $5
       RETURNING id, walk_id, room_id, category, severity, description, location_note, photo_url, created_at`,
      [category, severity, description, location_note, snagId]
    );
    if (!res.rows[0]) return NextResponse.json({ error: 'Snag not found' }, { status: 404 });
    return NextResponse.json({ snag: res.rows[0] });
  } catch (error) {
    console.error('[api/snags/:id] PUT failed:', error);
    return NextResponse.json({ error: 'Could not update the snag.' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const { snagId } = await params;
    if (!isUuid(snagId)) return NextResponse.json({ error: 'Snag not found' }, { status: 404 });
    await query(`DELETE FROM snags WHERE id = $1`, [snagId]);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[api/snags/:id] DELETE failed:', error);
    return NextResponse.json({ error: 'Could not delete the snag.' }, { status: 500 });
  }
}
