#!/usr/bin/env node
// End-to-end API smoke test for SnagWalk.
// Usage: node scripts/smoke.mjs [baseUrl] [photo.jpg]
// Runs the full flow against a running server: walk -> rooms -> checklist -> snag capture -> edit ->
// letter -> stale detection -> delete. Exits non-zero on the first failure.
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:3000';
const PHOTO = process.argv[3];

// 64x48 grey JPEG used when no photo is given (Gemini will report "no visible defect").
const TINY_JPEG =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAAwAEABAREA/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAA/AKp//9k=';

let failures = 0;
function check(label, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
  return cond;
}

async function call(method, path, body, isForm = false) {
  const t = Date.now();
  const res = await fetch(BASE + path, {
    method,
    headers: body && !isForm ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json, ms: Date.now() - t };
}

const health = await call('GET', '/api/health');
check('health', health.status === 200, `ai=${health.json?.ai?.auth}/${health.json?.ai?.model} db=${health.json?.db?.mode}`);

const bad = await call('POST', '/api/walks', { buyer_name: '' });
check('walk validation rejects empty form', bad.status === 400);

const created = await call('POST', '/api/walks', {
  buyer_name: 'Smoke Test',
  builder: 'Test Builder',
  project: 'Test Project',
  tower: 'T1',
  flat_number: '101',
  bhk: '3 BHK',
});
check('create walk', created.status === 201, `${created.ms}ms`);
const walkId = created.json?.walk?.id;
if (!walkId) process.exit(1);

const walk = await call('GET', `/api/walks/${walkId}`);
const rooms = walk.json?.rooms ?? [];
check('3 BHK gets 3 bedrooms', rooms.filter((r) => /bedroom/i.test(r.room_name)).length === 3, `${rooms.length} rooms`);

const room = rooms.find((r) => r.room_name === 'Kitchen');
const checklist = await call('GET', `/api/rooms/${room.id}/checklist`);
check('checklist generated', checklist.json?.checklist?.length >= 4, `source=${checklist.json?.source} ${checklist.ms}ms`);

const ticked = checklist.json.checklist.map((c, i) => ({ ...c, checked: i === 0 }));
const saved = await call('PUT', `/api/rooms/${room.id}/checklist`, { checklist: ticked });
check('checklist tick saved', saved.json?.checklist?.[0]?.checked === true);

const form = new FormData();
const bytes = PHOTO ? fs.readFileSync(PHOTO) : Buffer.from(TINY_JPEG, 'base64');
form.append('photo', new Blob([bytes], { type: 'image/jpeg' }), 'snag.jpg');
const snag = await call('POST', `/api/rooms/${room.id}/snags`, form, true);
check('snag captured + analysed', snag.status === 201, `source=${snag.json?.source} severity=${snag.json?.snag?.severity} ${snag.ms}ms`);
const snagId = snag.json?.snag?.id;

const photo = await fetch(BASE + (snag.json.snag.photo_url.match(/storage\.googleapis\.com\/[^/]+\/(.+)$/)
  ? `/api/photos/${snag.json.snag.photo_url.match(/storage\.googleapis\.com\/[^/]+\/(.+)$/)[1]}`
  : snag.json.snag.photo_url));
check('photo served via proxy', photo.ok && (photo.headers.get('content-type') || '').startsWith('image/'));

const edited = await call('PUT', `/api/snags/${snagId}`, {
  category: 'tiles',
  severity: 'major',
  description: 'Hollow-sounding floor tile near the sink.',
  location_note: 'Floor, in front of the sink',
});
check('snag edit', edited.json?.snag?.category === 'tiles');
const invalid = await call('PUT', `/api/snags/${snagId}`, { category: 'nope', severity: 'major', description: 'x' });
check('snag edit rejects invalid category', invalid.status === 400);

const letter = await call('POST', `/api/walks/${walkId}/letter`);
const md = letter.json?.letter || '';
check('letter generated', letter.status === 200 && md.length > 200, `source=${letter.json?.source} ${letter.ms}ms`);
check('letter cites Photo #1', /Photo #1/.test(md));
check('letter has no Photo #2 (only one snag exists)', !/Photo #2/.test(md));
check('letter asks for 15 days', /15/.test(md));

const fresh = await call('GET', `/api/walks/${walkId}/letter`);
check('letter fresh after generation', fresh.json?.stale === false);
await call('PUT', `/api/snags/${snagId}`, { category: 'tiles', severity: 'critical', description: 'Changed.', location_note: '' });
const stale = await call('GET', `/api/walks/${walkId}/letter`);
check('letter stale after snag edit', stale.json?.stale === true);

const del = await call('DELETE', `/api/snags/${snagId}`);
const after = await call('GET', `/api/rooms/${room.id}/snags`);
check('snag delete', del.status === 200 && after.json?.snags?.length === 0);

const list = await call('GET', `/api/walks?ids=${walkId}`);
check('walk list by id', list.json?.walks?.[0]?.id === walkId);
const none = await call('GET', '/api/walks');
check('walk list without ids is empty', Array.isArray(none.json?.walks) && none.json.walks.length === 0);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
