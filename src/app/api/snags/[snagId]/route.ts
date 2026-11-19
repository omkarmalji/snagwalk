import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

const VALID_CATEGORIES = [
  'wall_paint',
  'tiles',
  'plumbing',
  'electrical',
  'doors_windows',
  'woodwork',
  'ceiling',
  'flooring',
  'other',
];

const VALID_SEVERITIES = ['minor', 'major', 'critical'];

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ snagId: string }> }
) {
  try {
    const { snagId } = await params;
    const result = await query(
      `SELECT id, walk_id, room_id, category, severity, description, location_note, photo_url, created_at
       FROM snags WHERE id = $1`,
      [snagId]
    );

    if (!result.rows || result.rows.length === 0) {
      return NextResponse.json({ error: 'Snag not found' }, { status: 404 });
    }

    return NextResponse.json({ snag: result.rows[0] });
  } catch (error: any) {
    console.error('Error fetching snag:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch snag' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ snagId: string }> }
) {
  try {
    const { snagId } = await params;
    const body = await request.json();
    const { category, severity, description, location_note } = body;

    if (!VALID_CATEGORIES.includes(category)) {
      return NextResponse.json(
        { error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}` },
        { status: 400 }
      );
    }

    if (!VALID_SEVERITIES.includes(severity)) {
      return NextResponse.json(
        { error: `Invalid severity. Must be one of: ${VALID_SEVERITIES.join(', ')}` },
        { status: 400 }
      );
    }

    if (!description || description.trim() === '') {
      return NextResponse.json({ error: 'Description is required' }, { status: 400 });
    }

    // Parameterized SQL query (Guardrail Rule 3) - without updated_at column
    const updateSql = `
      UPDATE snags
      SET category = $1, severity = $2, description = $3, location_note = $4
      WHERE id = $5
      RETURNING id, walk_id, room_id, category, severity, description, location_note, photo_url, created_at;
    `;
    const updateParams = [category, severity, description, location_note || null, snagId];
    const result = await query(updateSql, updateParams);

    if (!result.rows || result.rows.length === 0) {
      return NextResponse.json({ error: 'Snag not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, snag: result.rows[0] });
  } catch (error: any) {
    console.error('Error updating snag:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to update snag' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ snagId: string }> }
) {
  try {
    const { snagId } = await params;
    await query(`DELETE FROM snags WHERE id = $1`, [snagId]);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting snag:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to delete snag' },
      { status: 500 }
    );
  }
}
