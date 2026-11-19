import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { generateRoomChecklist } from '@/lib/gemini';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const { roomId } = await params;

    if (!roomId || roomId === 'undefined' || roomId === 'null') {
      return NextResponse.json({ error: 'Valid Room ID is required' }, { status: 400 });
    }

    // Exact AlloyDB schema columns
    const roomResult = await query(
      `SELECT r.id, r.walk_id, r.room_type, r.status, r.checklist, w.bhk, w.project_name
       FROM rooms r
       JOIN walks w ON r.walk_id = w.id
       WHERE r.id = $1`,
      [roomId]
    );

    if (!roomResult.rows || roomResult.rows.length === 0) {
      return NextResponse.json({ error: 'Room not found' }, { status: 404 });
    }

    const room = roomResult.rows[0];
    let checklist = room.checklist;

    if (typeof checklist === 'string') {
      try {
        checklist = JSON.parse(checklist);
      } catch {
        checklist = [];
      }
    }

    // If no checklist exists yet, generate using Gemini on Vertex AI
    if (!checklist || checklist.length === 0) {
      checklist = await generateRoomChecklist(room.room_type, room.room_type, {
        bhk: `${room.bhk} BHK`,
        project: room.project_name,
      });

      // Update room in database with generated checklist
      await query(
        `UPDATE rooms SET checklist = $1 WHERE id = $2`,
        [JSON.stringify(checklist), roomId]
      );
    }

    return NextResponse.json({
      room: {
        id: room.id,
        room_name: room.room_type,
        room_type: room.room_type,
        status: room.status,
        checklist,
      },
    });
  } catch (error: any) {
    console.error('Error fetching room checklist:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to get room checklist' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const { roomId } = await params;

    if (!roomId || roomId === 'undefined' || roomId === 'null') {
      return NextResponse.json({ error: 'Valid Room ID is required' }, { status: 400 });
    }

    const roomResult = await query(
      `SELECT r.id, r.walk_id, r.room_type, r.status, w.bhk, w.project_name
       FROM rooms r
       JOIN walks w ON r.walk_id = w.id
       WHERE r.id = $1`,
      [roomId]
    );

    if (!roomResult.rows || roomResult.rows.length === 0) {
      return NextResponse.json({ error: 'Room not found' }, { status: 404 });
    }

    const room = roomResult.rows[0];

    // Force regeneration from Gemini on Vertex AI
    const checklist = await generateRoomChecklist(room.room_type, room.room_type, {
      bhk: `${room.bhk} BHK`,
      project: room.project_name,
    });

    await query(
      `UPDATE rooms SET checklist = $1 WHERE id = $2`,
      [JSON.stringify(checklist), roomId]
    );

    return NextResponse.json({ success: true, checklist });
  } catch (error: any) {
    console.error('Error regenerating checklist:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to regenerate checklist' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const { roomId } = await params;
    const { checklist } = await request.json();

    if (!Array.isArray(checklist)) {
      return NextResponse.json({ error: 'Invalid checklist format' }, { status: 400 });
    }

    await query(
      `UPDATE rooms SET checklist = $1 WHERE id = $2`,
      [JSON.stringify(checklist), roomId]
    );

    return NextResponse.json({ success: true, checklist });
  } catch (error: any) {
    console.error('Error updating checklist:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to update checklist' },
      { status: 500 }
    );
  }
}
