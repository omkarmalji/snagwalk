import crypto from 'crypto';
import { query } from '@/lib/db';
import type { AiSource, LetterRoomGroup, LetterWalk } from '@/lib/gemini';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

export interface WalkRow {
  id: string;
  buyer_name: string;
  builder_name: string;
  project_name: string;
  tower: string;
  flat_number: string;
  bhk: number;
  possession_date: string | Date;
  letter_text?: string | null;
  created_at: string | Date;
}

function isoDate(v: string | Date): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

/** Public walk shape used by the UI. letter_text is never sent raw. */
export function serializeWalk(row: WalkRow) {
  return {
    id: row.id,
    buyer_name: row.buyer_name,
    builder: row.builder_name,
    project: row.project_name,
    tower: row.tower,
    flat_number: row.flat_number,
    bhk: Number(row.bhk),
    bhk_label: `${row.bhk} BHK`,
    possession_date: isoDate(row.possession_date),
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    has_letter: Boolean(row.letter_text),
  };
}

export type PublicWalk = ReturnType<typeof serializeWalk>;

export function toLetterWalk(w: PublicWalk): LetterWalk {
  return {
    buyer_name: w.buyer_name,
    builder: w.builder,
    project: w.project,
    tower: w.tower,
    flat_number: w.flat_number,
    bhk: w.bhk_label,
    possession_date: w.possession_date,
  };
}

export async function getWalk(walkId: string): Promise<{ walk: PublicWalk; letterText: string | null } | null> {
  const res = await query<WalkRow>(
    `SELECT id, buyer_name, builder_name, project_name, tower, flat_number, bhk, possession_date, letter_text, created_at
     FROM walks WHERE id = $1`,
    [walkId]
  );
  const row = res.rows[0];
  if (!row) return null;
  return { walk: serializeWalk(row), letterText: row.letter_text ?? null };
}

export interface NumberedSnag {
  id: string;
  walk_id: string;
  room_id: string;
  room_name: string;
  category: string;
  severity: string;
  description: string;
  location_note: string | null;
  photo_url: string;
  created_at: string;
  photo_number: number;
}

/** All snags of a walk, numbered 1..n in room order then capture order, plus room grouping. */
export async function getNumberedSnags(walkId: string) {
  const roomsRes = await query<{ id: string; room_type: string }>(
    `SELECT id, walk_id, room_type, status, checklist, created_at
     FROM rooms WHERE walk_id = $1
     ORDER BY created_at ASC`,
    [walkId]
  );
  const snagsRes = await query(
    `SELECT s.id, s.walk_id, s.room_id, s.category, s.severity, s.description, s.location_note, s.photo_url, s.created_at, r.room_type
     FROM snags s JOIN rooms r ON s.room_id = r.id
     WHERE s.walk_id = $1
     ORDER BY r.created_at ASC, s.created_at ASC`,
    [walkId]
  );

  const snags: NumberedSnag[] = snagsRes.rows.map((s, i) => ({
    id: s.id,
    walk_id: s.walk_id,
    room_id: s.room_id,
    room_name: s.room_type,
    category: s.category,
    severity: s.severity,
    description: s.description,
    location_note: s.location_note,
    photo_url: s.photo_url,
    created_at: s.created_at instanceof Date ? s.created_at.toISOString() : s.created_at,
    photo_number: i + 1,
  }));

  const groups: LetterRoomGroup[] = roomsRes.rows.map((r) => ({
    room_name: r.room_type,
    snags: snags
      .filter((s) => s.room_id === r.id)
      .map((s) => ({
        photo_number: s.photo_number,
        category: s.category,
        severity: s.severity,
        description: s.description,
        location_note: s.location_note,
      })),
  }));

  return { snags, groups };
}

// ---------------------------------------------------------------------------
// Letter persistence. letter_text stores the Markdown plus a trailing marker with a fingerprint of the
// snags it was generated from, so the UI can tell when the letter is stale (snag added/edited/deleted).
// ---------------------------------------------------------------------------

const MARKER_RE = /\n*<!--\s*snagwalk:fp=([a-f0-9]+);src=(gemini|fallback)\s*-->\s*$/;

export function letterFingerprint(walk: PublicWalk, groups: LetterRoomGroup[]): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ w: toLetterWalk(walk), g: groups }))
    .digest('hex')
    .slice(0, 16);
}

export function packLetter(markdown: string, fp: string, source: AiSource): string {
  return `${markdown.trim()}\n\n<!-- snagwalk:fp=${fp};src=${source} -->`;
}

export function unpackLetter(text: string | null): { markdown: string; fp: string | null; source: AiSource | null } | null {
  if (!text) return null;
  const m = text.match(MARKER_RE);
  if (!m) return { markdown: text.trim(), fp: null, source: null };
  return { markdown: text.replace(MARKER_RE, '').trim(), fp: m[1], source: m[2] as AiSource };
}
