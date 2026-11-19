import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      buyer_name,
      builder,
      builder_name,
      project,
      project_name,
      tower,
      flat_number,
      bhk,
      possession_date,
    } = body;

    const finalBuilder = builder_name || builder;
    const finalProject = project_name || project;

    if (!buyer_name || !finalBuilder || !finalProject || !tower || !flat_number) {
      return NextResponse.json(
        { error: 'Buyer name, builder, project, tower, and flat number are required.' },
        { status: 400 }
      );
    }

    // Convert BHK string (e.g. "2 BHK" or "3") to integer for smallint column in AlloyDB
    const parsedBhk = parseInt(String(bhk).replace(/[^0-9]/g, ''), 10) || 2;

    // Guardrail Rule 3: Parameterized SQL queries only
    // Using exact AlloyDB table columns: (buyer_name, builder_name, project_name, tower, flat_number, bhk, possession_date)
    const walkInsertSql = `
      INSERT INTO walks (buyer_name, builder_name, project_name, tower, flat_number, bhk, possession_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, buyer_name, builder_name, project_name, tower, flat_number, bhk, possession_date, created_at;
    `;
    const walkParams = [
      buyer_name,
      finalBuilder,
      finalProject,
      tower,
      flat_number,
      parsedBhk,
      possession_date || new Date().toISOString().split('T')[0],
    ];

    const walkResult = await query(walkInsertSql, walkParams);
    if (!walkResult.rows || walkResult.rows.length === 0) {
      throw new Error('Failed to insert walk record.');
    }
    const newWalk = walkResult.rows[0];

    // Default rooms specified in requirement:
    // (living room, kitchen, 2 bedrooms, bathrooms, balcony)
    // Using exact AlloyDB table columns: (walk_id, room_type, status, checklist)
    const defaultRoomTypes = [
      'Living Room',
      'Kitchen',
      'Bedroom 1 (Master)',
      'Bedroom 2',
      'Bathrooms',
      'Balcony',
    ];

    const createdRooms = [];
    for (const roomType of defaultRoomTypes) {
      const roomInsertSql = `
        INSERT INTO rooms (walk_id, room_type, status, checklist)
        VALUES ($1, $2, $3, $4)
        RETURNING id, walk_id, room_type, status, checklist, created_at;
      `;
      const roomParams = [newWalk.id, roomType, 'pending', JSON.stringify([])];
      const roomResult = await query(roomInsertSql, roomParams);
      if (roomResult.rows && roomResult.rows.length > 0) {
        const r = roomResult.rows[0];
        createdRooms.push({
          ...r,
          room_name: r.room_type,
        });
      }
    }

    return NextResponse.json({
      success: true,
      walk: {
        ...newWalk,
        builder: newWalk.builder_name,
        project: newWalk.project_name,
        bhk: `${newWalk.bhk} BHK`,
      },
      rooms: createdRooms,
    });
  } catch (error: any) {
    console.error('Error creating walk:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create possession walk.' },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const result = await query(
      `SELECT id, buyer_name, builder_name, project_name, tower, flat_number, bhk, possession_date, created_at
       FROM walks
       ORDER BY created_at DESC
       LIMIT 20;`
    );

    const walks = (result.rows || []).map((w) => ({
      ...w,
      builder: w.builder_name,
      project: w.project_name,
      bhk: `${w.bhk} BHK`,
    }));

    return NextResponse.json({ walks });
  } catch (error: any) {
    console.error('Error fetching walks:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch walks.' },
      { status: 500 }
    );
  }
}
