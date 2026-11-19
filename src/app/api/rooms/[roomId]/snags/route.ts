import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { uploadPhotoToGcs } from '@/lib/gcs';
import { analyzeSnagPhoto } from '@/lib/gemini';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const { roomId } = await params;
    const result = await query(
      `SELECT id, walk_id, room_id, category, severity, description, location_note, photo_url, created_at
       FROM snags
       WHERE room_id = $1
       ORDER BY created_at ASC`,
      [roomId]
    );
    return NextResponse.json({ snags: result.rows || [] });
  } catch (error: any) {
    console.error('Error fetching snags:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch snags' },
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

    // Validate room existence
    const roomResult = await query(
      `SELECT r.id, r.walk_id, r.room_type, w.project_name, w.flat_number
       FROM rooms r
       JOIN walks w ON r.walk_id = w.id
       WHERE r.id = $1`,
      [roomId]
    );

    if (!roomResult.rows || roomResult.rows.length === 0) {
      return NextResponse.json({ error: 'Room not found' }, { status: 404 });
    }

    const room = roomResult.rows[0];
    const formData = await request.formData();
    const file = formData.get('photo') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'Photo is required for snag capture' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const mimeType = file.type || 'image/jpeg';
    const filename = file.name || 'snag_photo.jpg';

    // 1. Store photo in Cloud Storage bucket gs://snagwalk-photos-515212
    const photoUrl = await uploadPhotoToGcs(buffer, mimeType, filename);

    // 2. Send photo to Gemini latest Flash model on Vertex AI
    const analysis = await analyzeSnagPhoto(
      buffer,
      mimeType,
      `${room.room_type} (${room.project_name} Flat ${room.flat_number})`
    );

    // 3. Save JSON result to the snags table (exact columns: walk_id, room_id, category, severity, description, location_note, photo_url)
    const insertSql = `
      INSERT INTO snags (walk_id, room_id, category, severity, description, location_note, photo_url)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, walk_id, room_id, category, severity, description, location_note, photo_url, created_at;
    `;
    const insertParams = [
      room.walk_id,
      roomId,
      analysis.category,
      analysis.severity,
      analysis.description,
      analysis.location_note,
      photoUrl,
    ];

    const snagResult = await query(insertSql, insertParams);
    const createdSnag = snagResult.rows[0];

    return NextResponse.json({
      success: true,
      snag: createdSnag,
      analysis,
    });
  } catch (error: any) {
    console.error('Error during snag capture and analysis:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to capture and analyze snag' },
      { status: 500 }
    );
  }
}
