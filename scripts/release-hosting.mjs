#!/usr/bin/env node
// Re-release Firebase Hosting (snagwalk-app.web.app) so its CDN drops pages cached from the previous
// Cloud Run revision. Run after every `gcloud run deploy`. Uses Application Default Credentials, so it
// works without `firebase login`. Usage: pnpm release:hosting
import { GoogleAuth } from 'google-auth-library';

const PROJECT = 'snagwalk-515212';
const SITE = 'snagwalk-app';
const API = 'https://firebasehosting.googleapis.com/v1beta1';
const CONFIG = { rewrites: [{ glob: '**', run: { serviceId: 'snagwalk', region: 'asia-southeast1' } }] };

const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
const token = await auth.getAccessToken();

async function call(method, path, body) {
  const res = await fetch(`${API}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'x-goog-user-project': PROJECT, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(json.error ?? json)}`);
  return json;
}

const version = await call('POST', `sites/${SITE}/versions`, { config: CONFIG });
await call('PATCH', `${version.name}?update_mask=status`, { status: 'FINALIZED' });
const release = await call('POST', `sites/${SITE}/releases?versionName=${version.name}`, {
  message: 'Re-release after Cloud Run deploy',
});
console.log(`Released ${version.name} at ${release.releaseTime}: https://${SITE}.web.app`);
