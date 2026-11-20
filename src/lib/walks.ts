import crypto from 'crypto';
import { getStore, type RoomDoc, type SnagDoc } from '@/lib/store';
import type { AiSource, LetterRoomGroup, LetterWalk } from '@/lib/gemini';
import type { LetterLanguage } from '@/lib/shared';

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
  const row = await getStore().getWalk(walkId);
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

/**
 * Number snags 1..n in room order, then capture order within a room, and group them by room. The same
 * numbers label the photo annexure and the letter, so both always agree. Snags of unknown rooms are dropped.
 */
export function numberSnags(rooms: RoomDoc[], snagDocs: SnagDoc[]) {
  const roomOrder = new Map(rooms.map((r, i) => [r.id, i]));
  const roomName = new Map(rooms.map((r) => [r.id, r.room_type]));
  const ordered = snagDocs
    .filter((s) => roomOrder.has(s.room_id))
    .sort((a, b) => roomOrder.get(a.room_id)! - roomOrder.get(b.room_id)! || a.created_at.localeCompare(b.created_at));

  const snags: NumberedSnag[] = ordered.map((s, i) => ({
    id: s.id,
    walk_id: s.walk_id,
    room_id: s.room_id,
    room_name: roomName.get(s.room_id) ?? 'Room',
    category: s.category,
    severity: s.severity,
    description: s.description,
    location_note: s.location_note,
    photo_url: s.photo_url,
    created_at: s.created_at,
    photo_number: i + 1,
  }));

  const groups: LetterRoomGroup[] = rooms.map((r) => ({
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

/** All snags of a walk, numbered, plus the room grouping used by the letter. */
export async function getNumberedSnags(walkId: string) {
  const store = getStore();
  const [rooms, snagDocs] = await Promise.all([store.listRooms(walkId), store.listSnagsByWalk(walkId)]);
  return { rooms, ...numberSnags(rooms, snagDocs) };
}

// ---------------------------------------------------------------------------
// Letter persistence. letter_text stores the Markdown plus a trailing marker with a fingerprint of the
// snags it was generated from, so the UI can tell when the letter is stale (snag added/edited/deleted).
// ---------------------------------------------------------------------------

// lang is optional so letters saved before multi-language support still parse (they are English).
const MARKER_RE = /\n*<!--\s*snagwalk:fp=([a-f0-9]+);src=(gemini|fallback)(?:;lang=(en|hi|mr))?\s*-->\s*$/;

export function letterFingerprint(walk: PublicWalk, groups: LetterRoomGroup[]): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ w: toLetterWalk(walk), g: groups }))
    .digest('hex')
    .slice(0, 16);
}

export function packLetter(markdown: string, fp: string, source: AiSource, language: LetterLanguage = 'en'): string {
  return `${markdown.trim()}\n\n<!-- snagwalk:fp=${fp};src=${source};lang=${language} -->`;
}

export interface SavedLetter {
  markdown: string;
  fp: string | null;
  source: AiSource | null;
  language: LetterLanguage;
}

export function unpackLetter(text: string | null): SavedLetter | null {
  if (!text) return null;
  const m = text.match(MARKER_RE);
  if (!m) return { markdown: text.trim(), fp: null, source: null, language: 'en' };
  return {
    markdown: text.replace(MARKER_RE, '').trim(),
    fp: m[1],
    source: m[2] as AiSource,
    language: (m[3] as LetterLanguage | undefined) ?? 'en',
  };
}
