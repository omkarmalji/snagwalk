import { Storage } from '@google-cloud/storage';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export const BUCKET_NAME = process.env.GCS_BUCKET_NAME || 'snagwalk-photos-515212';
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'snagwalk-515212';
export const LOCAL_UPLOAD_DIR = path.join(process.cwd(), '.local_uploads');

const fallbackEnabled =
  (process.env.STORAGE_FALLBACK || (process.env.NODE_ENV === 'production' ? 'off' : 'on')).toLowerCase() !== 'off';

let storageClient: Storage | null = null;
let lastMode: 'gcs' | 'local' | null = null;
let lastError: string | null = null;

export function getStorage(): Storage {
  if (!storageClient) storageClient = new Storage({ projectId: PROJECT_ID });
  return storageClient;
}

export function getStorageStatus() {
  return { bucket: BUCKET_NAME, mode: lastMode ?? 'unknown', fallbackEnabled, lastError };
}

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

/**
 * Uploads a snag photo to gs://snagwalk-photos-515212 and returns its canonical URL.
 * Guardrail: photos live in Cloud Storage; only the URL is stored in the database.
 * The browser never loads the bucket directly; it goes through /api/photos (works with private buckets).
 */
export async function uploadPhotoToGcs(buffer: Buffer, mimeType: string): Promise<string> {
  const filename = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${EXT[mimeType] || 'jpg'}`;
  const objectPath = `snags/${filename}`;

  try {
    await getStorage()
      .bucket(BUCKET_NAME)
      .file(objectPath)
      .save(buffer, {
        resumable: false,
        metadata: { contentType: mimeType, cacheControl: 'private, max-age=31536000' },
      });
    lastMode = 'gcs';
    return `https://storage.googleapis.com/${BUCKET_NAME}/${objectPath}`;
  } catch (err) {
    lastError = (err as Error).message;
    if (!fallbackEnabled) throw err;
    console.warn(`[gcs] upload failed (${lastError}). Saving to local dev storage.`);
    fs.mkdirSync(LOCAL_UPLOAD_DIR, { recursive: true });
    fs.writeFileSync(path.join(LOCAL_UPLOAD_DIR, filename), buffer);
    lastMode = 'local';
    return `/api/photos/local/${filename}`;
  }
}
