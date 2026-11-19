import { GoogleGenAI, Type, type Schema } from '@google/genai';

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
const LOCATION = process.env.VERTEX_AI_LOCATION || 'us-central1';
export const MODEL_NAME = process.env.GEMINI_MODEL || process.env.VERTEX_AI_MODEL || 'gemini-2.5-flash';

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

const status: { lastOk: string | null; lastError: string | null; lastErrorAt: string | null } = {
  lastOk: null,
  lastError: null,
  lastErrorAt: null,
};

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
  const parts: Array<Record<string, unknown>> = [];
  if (opts.image) parts.push({ inlineData: { data: opts.image.data, mimeType: opts.image.mimeType } });
  parts.push({ text: opts.prompt });

  try {
    const res = await getClient().models.generateContent({
      model: MODEL_NAME,
      contents: [{ role: 'user', parts }],
      config: {
        temperature: opts.temperature ?? 0.2,
        ...(opts.schema ? { responseMimeType: 'application/json', responseSchema: opts.schema } : {}),
      },
    });
    const text = res.text;
    if (!text) throw new Error('Gemini returned an empty response');
    status.lastOk = new Date().toISOString();
    return text;
  } catch (err) {
    status.lastError = shortError(err);
    status.lastErrorAt = new Date().toISOString();
    console.warn(`[gemini] ${authMode} call failed: ${status.lastError}`);
    throw err;
  }
}

function parseJson<T>(raw: string): T {
  const cleaned = raw.replace(/```json/g, '').replace(/```/g, '').trim();
  return JSON.parse(cleaned) as T;
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
Prioritise defects buyers commonly miss and builders must fix before handover: hollow tiles, tile slope to drain,
dampness, paint finish, socket earthing, window locks and tracks, door alignment, plumbing leaks.
Each item must be a specific physical check the buyer can do in under a minute with their phone and hands.`;

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

function getDefaultChecklist(roomName: string): ChecklistItem[] {
  const lower = roomName.toLowerCase();
  const make = (items: Array<[string, string]>) =>
    items.map(([item, category], i) => ({ id: String(i + 1), item, category, checked: false }));

  if (lower.includes('kitchen')) {
    return make([
      ['Check granite countertop edges, joints and sink silicone sealing', 'woodwork'],
      ['Run the sink tap and check the drain trap for leaks', 'plumbing'],
      ['Test chimney and appliance sockets with a phone charger', 'electrical'],
      ['Tap dado tiles for hollow sound and look for missing grout', 'tiles'],
    ]);
  }
  if (lower.includes('bath') || lower.includes('toilet')) {
    return make([
      ['Pour water on the floor and confirm it flows to the drain', 'tiles'],
      ['Check taps, health faucet and angle valves for drips', 'plumbing'],
      ['Flush twice and check the commode base for seepage', 'plumbing'],
      ['Test geyser and mirror light points', 'electrical'],
    ]);
  }
  if (lower.includes('balcony') || lower.includes('utility')) {
    return make([
      ['Check railing height, weld joints and rust spots', 'doors_windows'],
      ['Pour water and confirm it drains without pooling', 'flooring'],
      ['Inspect exterior paint for cracks, peeling or seepage', 'wall_paint'],
      ['Test the outdoor socket and washing machine tap point', 'electrical'],
    ]);
  }
  if (lower.includes('entrance') || lower.includes('passage')) {
    return make([
      ['Open and close the main door fully; check it does not scrape', 'doors_windows'],
      ['Test the lock, latch, peephole and door stopper', 'doors_windows'],
      ['Check the door frame and architrave for gaps and cracks', 'woodwork'],
      ['Test the doorbell and passage lights', 'electrical'],
    ]);
  }
  return make([
    ['Shine a phone torch along walls to spot patches and waviness', 'wall_paint'],
    ['Slide every window; check locks, tracks and glass sealant', 'doors_windows'],
    ['Tap floor tiles with a coin to find hollow spots', 'flooring'],
    ['Check door latch, lock and frame alignment', 'doors_windows'],
    ['Test every switch and socket, including AC points', 'electrical'],
  ]);
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
  roomContext: string
): Promise<AiResult<SnagAnalysisResult>> {
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
5. box_2d: bounding box of the defect, [ymin, xmin, ymax, xmax] scaled 0-1000. null if no defect.`;

  try {
    const raw = await generate({
      prompt,
      image: { data: imageBuffer.toString('base64'), mimeType: mimeType || 'image/jpeg' },
      schema: snagSchema,
    });
    const parsed = parseJson<Partial<SnagAnalysisResult>>(raw);
    const category = VALID_CATEGORIES.includes(parsed.category as SnagCategory)
      ? (parsed.category as SnagCategory)
      : 'other';
    const severity = VALID_SEVERITIES.includes(parsed.severity as SnagSeverity)
      ? (parsed.severity as SnagSeverity)
      : 'minor';
    const box =
      Array.isArray(parsed.box_2d) &&
      parsed.box_2d.length === 4 &&
      parsed.box_2d.every((n) => typeof n === 'number' && n >= 0 && n <= 1000)
        ? (parsed.box_2d as [number, number, number, number])
        : null;

    return {
      source: 'gemini',
      data: {
        category,
        severity,
        description: String(parsed.description || 'Observed defect requiring rectification.'),
        location_note: String(parsed.location_note || roomContext),
        box_2d: box,
      },
    };
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

export async function generateSnagLetter(
  walk: LetterWalk,
  snagsByRoom: LetterRoomGroup[]
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
   "**[Photo #N]** Severity: MAJOR. Description. Location: ..."
3. Request rectification of all items within 15 days of receipt, and written confirmation of completion
   and a joint re-inspection before final handover and registration.
4. Never invent, merge, or omit defects. Every photo number above appears exactly once. Do not add rooms that have no defects.
5. Structure: date and addresses, a bold subject line, short opening paragraph, the room-by-room list,
   the 15-day request, closing, and a signature block with the buyer's name.
6. Output clean Markdown only. No code fences, no preamble, no notes to the user. Do not use em dashes.`;

  try {
    const letter = await generate({ prompt, temperature: 0.3 });
    return { source: 'gemini', data: letter.replace(/^```(markdown)?/i, '').replace(/```$/, '').trim() };
  } catch {
    return { source: 'fallback', data: templateLetter(walk, rooms, today) };
  }
}

function templateLetter(walk: LetterWalk, rooms: LetterRoomGroup[], today: string): string {
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

Thank you for your cooperation.

Yours faithfully,

**${walk.buyer_name}**
Flat ${walk.flat_number}, ${walk.tower}, ${walk.project}`;
}
