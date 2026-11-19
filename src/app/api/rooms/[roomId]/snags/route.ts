import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { uploadPhotoToGcs } from '@/lib/gcs';
import { analyzeSnagPhoto } from '@/lib/gemini';
import { isUuid } from '@/lib/walks';

type Ctx = { params: Promise<{ roomId: string }> };

const MAX_BYTES = 12 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const { roomId } = await params;
    if (!isUuid(roomId)) return NextResponse.json({ error: 'Room not found' }, { status: 404 });
    const res = await query(
      `SELECT id, walk_id, room_id, category, severity, description, location_note, photo_url, created_at
       FROM snags WHERE room_id = $1
       ORDER BY created_at ASC`,
      [roomId]
    );
    return NextResponse.json({ snags: res.rows });
  } catch (error) {
    console.error('[api/rooms/:id/snags] GET failed:', error);
    return NextResponse.json({ error: 'Could not load snags.' }, { status: 500 });
  }
}

/**
 * Snag capture: store the photo in Cloud Storage, analyse it with Gemini, save the JSON result to the
 * snags table, and return it so the buyer can review and edit (or discard) it.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { roomId } = await params;
    if (!isUuid(roomId)) return NextResponse.json({ error: 'Room not found' }, { status: 404 });

    const roomRes = await query(
      `SELECT r.id, r.walk_id, r.room_type, r.status, r.checklist, w.bhk, w.project_name
       FROM rooms r JOIN walks w ON r.walk_id = w.id
       WHERE r.id = $1`,
      [roomId]
    );
    const room = roomRes.rows[0];
    if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 });

    const form = await request.formData();
    const file = form.get('photo');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Attach a photo of the defect.' }, { status: 400 });
    }
    const mimeType = file.type || 'image/jpeg';
    if (!ALLOWED.includes(mimeType)) {
      return NextResponse.json({ error: 'Use a JPEG, PNG, WebP or HEIC photo.' }, { status: 415 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'Photo is larger than 12 MB.' }, { status: 413 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Upload and analysis are independent: run them in parallel.
    const [photoUrl, analysis] = await Promise.all([
      uploadPhotoToGcs(buffer, mimeType),
      analyzeSnagPhoto(buffer, mimeType, room.room_type),
    ]);

    const insert = await query(
      `INSERT INTO snags (walk_id, room_id, category, severity, description, location_note, photo_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, walk_id, room_id, category, severity, description, location_note, photo_url, created_at`,
      [
        room.walk_id,
        roomId,
        analysis.data.category,
        analysis.data.severity,
        analysis.data.description,
        analysis.data.location_note || null,
        photoUrl,
      ]
    );

    return NextResponse.json(
      { snag: insert.rows[0], box_2d: analysis.data.box_2d ?? null, source: analysis.source },
      { status: 201 }
    );
  } catch (error) {
    console.error('[api/rooms/:id/snags] POST failed:', error);
    return NextResponse.json({ error: 'Could not save this photo. Please try again.' }, { status: 500 });
  }
}
