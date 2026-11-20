---
name: snagwalk-guardrails
description: Enforce data, Gemini output, and letter rules when building the SnagWalk app (possession-day flat inspection and builder snag letter). Use when writing data access, API routes, Gemini prompts, or the snag letter.
---
# Data rules
1. snake_case for all collection and field names.
2. Every document id is a uuid; route params are uuid-validated before any read.
3. All reads and writes go through the typed data layer in `src/lib/store.ts`. Never build queries from raw user input.
4. Never bulk-delete or drop collections. The store exposes single-document deletes only.
5. Photos live in Cloud Storage bucket gs://snagwalk-photos-515212. Store only the URL in the database.

# Gemini rules
1. Photo analysis returns strict JSON: category, severity, description, location_note.
2. category is one of: wall_paint, tiles, plumbing, electrical, doors_windows, woodwork, ceiling, flooring, other.
3. severity is one of: minor, major, critical.
4. If the photo shows no visible defect, return category "other" and say so in description.
5. Model output is never trusted as-is: `normalizeSnagAnalysis` forces values back into the enums and drops invalid boxes.

# Snag letter rules
1. Formal, polite, firm tone, addressed to the builder.
2. Group snags by room, list severity, reference the photo number.
3. Request a fix timeline of 15 days and ask for written confirmation.
4. Never invent defects that are not in the snags collection, and no facts beyond those given (addresses, agreement numbers).
5. The one fixed legal sentence allowed is the RERA Section 14(3) "without prejudice" clause (`RERA_CLAUSE` in `src/lib/gemini.ts`).
6. Language: English, Hindi or Marathi. Keep names, flat details and every **[Photo #N]** tag unchanged when translating.
7. The fallback template (Gemini unavailable) is English only and the UI says so.

# UI rules
Mobile-first. One primary action per screen. Large tap targets, since users are standing in the flat.