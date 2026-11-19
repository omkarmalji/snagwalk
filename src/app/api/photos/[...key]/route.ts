import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { BUCKET_NAME, LOCAL_UPLOAD_DIR, getStorage } from '@/lib/gcs';

const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
};

const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

function mimeFor(name: string) {
  return MIME[name.split('.').pop()?.toLowerCase() || ''] || 'application/octet-stream';
}

/** Streams snag photos from the (private) bucket, or from local dev storage. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ key: string[] }> }) {
  const { key } = await params;
  if (!key || key.length !== 2 || !SAFE_NAME.test(key[1])) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const [scope, name] = key;
  const headers = { 'Content-Type': mimeFor(name), 'Cache-Control': 'private, max-age=31536000, immutable' };

  try {
    if (scope === 'local') {
      const file = path.join(LOCAL_UPLOAD_DIR, name);
      if (!fs.existsSync(file)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      return new NextResponse(new Uint8Array(fs.readFileSync(file)), { headers });
    }
    if (scope === 'snags') {
      const [buf] = await getStorage().bucket(BUCKET_NAME).file(`snags/${name}`).download();
      return new NextResponse(new Uint8Array(buf), { headers });
    }
  } catch (err) {
    console.warn('[photos] fetch failed:', (err as Error).message);
  }
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}
