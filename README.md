# SnagWalk

Possession-day snag inspection for Indian home buyers. Walk the new flat room by room, photograph defects,
let Gemini classify them, and send the builder a formal snag letter with a photo annexure.

Built on Next.js 15, Gemini 3.5 Flash on Vertex AI, AlloyDB and Cloud Storage. Deploys to Cloud Run.

## The flow

| Screen | Route | What Gemini does |
| --- | --- | --- |
| Start a walk | `/` | Nothing yet. Rooms are provisioned from the BHK (bedrooms, bathrooms, utility). |
| Rooms | `/walks/[walkId]` | Writes a 4-6 item checklist for each room on first open. |
| Snag capture | `/walks/[walkId]/rooms/[roomId]/snag` | Reads the photo and returns category, severity, description, location and a bounding box drawn on the photo. The buyer edits or discards. |
| Builder letter | `/walks/[walkId]/letter` | Drafts the formal notice from the snags table only: grouped by room, photo references, 15-day deadline, written confirmation. PDF, share and copy. |

The letter stores a fingerprint of the snags it was written from. If a snag is added, edited or deleted the
letter is marked stale and regenerated on the next visit, so it never cites a defect that no longer exists.

## Google AI and Cloud

- **Gemini 3.5 Flash on Vertex AI** (`@google/genai`), structured JSON output with enum-constrained schemas,
  low thinking level and medium image resolution so a photo is analysed in about 3-6 seconds from `asia-south1`.
- **Cloud Storage** for photos (private bucket). The browser loads them through `/api/photos`, which also keeps
  the PDF export canvas untainted.
- **AlloyDB** for walks, rooms and snags. Parameterized SQL only.
- **Cloud Run** via the multi-stage `Dockerfile` (standalone Next.js on port 8080).

Every AI result carries a `source` (`gemini` or `fallback`) and the UI labels fallbacks honestly.
`GET /api/health` reports which model, auth mode, database and storage are live; the header shows it.

## Running locally

```bash
pnpm install
gcloud auth application-default login     # Gemini + Cloud Storage via ADC
cp .env.example .env.local                # set DB_PASSWORD (and ALLOYDB_INSTANCE_URI)
pnpm dev
```

AlloyDB is reached through the built-in connector (`src/lib/alloydb-connector.ts`): it fetches a short-lived
client certificate from the AlloyDB Admin API with your ADC identity and opens mutual TLS to the instance on
port 5433, so no VPC, PSC endpoint or Auth Proxy is needed. Your account needs `roles/alloydb.client`.
The schema is created on first use (`CREATE TABLE IF NOT EXISTS`).

If the database is unreachable, development falls back to a local JSON store (`.snagwalk_local_data.json`)
and local photo storage (`.local_uploads/`). Both fallbacks are off in production.

## Checks

```bash
pnpm typecheck
pnpm lint
pnpm build
pnpm smoke http://localhost:3000 path/to/defect.jpg   # end-to-end API test against a running server
```

## Deploying to Cloud Run

Runs in `asia-southeast1` next to the AlloyDB cluster; Gemini is called in `asia-south1`.

```bash
gcloud builds submit --region asia-southeast1 \
  --tag asia-southeast1-docker.pkg.dev/snagwalk-515212/snagwalk/app:<tag>
gcloud run deploy snagwalk --region asia-southeast1 \
  --image asia-southeast1-docker.pkg.dev/snagwalk-515212/snagwalk/app:<tag> \
  --service-account snagwalk-run@snagwalk-515212.iam.gserviceaccount.com \
  --set-env-vars GOOGLE_CLOUD_PROJECT=snagwalk-515212,GCS_BUCKET_NAME=snagwalk-photos-515212,VERTEX_AI_LOCATION=asia-south1,GEMINI_MODEL=gemini-3.5-flash,GEMINI_THINKING=low,ALLOYDB_INSTANCE_URI=projects/snagwalk-515212/locations/asia-southeast1/clusters/snagwalk-db/instances/primary,DB_USER=postgres,DB_NAME=postgres \
  --set-secrets DB_PASSWORD=snagwalk-db-password:latest \
  --allow-unauthenticated --memory 1Gi --cpu 1 --min-instances 0 --max-instances 3
```

Service account `snagwalk-run` holds `roles/aiplatform.user`, `roles/alloydb.client`,
`roles/serviceusage.serviceUsageConsumer`, `roles/storage.objectAdmin` on the bucket and
`roles/secretmanager.secretAccessor` on `snagwalk-db-password`. No VPC connector is required.

### Public URL (Firebase Hosting)

**https://snagwalk-app.web.app** fronts the Cloud Run service: `firebase.json` rewrites every path to
`snagwalk` in `asia-southeast1`. The CDN caches the prerendered home page, so **re-release Hosting after
every Cloud Run deploy** to purge it:

```bash
firebase deploy --only hosting
```

## Guardrails

See `.agents/skills/snagwalk-guardrails/SKILL.md`. In short: snake_case tables with uuid ids, parameterized
SQL, no DROP/TRUNCATE, photos only in Cloud Storage, fixed category and severity enums, letters that never
invent defects, one primary action per screen with large tap targets.
