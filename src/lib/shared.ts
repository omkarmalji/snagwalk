// Isomorphic helpers shared by API routes and client components.

export const CATEGORIES = [
  { value: 'wall_paint', label: 'Wall & paint' },
  { value: 'tiles', label: 'Tiles' },
  { value: 'plumbing', label: 'Plumbing' },
  { value: 'electrical', label: 'Electrical' },
  { value: 'doors_windows', label: 'Doors & windows' },
  { value: 'woodwork', label: 'Woodwork' },
  { value: 'ceiling', label: 'Ceiling' },
  { value: 'flooring', label: 'Flooring' },
  { value: 'other', label: 'Other' },
] as const;

export const SEVERITIES = ['minor', 'major', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const BHK_OPTIONS = [1, 2, 3, 4, 5] as const;

/** Languages the builder letter can be written in. Labels are shown in their own script. */
export const LETTER_LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'हिन्दी' },
  { value: 'mr', label: 'मराठी' },
] as const;
export type LetterLanguage = (typeof LETTER_LANGUAGES)[number]['value'];

export function parseLetterLanguage(value: unknown): LetterLanguage {
  return LETTER_LANGUAGES.some((l) => l.value === value) ? (value as LetterLanguage) : 'en';
}

export function categoryLabel(value: string): string {
  return CATEGORIES.find((c) => c.value === value)?.label ?? value.replace(/_/g, ' ');
}

/** Map a stored photo URL to a same-origin URL the browser can load (private bucket safe, canvas safe). */
export function photoSrc(url: string | null | undefined): string {
  if (!url) return '';
  const m = url.match(/^https:\/\/storage\.googleapis\.com\/[^/]+\/(snags\/[^?#]+)$/);
  if (m) return `/api/photos/${m[1]}`;
  return url;
}

/** Parse the BHK value from "3 BHK", "3" or 3. Returns 1-5, default 2. */
export function parseBhk(value: unknown): number {
  const n = parseInt(String(value ?? '').match(/\d+/)?.[0] ?? '', 10);
  if (!Number.isFinite(n)) return 2;
  return Math.min(5, Math.max(1, n));
}

/** Rooms provisioned for a new walk, sized to the BHK. */
export function defaultRoomsFor(bhk: number): string[] {
  const rooms = ['Entrance & Passage', 'Living Room', 'Kitchen'];
  for (let i = 1; i <= bhk; i++) rooms.push(i === 1 ? 'Master Bedroom' : `Bedroom ${i}`);
  const baths = Math.min(bhk, 3);
  for (let i = 1; i <= baths; i++) {
    rooms.push(i === 1 ? (bhk > 1 ? 'Master Bathroom' : 'Bathroom') : i === 2 ? 'Common Bathroom' : `Bathroom ${i}`);
  }
  rooms.push('Balcony');
  if (bhk >= 2) rooms.push('Utility Area');
  return rooms;
}
