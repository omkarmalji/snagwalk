# SnagWalk

**Find the defects before you sign.** An AI inspector for first-time home buyers in India.

On possession day a buyer gets minutes to check a flat the builder has had years to finish. SnagWalk walks the
flat with them room by room: Gemini writes a checklist for each room, classifies every defect from a photo,
and drafts the formal snag letter the builder must answer, in English, Hindi or Marathi.

**Live:** https://snagwalk-app.web.app (mobile first; works on any phone browser, no install).
**No flat handy?** Tap "Watch it work" on the home page (`/demo`): the app runs a full inspection by itself with real
Gemini calls on real defect photos, in about 35 seconds, and leaves you a saved walk to explore.

Built on Gemini 3.5 Flash and Gemini Live (Vertex AI), Firestore, Cloud Storage, Cloud Run, Firebase Hosting and Cloud Build.
Architecture, request flows and design decisions: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## The problem

- Buyers inspect a new flat once, in a hurry, with no checklist and no evidence trail.
- Defects found after the possession letter is signed turn into months of follow-up.
- Under RERA Section 14(3) the builder must fix workmanship and quality defects reported within five years of
  possession, but only a written, specific, dated complaint gets acted on.
- Professional snag inspectors cost thousands of rupees per flat and are not available on short notice.

## The product

| Step | Route | What Gemini does |
| --- | --- | --- |
| Start a walk | `/` | Rooms are provisioned from the BHK (bedrooms, bathrooms, balcony, utility). |
| Rooms | `/walks/[walkId]` | Writes a 4-6 item checklist per room, grounded in the methods Indian possession inspectors use (coin tap for hollow tiles, bucket test for drain slope, charger test for every socket, ELCB trip): [docs/INSPECTION_PRACTICE.md](docs/INSPECTION_PRACTICE.md). |
| Live inspector | `/walks/[walkId]/rooms/[roomId]/live` | **Gemini Live** watches the camera (1 frame/s), listens, talks the buyer through the room in English, Hindi or Marathi, and calls a `log_snag` tool when it sees a defect. A sharp frame is then saved through the normal snag route. |
| Snag capture | `/walks/[walkId]/rooms/[roomId]/snag` | Reads the photo and returns category, severity, description, location and a bounding box drawn on the photo. The buyer corrects or discards it. |
| Builder letter | `/walks/[walkId]/letter` | Drafts the formal notice from the recorded snags only: grouped by room, photo references, 15-day deadline, written confirmation, RERA 14(3) clause. English, Hindi or Marathi. PDF with photo annexure, WhatsApp share, copy. |

The letter stores a fingerprint of the snags it was written from. Add, edit or delete a snag and the letter is
marked stale and regenerated, so it never cites a defect that does not exist.

## Google AI and Google Cloud

| Product | How SnagWalk uses it |
| --- | --- |
| **Gemini 3.5 Flash on Vertex AI** | Three distinct tasks through `@google/genai`: vision defect classification with bounding boxes, room checklist generation, and multilingual legal-style letter drafting. Structured JSON output with enum-constrained `responseSchema`, low thinking level and medium media resolution (~4.6 s per photo from `asia-south1`). |
| **Gemini Live (`gemini-3.8-live`, Vertex AI)** | Real-time voice + video inspector with function calling. Runs in a separate Cloud Run WebSocket relay (`live/`), because Next.js routes and Firebase Hosting cannot hold WebSockets. Origin-checked, 5-minute session cap, about $0.15-0.50 per session. |
| **Firestore (Native mode)** | Walks, rooms and snags. Serverless, inside the free tier at this scale, IAM auth through the Cloud Run service account (no passwords), atomic batch write for a walk and its rooms. |
| **Cloud Storage** | Private photo bucket, served through a same-origin proxy (also keeps the PDF canvas untainted). |
| **Cloud Run** | Stateless Next.js standalone service, scales to zero, dedicated least-privilege service account. |
| **Cloud Build + Artifact Registry** | Multi-stage Docker build and image registry. |
| **Firebase Hosting** | Public URL and CDN in front of Cloud Run. |
| **Agent Skills** | `.agents/skills/snagwalk-guardrails/SKILL.md`: database, Gemini and letter rules shared by the coding agent and enforced in code. |

Every AI result carries `source: 'gemini' | 'fallback'` and the UI labels fallbacks honestly. Quota and overload
errors (429/503) are retried with backoff, then once on the `global` endpoint (a separate quota pool).
`GET /api/health` reports which model, auth mode, database and storage are live; the header shows it.

**Cost:** a real two-room inspection made 6 Gemini calls for about $0.05. A full 3 BHK walk is roughly
$0.25 (about ₹20) of AI cost.

## Engineering

- TypeScript strict, Next.js 15 App Router, React 19, Tailwind design tokens (light and dark, WCAG AA contrast).
- 144 unit tests (Vitest) for the logic that must not break: PDF page breaks, Gemini output normalisation,
  fallback letter invariants (every photo cited exactly once, 15 days, RERA clause), letter fingerprints,
  the data layer contract and photo numbering, room provisioning, and WCAG AA contrast of every design token
  in both themes (design system: [docs/DESIGN.md](docs/DESIGN.md)).
- 19-check end-to-end smoke test against a running server with real Gemini, Firestore and Cloud Storage.
- CI on every push: typecheck, lint, unit tests, build (`.github/workflows/ci.yml`).
- Accessibility: labelled controls, focus moves to the review form after analysis, one concise screen-reader
  announcement per phase, skip link, reduced-motion support, large tap targets for one-handed use.

## Running locally

```bash
pnpm install
gcloud auth application-default login     # Gemini, Firestore and Cloud Storage via ADC
cp .env.example .env.local                # DATA_STORE=firestore, or local for a JSON file
pnpm dev
```

Your account needs `roles/aiplatform.user`, `roles/datastore.user` and access to the bucket. With
`DATA_STORE=local` the app runs on a JSON file with no credentials (Gemini then falls back to labelled
templates). Production always uses Firestore and Cloud Storage.

## Checks

```bash
pnpm typecheck
pnpm lint
pnpm test                                               # unit tests
pnpm build
pnpm smoke http://localhost:3000 path/to/defect.jpg     # end-to-end against a running server
```

## Deploying

Cloud Run and Firestore in `asia-southeast1`; Gemini is called in `asia-south1`.

```bash
gcloud builds submit --region asia-southeast1 \
  --tag asia-southeast1-docker.pkg.dev/snagwalk-515212/snagwalk/app:<tag>
gcloud run deploy snagwalk --region asia-southeast1 \
  --image asia-southeast1-docker.pkg.dev/snagwalk-515212/snagwalk/app:<tag> \
  --service-account snagwalk-run@snagwalk-515212.iam.gserviceaccount.com \
  --set-env-vars GOOGLE_CLOUD_PROJECT=snagwalk-515212,GCS_BUCKET_NAME=snagwalk-photos-515212,VERTEX_AI_LOCATION=asia-south1,GEMINI_MODEL=gemini-3.5-flash,GEMINI_THINKING=low,DATA_STORE=firestore \
  --allow-unauthenticated --memory 1Gi --cpu 1 --min-instances 0 --max-instances 3
pnpm release:hosting      # re-release Firebase Hosting so the CDN drops the previous revision's pages
```

Live inspector relay (separate service; then point the app at it with `--update-env-vars LIVE_URL=wss://<relay>/ws`):

```bash
gcloud run deploy snagwalk-live --source live --region asia-southeast1   --service-account snagwalk-run@snagwalk-515212.iam.gserviceaccount.com --allow-unauthenticated   --timeout 3600 --max-instances 2 --concurrency 20   --set-env-vars GOOGLE_CLOUD_PROJECT=snagwalk-515212,LIVE_MODEL=gemini-3.8-live,LIVE_LOCATION=asia-south1
```

Service account `snagwalk-run` holds `roles/aiplatform.user`, `roles/datastore.user`,
`roles/serviceusage.serviceUsageConsumer` and `roles/storage.objectAdmin` on the bucket. No secrets, no VPC.

## Guardrails

See `.agents/skills/snagwalk-guardrails/SKILL.md`: snake_case collections with uuid ids, all access through
the typed data layer, no bulk deletes, photos only in Cloud Storage, fixed category and severity enums
(enforced on model output), letters that never invent defects or facts, one primary action per screen.
