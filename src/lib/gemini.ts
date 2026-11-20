import { GoogleGenAI, MediaResolution, ThinkingLevel, Type, type Schema } from '@google/genai';
import type { LetterLanguage } from '@/lib/shared';
import { INSPECTION_METHODS, ROOM_PRACTICE, practiceKeyFor } from '@/lib/inspection-practice';

/**
 * Gemini client for SnagWalk.
 *
 * Auth resolution (GEMINI_AUTH=auto by default):
 *  - GEMINI_API_KEY starting with "AQ." -> Vertex AI express mode key
 *  - any other GEMINI_API_KEY            -> Gemini API (AI Studio) key
 *  - no key                              -> Vertex AI with Application Default Credentials
 *    (Cloud Run service account, or `gcloud auth application-default login` locally)
 * Force a mode with GEMINI_AUTH=adc | apikey.
 */

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'snagwalk-515212';
const LOCATION = process.env.VERTEX_AI_LOCATION || 'asia-south1';
export const MODEL_NAME = process.env.GEMINI_MODEL || process.env.VERTEX_AI_MODEL || 'gemini-3.5-flash';
// Low thinking keeps photo analysis around 3s (default thinking measured ~25s), which matters when the
// buyer is standing in the flat. GEMINI_THINKING=off disables the setting for models that do not support it.
const THINKING = (process.env.GEMINI_THINKING || 'low').toUpperCase();

export type AiSource = 'gemini' | 'fallback';

export interface AiResult<T> {
  data: T;
  source: AiSource;
}

export type SnagCategory =
  | 'wall_paint'
  | 'tiles'
  | 'plumbing'
  | 'electrical'
  | 'doors_windows'
  | 'woodwork'
  | 'ceiling'
  | 'flooring'
  | 'other';

export type SnagSeverity = 'minor' | 'major' | 'critical';

export const VALID_CATEGORIES: SnagCategory[] = [
  'wall_paint',
  'tiles',
  'plumbing',
  'electrical',
  'doors_windows',
  'woodwork',
  'ceiling',
  'flooring',
  'other',
];

export const VALID_SEVERITIES: SnagSeverity[] = ['minor', 'major', 'critical'];

export interface SnagAnalysisResult {
  category: SnagCategory;
  severity: SnagSeverity;
  description: string;
  location_note: string;
  /** Defect bounding box [ymin, xmin, ymax, xmax] normalised to 0-1000. Review-only, not persisted. */
  box_2d?: [number, number, number, number] | null;
}

export interface ChecklistItem {
  id: string;
  item: string;
  category: string;
  checked: boolean;
}

// ---------------------------------------------------------------------------
// Client + status tracking
// ---------------------------------------------------------------------------

type AuthMode = 'vertex-adc' | 'vertex-express' | 'gemini-api';

let client: GoogleGenAI | null = null;
let authMode: AuthMode | null = null;

// Process-wide (Next.js may load this module once per route bundle).
type AiStatus = { lastOk: string | null; lastError: string | null; lastErrorAt: string | null };
const g = globalThis as typeof globalThis & { __snagwalkAi?: AiStatus };
const status: AiStatus = (g.__snagwalkAi ??= { lastOk: null, lastError: null, lastErrorAt: null });

function resolveAuth(): { mode: AuthMode; client: GoogleGenAI } {
  const forced = (process.env.GEMINI_AUTH || 'auto').toLowerCase();
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';

  if (forced === 'adc' || (forced === 'auto' && !apiKey)) {
    return {
      mode: 'vertex-adc',
      client: new GoogleGenAI({ vertexai: true, project: PROJECT_ID, location: LOCATION }),
    };
  }
  if (apiKey.startsWith('AQ.')) {
    return { mode: 'vertex-express', client: new GoogleGenAI({ vertexai: true, apiKey }) };
  }
  return { mode: 'gemini-api', client: new GoogleGenAI({ apiKey }) };
}

function getClient(): GoogleGenAI {
  if (!client) {
    const resolved = resolveAuth();
    client = resolved.client;
    authMode = resolved.mode;
  }
  return client;
}

export function getAiStatus() {
  getClient();
  return {
    model: MODEL_NAME,
    auth: authMode,
    project: authMode === 'vertex-adc' ? PROJECT_ID : undefined,
    location: authMode === 'vertex-adc' ? LOCATION : undefined,
    lastOk: status.lastOk,
    lastError: status.lastError,
    lastErrorAt: status.lastErrorAt,
  };
}

let globalClient: GoogleGenAI | null = null;

/** Same model on the global endpoint: a separate quota pool, used only when the regional endpoint is saturated. */
function getGlobalClient(): GoogleGenAI | null {
  if (authMode !== 'vertex-adc' || LOCATION === 'global') return null;
  globalClient ??= new GoogleGenAI({ vertexai: true, project: PROJECT_ID, location: 'global' });
  return globalClient;
}

/** Quota and overload errors are worth retrying; bad requests and auth failures are not. */
export function isRetryableAiError(err: unknown): boolean {
  const e = err as { status?: number; code?: number; message?: string } | null;
  const code = e?.status ?? e?.code;
  if (code === 429 || code === 500 || code === 503) return true;
  return /\b(429|503)\b|resource exhausted|unavailable|overloaded|deadline/i.test(String(e?.message ?? err));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function shortError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  // Google errors embed a JSON blob; keep the first sentence readable.
  const match = msg.match(/"message":\s*"([^"]+)/);
  return (match ? match[1] : msg).slice(0, 300);
}

async function generate(opts: {
  prompt: string;
  image?: { data: string; mimeType: string };
  schema?: Schema;
  temperature?: number;
}): Promise<string> {
  // Medium image resolution: enough detail for hairline cracks, far fewer tokens than high.
  const parts: Array<Record<string, unknown>> = [];
  if (opts.image) parts.push({ inlineData: { data: opts.image.data, mimeType: opts.image.mimeType } });
  parts.push({ text: opts.prompt });

  const request = {
    model: MODEL_NAME,
    contents: [{ role: 'user', parts }],
    config: {
      temperature: opts.temperature ?? 0.2,
      ...(THINKING !== 'OFF' ? { thinkingConfig: { thinkingLevel: THINKING as ThinkingLevel } } : {}),
      ...(opts.image ? { mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM } : {}),
      ...(opts.schema ? { responseMimeType: 'application/json', responseSchema: opts.schema } : {}),
    },
  };

  // Up to three attempts on quota or overload errors: regional, regional again after a short backoff, then the
  // global endpoint. Anything else fails fast so the caller can fall back.
  const attempts: Array<{ client: () => GoogleGenAI | null; delay: number }> = [
    { client: getClient, delay: 0 },
    { client: getClient, delay: 700 + Math.random() * 300 },
    { client: getGlobalClient, delay: 1200 + Math.random() * 400 },
  ];
  let lastErr: unknown;
  for (const attempt of attempts) {
    const c = attempt.client();
    if (!c) continue;
    if (attempt.delay) await sleep(attempt.delay);
    try {
      const res = await c.models.generateContent(request);
      const text = res.text;
      if (!text) throw new Error('Gemini returned an empty response');
      status.lastOk = new Date().toISOString();
      return text;
    } catch (err) {
      lastErr = err;
      status.lastError = shortError(err);
      status.lastErrorAt = new Date().toISOString();
      console.warn(`[gemini] ${authMode} call failed: ${status.lastError}`);
      if (!isRetryableAiError(err)) break;
    }
  }
  throw lastErr;
}

export function parseJson<T>(raw: string): T {
  const cleaned = raw.replace(/```json/g, '').replace(/```/g, '').trim();
  return JSON.parse(cleaned) as T;
}

/**
 * Coerce whatever the model returned into the fixed enums and a valid box. Gemini occasionally wraps the
 * object in an array or drifts outside the enum; the UI and the database only ever see valid values.
 */
export function normalizeSnagAnalysis(value: unknown, roomContext: string): SnagAnalysisResult {
  const parsed = (Array.isArray(value) ? value[0] : value) as Partial<SnagAnalysisResult> | undefined;
  const p = parsed && typeof parsed === 'object' ? parsed : {};
  const category = VALID_CATEGORIES.includes(p.category as SnagCategory) ? (p.category as SnagCategory) : 'other';
  const severity = VALID_SEVERITIES.includes(p.severity as SnagSeverity) ? (p.severity as SnagSeverity) : 'minor';
  const b = p.box_2d;
  const box =
    Array.isArray(b) &&
    b.length === 4 &&
    b.every((n) => typeof n === 'number' && n >= 0 && n <= 1000) &&
    b[0] < b[2] &&
    b[1] < b[3]
      ? (b as [number, number, number, number])
      : null;
  return {
    category,
    severity,
    description: String(p.description || 'Observed defect requiring rectification.'),
    location_note: String(p.location_note || roomContext),
    box_2d: box,
  };
}

// ---------------------------------------------------------------------------
// Screen 2: room checklist
// ---------------------------------------------------------------------------

const checklistSchema: Schema = {
  type: Type.ARRAY,
  minItems: '4',
  maxItems: '6',
  items: {
    type: Type.OBJECT,
    properties: {
      item: { type: Type.STRING, description: 'One concrete check, imperative voice, max 16 words' },
      category: { type: Type.STRING, enum: VALID_CATEGORIES },
    },
    required: ['item', 'category'],
    propertyOrdering: ['item', 'category'],
  },
};

export async function generateRoomChecklist(
  roomName: string,
  context?: { bhk?: string; project?: string }
): Promise<AiResult<ChecklistItem[]>> {
  const prompt = `You are a possession-day snagging engineer inspecting a newly built Indian apartment${
    context?.bhk ? ` (${context.bhk})` : ''
  }.
Write a 4 to 6 item checklist for the room "${roomName}".
Use the methods professional Indian possession inspectors use:
${INSPECTION_METHODS.map((m) => `- ${m}`).join('\n')}
Pick the checks that matter most for this room type and the defects buyers commonly miss before handover.
Each item must be a specific physical check the buyer can do in under a minute with their phone, a coin, water or
a charger, and should name the method (for example "Coin tap...", "Pour a bucket...").`;

  try {
    const raw = await generate({ prompt, schema: checklistSchema, temperature: 0.4 });
    const parsed = parseJson<Array<{ item: string; category: string }>>(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return {
        source: 'gemini',
        data: parsed.slice(0, 6).map((it, idx) => ({
          id: String(idx + 1),
          item: String(it.item),
          category: VALID_CATEGORIES.includes(it.category as SnagCategory) ? it.category : 'other',
          checked: false,
        })),
      };
    }
  } catch {
    // fall through to the offline checklist
  }
  return { source: 'fallback', data: getDefaultChecklist(roomName) };
}

export function getDefaultChecklist(roomName: string): ChecklistItem[] {
  return ROOM_PRACTICE[practiceKeyFor(roomName)].map(([item, category], i) => ({
    id: String(i + 1),
    item,
    category,
    checked: false,
  }));
}

// ---------------------------------------------------------------------------
// Screen 3: snag photo analysis
// ---------------------------------------------------------------------------

const snagSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    category: { type: Type.STRING, enum: VALID_CATEGORIES },
    severity: { type: Type.STRING, enum: VALID_SEVERITIES },
    description: { type: Type.STRING, description: 'Clear technical description of the defect, 1-2 sentences' },
    location_note: { type: Type.STRING, description: 'Where in the room / on the element the defect is' },
    box_2d: {
      type: Type.ARRAY,
      nullable: true,
      description: 'Bounding box of the main defect as [ymin, xmin, ymax, xmax] normalised 0-1000, or null',
      items: { type: Type.INTEGER },
    },
  },
  required: ['category', 'severity', 'description', 'location_note'],
  propertyOrdering: ['category', 'severity', 'description', 'location_note', 'box_2d'],
};

export async function analyzeSnagPhoto(
  imageBuffer: Buffer,
  mimeType: string,
  roomContext: string,
  inspectorNote?: string
): Promise<AiResult<SnagAnalysisResult>> {
  // A note from the live inspector (Gemini Live) focuses the analysis on the defect it just saw. It is a hint
  // about where to look, never a source of facts: the photo decides category, severity and description.
  const note = inspectorNote?.replace(/[\r\n"`]+/g, ' ').trim().slice(0, 200);
  const prompt = `You are a civil engineer doing a possession-day snag inspection of an Indian apartment, room: "${roomContext}".
Identify the single most important construction, finishing or MEP defect visible in this photo.

Rules:
1. category must be one of: ${VALID_CATEGORIES.join(', ')}.
2. severity must be one of: minor, major, critical.
   - critical: water seepage, exposed or sparking wiring, structural or glass crack, sewage/commode leak.
   - major: chipped or hollow tile, broken latch, slope causing water pooling, unpainted patch, door jamming.
   - minor: hairline paint scratch, dirty grout, smudges, small finish blemish.
3. If there is no visible defect, return category "other", severity "minor", and say so in description.
4. location_note: concise position, e.g. "Bottom left corner near skirting".
5. box_2d: bounding box of the defect, [ymin, xmin, ymax, xmax] scaled 0-1000. null if no defect.${
    note ? `\n6. The inspector on site pointed at: "${note}". Focus on that defect if the photo shows it.` : ''
  }`;

  try {
    const raw = await generate({
      prompt,
      image: { data: imageBuffer.toString('base64'), mimeType: mimeType || 'image/jpeg' },
      schema: snagSchema,
    });
    return { source: 'gemini', data: normalizeSnagAnalysis(parseJson<unknown>(raw), roomContext) };
  } catch {
    return {
      source: 'fallback',
      data: {
        category: 'other',
        severity: 'minor',
        description: 'AI analysis unavailable. Describe the defect and pick a category before saving.',
        location_note: '',
        box_2d: null,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Screen 4: builder snag letter
// ---------------------------------------------------------------------------

export interface LetterWalk {
  buyer_name: string;
  builder: string;
  project: string;
  tower: string;
  flat_number: string;
  bhk: string;
  possession_date: string;
}

export interface LetterRoomGroup {
  room_name: string;
  snags: Array<{
    photo_number: number;
    category: string;
    severity: string;
    description: string;
    location_note: string | null;
  }>;
}

function formatDate(value: string | Date): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * Statutory reference added to every letter. RERA Section 14(3) makes the promoter rectify defects in workmanship,
 * quality or services reported within five years of possession, at no charge. It is a fixed legal fact, not an
 * inference about the flat, so it does not break the "never invent facts" guardrail.
 */
export const RERA_CLAUSE =
  'This notice is without prejudice to my rights under Section 14(3) of the Real Estate (Regulation and Development) Act, 2016, under which the promoter must rectify defects in workmanship, quality or services at no additional cost.';

const LANGUAGE_RULE: Record<LetterLanguage, string> = {
  en: 'Write the letter in English (Indian formal register).',
  hi: 'Write the entire letter in formal Hindi (Devanagari script). Keep names, the project, tower and flat number exactly as given, and keep every "**[Photo #N]**" tag unchanged.',
  mr: 'Write the entire letter in formal Marathi (Devanagari script). Keep names, the project, tower and flat number exactly as given, and keep every "**[Photo #N]**" tag unchanged.',
};

export async function generateSnagLetter(
  walk: LetterWalk,
  snagsByRoom: LetterRoomGroup[],
  language: LetterLanguage = 'en'
): Promise<AiResult<string>> {
  const today = formatDate(new Date());
  const rooms = snagsByRoom.filter((r) => r.snags.length > 0);
  const total = rooms.reduce((n, r) => n + r.snags.length, 0);

  const prompt = `Draft a formal pre-possession snag notice from a home buyer to their builder in India.

Buyer: ${walk.buyer_name}
Builder: ${walk.builder}
Project: ${walk.project}
Unit: Flat ${walk.flat_number}, ${walk.tower} (${walk.bhk})
Possession / inspection date: ${formatDate(walk.possession_date)}
Date of letter: ${today}

Recorded defects (the ONLY defects that exist; ${total} in total):
${JSON.stringify(rooms, null, 2)}

Rules (mandatory):
1. Formal, polite and firm tone, addressed to ${walk.builder}.
2. Group defects by room using a "### Room name" heading per room. Under each, one bullet per defect:
   "**[Photo #N]** Severity: <that defect's recorded severity in capitals>. Description. Location: ..."
   Use each defect's severity exactly as recorded; never raise or lower it.
3. Request rectification of all items within 15 days of receipt, and written confirmation of completion
   and a joint re-inspection before final handover and registration.
4. Never invent, merge, or omit defects. Every photo number above appears exactly once. Do not add rooms that have no defects.
   Do not invent any other facts either: no addresses, cities, agreement numbers or dates beyond those given above.
5. Structure: date and addresses, a bold subject line, short opening paragraph, the room-by-room list,
   the 15-day request, closing, and a signature block with the buyer's name.
6. Right after the 15-day request, include this statutory sentence (translated faithfully if the letter is not in English):
   "${RERA_CLAUSE}"
7. ${LANGUAGE_RULE[language]}
8. Output clean Markdown only. No code fences, no preamble, no notes to the user. Do not use em dashes.`;

  try {
    const letter = await generate({ prompt, temperature: 0.3 });
    const clean = letter.replace(/^```(markdown)?/i, '').replace(/```$/, '').trim();
    return { source: 'gemini', data: enforceRecordedSeverity(clean, rooms) };
  } catch {
    return { source: 'fallback', data: templateLetter(walk, rooms, today) };
  }
}

/**
 * The letter must state each defect's severity exactly as recorded. Gemini occasionally restates it (for example
 * "MAJOR" for a critical snag), so English severity labels after each photo tag are rewritten from the data.
 */
export function enforceRecordedSeverity(letter: string, rooms: LetterRoomGroup[]): string {
  const bySnag = new Map<number, string>();
  for (const room of rooms) for (const s of room.snags) bySnag.set(s.photo_number, s.severity.toUpperCase());
  return letter.replace(
    /(\*\*\[Photo #(\d+)\]\*\*[^\n]*?Severity:\s*)(minor|major|critical)\b/gi,
    (match, prefix: string, num: string) => {
      const recorded = bySnag.get(Number(num));
      return recorded ? `${prefix}${recorded}` : match;
    }
  );
}

/** Deterministic English letter used when Gemini is unavailable. Lists only the recorded snags. */
export function templateLetter(walk: LetterWalk, rooms: LetterRoomGroup[], today: string): string {
  const list =
    rooms.length === 0
      ? '_No defects were recorded during this inspection._'
      : rooms
          .map((room) => {
            const lines = room.snags.map((s) => {
              const loc = s.location_note ? ` Location: ${s.location_note}.` : '';
              return `- **[Photo #${s.photo_number}]** Severity: ${s.severity.toUpperCase()}. ${s.description}${loc}`;
            });
            return `### ${room.room_name}\n${lines.join('\n')}`;
          })
          .join('\n\n');

  return `${today}

**To**
The Project Head, ${walk.builder}
${walk.project}

**From**
${walk.buyer_name}
Flat ${walk.flat_number}, ${walk.tower} (${walk.bhk})

**Subject: Pre-possession inspection of Flat ${walk.flat_number}, ${walk.tower}: request to rectify defects**

Dear Sir or Madam,

I inspected Flat ${walk.flat_number}, ${walk.tower} at ${walk.project} on ${formatDate(walk.possession_date)}. The defects listed below were observed and must be rectified before I take possession. Each item references the photograph attached in the annexure.

${list}

I request that all the above items be rectified within **15 days** of receipt of this letter. Please confirm completion in writing and propose a date for a joint re-inspection before final handover and registration.

${RERA_CLAUSE}

Thank you for your cooperation.

Yours faithfully,

**${walk.buyer_name}**
Flat ${walk.flat_number}, ${walk.tower}, ${walk.project}`;
}
