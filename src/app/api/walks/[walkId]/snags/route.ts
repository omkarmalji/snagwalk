import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ walkId: string }> }
) {
  try {
    const { walkId } = await params;

    // Get rooms with exact column: room_type
    const roomsResult = await query(
      `SELECT id, room_type, status
       FROM rooms
       WHERE walk_id = $1
       ORDER BY created_at ASC`,
      [walkId]
    );

    // Get all snags for this walk
    const snagsResult = await query(
      `SELECT s.id, s.walk_id, s.room_id, s.category, s.severity, s.description, s.location_note, s.photo_url, s.created_at, r.room_type
       FROM snags s
       JOIN rooms r ON s.room_id = r.id
       WHERE s.walk_id = $1
       ORDER BY r.created_at ASC, s.created_at ASC`,
      [walkId]
    );

    // Number all photos sequentially 1, 2, 3...
    let photoCounter = 1;
    const snagsWithPhotoNumbers = (snagsResult.rows || []).map((snag) => ({
      ...snag,
      room_name: snag.room_type,
      photo_number: photoCounter++,
    }));

    // Group snags by room
    const grouped = (roomsResult.rows || []).map((room) => {
      const roomSnags = snagsWithPhotoNumbers.filter((s) => s.room_id === room.id);
      return {
        room_id: room.id,
        room_name: room.room_type,
        room_type: room.room_type,
        snags: roomSnags,
      };
    });

    return NextResponse.json({
      all_snags: snagsWithPhotoNumbers,
      grouped_by_room: grouped,
      total_count: snagsWithPhotoNumbers.length,
    });
  } catch (error: any) {
    console.error('Error fetching all walk snags:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch walk snags' },
      { status: 500 }
    );
  }
}
