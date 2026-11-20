import { describe, expect, it } from 'vitest';
import { isUuid, letterFingerprint, packLetter, serializeWalk, unpackLetter, type WalkRow } from './walks';
import type { LetterRoomGroup } from './gemini';

const row: WalkRow = {
  id: '4300da38-07d2-4e2e-8370-962b43c1b562',
  buyer_name: 'Omkar',
  builder_name: 'Lodha',
  project_name: 'Lodha apartments',
  tower: 'Tower 1',
  flat_number: '1402',
  bhk: 2,
  possession_date: '2026-11-19',
  letter_text: null,
  created_at: '2026-11-19T18:21:04.274Z',
};

const groups: LetterRoomGroup[] = [
  {
    room_name: 'Living Room',
    snags: [{ photo_number: 1, category: 'wall_paint', severity: 'major', description: 'Peeling paint', location_note: 'Window' }],
  },
];

describe('isUuid', () => {
  it('accepts uuids and rejects anything else (route params are checked before any SQL)', () => {
    expect(isUuid(row.id)).toBe(true);
    expect(isUuid('1402')).toBe(false);
    expect(isUuid("' OR 1=1 --")).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});

describe('serializeWalk', () => {
  it('keeps possession_date a calendar date even for a Date at local midnight', () => {
    expect(serializeWalk(row).possession_date).toBe('2026-11-19');
    expect(serializeWalk({ ...row, possession_date: new Date('2026-11-19T00:00:00Z') }).possession_date).toBe('2026-11-19');
  });
});

describe('letter fingerprint', () => {
  const walk = serializeWalk(row);

  it('is stable for the same snags', () => {
    expect(letterFingerprint(walk, groups)).toBe(letterFingerprint(walk, structuredClone(groups)));
  });

  it('changes when a snag is edited, so the saved letter is flagged stale', () => {
    const edited = structuredClone(groups);
    edited[0].snags[0].severity = 'critical';
    expect(letterFingerprint(walk, edited)).not.toBe(letterFingerprint(walk, groups));
  });

  it('changes when a snag is added', () => {
    const added = structuredClone(groups);
    added[0].snags.push({ photo_number: 2, category: 'tiles', severity: 'minor', description: 'Grout', location_note: null });
    expect(letterFingerprint(walk, added)).not.toBe(letterFingerprint(walk, groups));
  });
});

describe('packLetter / unpackLetter', () => {
  it('round-trips markdown, fingerprint, source and language', () => {
    const packed = packLetter('# Notice\n\nBody', 'abc123', 'gemini', 'mr');
    expect(unpackLetter(packed)).toEqual({ markdown: '# Notice\n\nBody', fp: 'abc123', source: 'gemini', language: 'mr' });
  });

  it('reads letters saved before the language field existed as English', () => {
    const legacy = 'Body\n\n<!-- snagwalk:fp=abc123;src=fallback -->';
    expect(unpackLetter(legacy)).toEqual({ markdown: 'Body', fp: 'abc123', source: 'fallback', language: 'en' });
  });

  it('treats text without a marker as unfingerprinted (always stale)', () => {
    expect(unpackLetter('Hand-written')).toEqual({ markdown: 'Hand-written', fp: null, source: null, language: 'en' });
    expect(unpackLetter(null)).toBeNull();
  });

  it('never leaks the marker into the markdown shown to the buyer', () => {
    expect(unpackLetter(packLetter('Body', 'f00d', 'gemini'))!.markdown).not.toContain('snagwalk:fp');
  });
});
