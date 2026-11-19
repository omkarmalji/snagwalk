import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { generateSnagLetter } from '@/lib/gemini';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ walkId: string }> }
) {
  try {
    const { walkId } = await params;

    // Fetch walk info (exact columns)
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

    // Fetch rooms
    const roomsResult = await query(
      `SELECT id, room_type
       FROM rooms WHERE walk_id = $1
       ORDER BY created_at ASC`,
      [walkId]
    );

    // Fetch all snags from the snags table
    const snagsResult = await query(
      `SELECT s.id, s.room_id, s.category, s.severity, s.description, s.location_note, s.photo_url, s.created_at, r.room_type
       FROM snags s
       JOIN rooms r ON s.room_id = r.id
       WHERE s.walk_id = $1
       ORDER BY r.created_at ASC, s.created_at ASC`,
      [walkId]
    );

    let photoIndex = 1;
    const snagsWithNumbers = (snagsResult.rows || []).map((s) => ({
      ...s,
      room_name: s.room_type,
      photo_number: photoIndex++,
    }));

    const snagsByRoom = (roomsResult.rows || []).map((r) => ({
      room_name: r.room_type,
      snags: snagsWithNumbers
        .filter((s) => s.room_id === r.id)
        .map((s) => ({
          photo_number: s.photo_number,
          category: s.category,
          severity: s.severity,
          description: s.description,
          location_note: s.location_note,
          photo_url: s.photo_url,
        })),
    }));

    // Call Gemini to write the letter following strict snag letter rules
    const letter = await generateSnagLetter(walk, snagsByRoom);

    // Persist letter_text back to walks table
    await query(
      `UPDATE walks SET letter_text = $1 WHERE id = $2`,
      [letter, walkId]
    );

    return NextResponse.json({
      success: true,
      letter,
      walk,
      snags: snagsWithNumbers,
      snags_by_room: snagsByRoom,
    });
  } catch (error: any) {
    console.error('Error generating snag letter:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to generate snag letter' },
      { status: 500 }
    );
  }
}
