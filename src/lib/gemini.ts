import { VertexAI } from '@google-cloud/vertexai';

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'snagwalk-515212';
const LOCATION = process.env.VERTEX_AI_LOCATION || 'us-central1';
// Latest Flash model on Vertex AI
const MODEL_NAME = process.env.VERTEX_AI_MODEL || 'gemini-1.5-flash';

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

export interface SnagAnalysisResult {
  category: SnagCategory;
  severity: SnagSeverity;
  description: string;
  location_note: string;
}

export interface ChecklistItem {
  id: string;
  item: string;
  category: string;
  checked: boolean;
}

const VALID_CATEGORIES: SnagCategory[] = [
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

const VALID_SEVERITIES: SnagSeverity[] = ['minor', 'major', 'critical'];

/**
 * Helper to call Vertex AI or fallback to direct Gemini API with key
 */
async function callGemini(
  prompt: string,
  imagePart?: { inlineData: { data: string; mimeType: string } },
  responseSchema?: any
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.STITCH_GOOGLE_API_KEY;

  // Try Vertex AI first (standard production method on Cloud Run / GCP)
  try {
    const vertexAI = new VertexAI({ project: PROJECT_ID, location: LOCATION });
    const generativeModel = vertexAI.getGenerativeModel({
      model: MODEL_NAME,
      generationConfig: {
        temperature: 0.2,
        responseMimeType: responseSchema ? 'application/json' : undefined,
      },
    });

    const parts: any[] = [{ text: prompt }];
    if (imagePart) {
      parts.push({
        inlineData: {
          mimeType: imagePart.inlineData.mimeType,
          data: imagePart.inlineData.data,
        },
      });
    }

    const response = await generativeModel.generateContent({
      contents: [{ role: 'user', parts }],
    });

    const text = response.response.candidates?.[0]?.content?.parts?.[0]?.text;
    if (text) {
      return text;
    }
  } catch (vertexErr: any) {
    console.warn(`Vertex AI call failed (${vertexErr.message}). Attempting API Key fallback.`);
  }

  // Fallback: Gemini API via REST if API key is present
  if (apiKey) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
      const parts: any[] = [{ text: prompt }];
      if (imagePart) {
        parts.push({
          inlineData: {
            mimeType: imagePart.inlineData.mimeType,
            data: imagePart.inlineData.data,
          },
        });
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            temperature: 0.2,
          },
        }),
      });

      if (res.ok) {
        const json = await res.json();
        const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) return text;
      } else {
        const errText = await res.text();
        console.warn('Direct Gemini API returned error:', errText);
      }
    } catch (apiKeyErr: any) {
      console.warn('Direct Gemini API fallback failed:', apiKeyErr.message);
    }
  }

  throw new Error('Unable to contact Gemini on Vertex AI or fallback API.');
}

/**
 * Screen 2: Generate short checklist for room possession walk
 */
export async function generateRoomChecklist(
  roomName: string,
  roomType: string,
  context?: { bhk?: string; project?: string }
): Promise<ChecklistItem[]> {
  const prompt = `You are an expert real estate possession engineer inspecting a newly constructed Indian apartment during key handover.
Generate a concise, high-priority possession-day snag checklist for the room: "${roomName}" (${roomType || roomName}).
Focus on critical and common builder defects (paint patches, hollow tiles, pipe leaks, socket earthing, window latches, slope towards water drain).
Return a strict JSON array of 4 to 6 items.
Format:
[
  { "id": "1", "item": "Inspect wall paint for uneven patches, roller marks, or dampness", "category": "wall_paint", "checked": false },
  ...
]
Only return valid JSON array. Do not include markdown codeblocks or extra text.`;

  try {
    const raw = await callGemini(prompt);
    const cleaned = raw.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.map((item, idx) => ({
        id: String(item.id || idx + 1),
        item: String(item.item || item),
        category: String(item.category || 'other'),
        checked: false,
      }));
    }
  } catch (err: any) {
    console.warn(`Gemini checklist generation failed for ${roomName}:`, err.message);
  }

  // Default checklist fallback based on room type if offline
  return getDefaultChecklist(roomName);
}

function getDefaultChecklist(roomName: string): ChecklistItem[] {
  const lower = roomName.toLowerCase();
  if (lower.includes('kitchen')) {
    return [
      { id: '1', item: 'Check granite countertop edges, joints, and sink silicon sealing', category: 'woodwork', checked: false },
      { id: '2', item: 'Test water flow in sink tap and check drain bottle trap for leaks', category: 'plumbing', checked: false },
      { id: '3', item: 'Verify chimney / exhaust point electrical socket and switch function', category: 'electrical', checked: false },
      { id: '4', item: 'Inspect wall dado tiles for cracks, hollowness, or missing grout', category: 'tiles', checked: false },
    ];
  } else if (lower.includes('bath')) {
    return [
      { id: '1', item: 'Check floor tile slope towards water drain (no water pooling)', category: 'tiles', checked: false },
      { id: '2', item: 'Inspect CPVC/Chrome fittings, health faucet, and angle valves for dripping', category: 'plumbing', checked: false },
      { id: '3', item: 'Test flush valve / cistern pressure and check commode base sealing', category: 'plumbing', checked: false },
      { id: '4', item: 'Check geyser electrical points and mirror light switch operation', category: 'electrical', checked: false },
    ];
  } else if (lower.includes('balcony')) {
    return [
      { id: '1', item: 'Inspect MS/Glass railing height (minimum 1.2m), weld strength, and rust spots', category: 'doors_windows', checked: false },
      { id: '2', item: 'Test rainwater drainage slope and check drain cover grating', category: 'flooring', checked: false },
      { id: '3', item: 'Inspect exterior weather-coat paint for cracks, peeling, or seepage', category: 'wall_paint', checked: false },
      { id: '4', item: 'Check weatherproof electrical socket and washing machine tap point', category: 'electrical', checked: false },
    ];
  } else {
    return [
      { id: '1', item: 'Check walls and ceiling under good light for waviness, patches, or paint drips', category: 'wall_paint', checked: false },
      { id: '2', item: 'Test UPVC/Aluminium sliding window lock, track smoothness, and glass sealant', category: 'doors_windows', checked: false },
      { id: '3', item: 'Tap vitrified floor tiles with coin/mallet to test for hollow sound', category: 'flooring', checked: false },
      { id: '4', item: 'Test door latch, lock cylinders, stopper, and wooden frame alignment', category: 'doors_windows', checked: false },
      { id: '5', item: 'Inspect switchboards, earthing, and AC power socket wiring', category: 'electrical', checked: false },
    ];
  }
}

/**
 * Screen 3: Snag photo analysis using Gemini latest Flash model on Vertex AI.
 * Strict Guardrails:
 * 1. Photo analysis returns strict JSON: category, severity, description, location_note.
 * 2. category is one of: wall_paint, tiles, plumbing, electrical, doors_windows, woodwork, ceiling, flooring, other.
 * 3. severity is one of: minor, major, critical.
 * 4. If the photo shows no visible defect, return category "other" and say so in description.
 */
export async function analyzeSnagPhoto(
  imageBuffer: Buffer,
  mimeType: string,
  roomContext: string
): Promise<SnagAnalysisResult> {
  const base64Data = imageBuffer.toString('base64');

  const prompt = `You are a forensic civil engineer inspecting flat possession snag defects for an Indian residential apartment in "${roomContext}".
Examine this photo carefully and analyze any construction, civil, MEP, or architectural defect.

CRITICAL RULES (MUST ADHERE STRICTLY):
1. Return STRICT JSON with exact keys: "category", "severity", "description", "location_note".
2. "category" MUST be exactly one of: "wall_paint", "tiles", "plumbing", "electrical", "doors_windows", "woodwork", "ceiling", "flooring", "other".
3. "severity" MUST be exactly one of: "minor", "major", "critical".
   - "critical": water seepage, electrical short/exposed wire, severe structural/glass crack, commode leak.
   - "major": chipped tile, broken latch, improper slope causing pooling, unpainted patch, door jamming.
   - "minor": paint hairline scratches, dirty grout line, minor switchboard smudge, slight finish blemish.
4. If the photo shows no visible defect, return category "other" and say so in description (e.g., "No visible defect detected in inspected area").
5. "location_note": provide a concise note identifying where the issue is situated (e.g., "Bottom corner near skirting", "Under washbasin pipe joint", "Window sill frame edge").

JSON SCHEMA:
{
  "category": "wall_paint" | "tiles" | "plumbing" | "electrical" | "doors_windows" | "woodwork" | "ceiling" | "flooring" | "other",
  "severity": "minor" | "major" | "critical",
  "description": "Clear and technical description of defect",
  "location_note": "Specific location in room"
}

Output ONLY the raw JSON string without markdown or backticks.`;

  try {
    const raw = await callGemini(prompt, {
      inlineData: {
        data: base64Data,
        mimeType: mimeType || 'image/jpeg',
      },
    });

    const cleaned = raw.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);

    let category = parsed.category;
    if (!VALID_CATEGORIES.includes(category)) {
      category = 'other';
    }

    let severity = parsed.severity;
    if (!VALID_SEVERITIES.includes(severity)) {
      severity = 'minor';
    }

    return {
      category: category as SnagCategory,
      severity: severity as SnagSeverity,
      description: String(parsed.description || 'Observed defect requiring rectification.'),
      location_note: String(parsed.location_note || roomContext),
    };
  } catch (err: any) {
    console.warn('Gemini vision analysis failed, returning compliant fallback:', err.message);
    return {
      category: 'other',
      severity: 'minor',
      description: 'Defect identified during visual room inspection. Please verify category and details.',
      location_note: roomContext,
    };
  }
}

/**
 * Screen 4: Gemini generates the builder snag letter from snags table.
 * Strict Snag Letter Guardrails:
 * 1. Formal, polite, firm tone, addressed to the builder.
 * 2. Group snags by room, list severity, reference the photo number.
 * 3. Request a fix timeline of 15 days and ask for written confirmation.
 * 4. Never invent defects that are not in the snags table.
 */
export async function generateSnagLetter(
  walk: {
    buyer_name: string;
    builder: string;
    project: string;
    tower: string;
    flat_number: string;
    bhk: string;
    possession_date: string;
  },
  snagsByRoom: Array<{
    room_name: string;
    snags: Array<{
      photo_number: number;
      category: string;
      severity: string;
      description: string;
      location_note: string | null;
      photo_url: string;
    }>;
  }>
): Promise<string> {
  const currentDate = new Date().toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const formattedSnagData = JSON.stringify(snagsByRoom, null, 2);

  const prompt = `You are a legal and civil engineering consultant drafting an official pre-possession snagging notice to a real estate developer.

BUYER DETAILS:
Buyer Name: ${walk.buyer_name}
Builder / Developer: ${walk.builder}
Project Name: ${walk.project}
Tower / Wing: ${walk.tower}
Flat Number: ${walk.flat_number}
Apartment Type: ${walk.bhk}
Scheduled Possession Date: ${walk.possession_date}
Date of Notice: ${currentDate}

OFFICIAL SNAG DATABASE RECORDS:
${formattedSnagData}

STRICT SNAG LETTER RULES (MANDATORY):
1. Tone: Formal, polite, and firm tone, addressed to the builder (${walk.builder}).
2. Group snags by room, list severity for each defect, and reference the corresponding photo number (e.g., "[Photo #1]").
3. Explicitly request a fix timeline of exactly 15 days and ask for written confirmation of rectification prior to final handover / registration.
4. CRITICAL RULE: NEVER invent defects that are not in the snags table. Ground every single defect strictly in the provided records. If there are no snags recorded for a room, do not fabricate any.
5. Provide a well-structured letter with formal letterhead, subject line, reference to agreement, room-by-room breakdown table/bullets, closure, and buyer signature placeholder.

Format output in clean, professional Markdown.`;

  try {
    const letter = await callGemini(prompt);
    return letter.trim();
  } catch (err: any) {
    console.warn('Gemini snag letter generation fallback:', err.message);
    return generateLocalFallbackLetter(walk, snagsByRoom, currentDate);
  }
}

function generateLocalFallbackLetter(
  walk: any,
  snagsByRoom: any[],
  currentDate: string
): string {
  let snagsText = '';

  if (snagsByRoom.length === 0 || snagsByRoom.every((r) => r.snags.length === 0)) {
    snagsText = '_No defects were logged during this inspection._';
  } else {
    for (const roomGroup of snagsByRoom) {
      if (!roomGroup.snags || roomGroup.snags.length === 0) continue;
      snagsText += `### ${roomGroup.room_name}\n`;
      for (const s of roomGroup.snags) {
        snagsText += `- **Photo #${s.photo_number}** | **Severity:** [${s.severity.toUpperCase()}] | **Category:** ${s.category}\n`;
        snagsText += `  - **Defect:** ${s.description}\n`;
        if (s.location_note) {
          snagsText += `  - **Location:** ${s.location_note}\n`;
        }
      }
      snagsText += '\n';
    }
  }

  return `**Date:** ${currentDate}

**To:**  
The Management & Project Execution Team  
**${walk.builder}**  
Project: **${walk.project}**

**From:**  
**${walk.buyer_name}**  
Unit: Flat No. **${walk.flat_number}**, Tower **${walk.tower}** (${walk.bhk})  
Proposed Possession Date: ${walk.possession_date}

---

### **SUBJECT: Official Pre-Possession Inspection Snag List & Rectification Notice**

Dear Sir/Madam,

I am writing regarding the joint pre-possession flat inspection conducted for Flat No. **${walk.flat_number}**, Tower **${walk.tower}** at **${walk.project}**.

While looking forward to taking handover of the unit, our detailed walk-through inspection identified several civil, finishing, and MEP issues that require immediate rectification prior to final handover and execution of the possession protocol.

The itemized defect list, grouped by room along with severity classifications and referenced photographic evidence, is detailed below:

${snagsText}

### **Rectification Timeline & Confirmation Request**

In accordance with good industry standards and our agreement terms, I formally request that all items listed above be rectified completely within **15 days** from the receipt of this notice.

Kindly provide a **written confirmation** along with the schedule of rectification work and confirm a mutual re-inspection date once the snags are resolved.

Thank you for your prompt cooperation in ensuring quality standards for our home.

Yours faithfully,

**${walk.buyer_name}**  
Allottee / Home Buyer  
Flat No. ${walk.flat_number}, Tower ${walk.tower}, ${walk.project}`;
}
