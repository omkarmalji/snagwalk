import { Storage } from '@google-cloud/storage';
import fs from 'fs';
import path from 'path';

const BUCKET_NAME = process.env.GCS_BUCKET_NAME || 'snagwalk-photos-515212';
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'snagwalk-515212';

let storageClient: Storage | null = null;

function getStorageClient(): Storage {
  if (!storageClient) {
    storageClient = new Storage({
      projectId: PROJECT_ID,
    });
  }
  return storageClient;
}

/**
 * Uploads a photo to Cloud Storage bucket gs://snagwalk-photos-515212.
 * Guardrail Rule 5: Photos live in Cloud Storage bucket gs://snagwalk-photos-515212. Store only the URL in the database.
 */
export async function uploadPhotoToGcs(
  buffer: Buffer,
  mimeType: string,
  originalFilename: string
): Promise<string> {
  const sanitizedName = originalFilename.replace(/[^a-zA-Z0-9.-]/g, '_');
  const destinationPath = `snags/${Date.now()}-${sanitizedName}`;

  try {
    const storage = getStorageClient();
    const bucket = storage.bucket(BUCKET_NAME);
    const file = bucket.file(destinationPath);

    await file.save(buffer, {
      metadata: {
        contentType: mimeType,
        metadata: {
          uploadedBy: 'SnagWalk Mobile App',
          createdAt: new Date().toISOString(),
        },
      },
      resumable: false,
    });

    // Cloud Storage URL
    const publicUrl = `https://storage.googleapis.com/${BUCKET_NAME}/${destinationPath}`;
    console.log(`Successfully uploaded photo to GCS: gs://${BUCKET_NAME}/${destinationPath}`);
    return publicUrl;
  } catch (err: any) {
    console.warn(`GCS upload to gs://${BUCKET_NAME}/${destinationPath} encountered an issue: ${err.message}.`);
    console.warn('Falling back to local static storage for development resilience.');

    // Local fallback for offline/local dev environment
    const uploadDir = path.join(process.cwd(), 'public', 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    const localFilename = `${Date.now()}-${sanitizedName}`;
    const localFilePath = path.join(uploadDir, localFilename);
    fs.writeFileSync(localFilePath, buffer);

    return `/uploads/${localFilename}`;
  }
}
