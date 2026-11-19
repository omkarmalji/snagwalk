# SnagWalk 📱🏗️

**SnagWalk** is a mobile-first flat possession inspection and builder snag letter assistant built with **Next.js (App Router)**, **Google Cloud Vertex AI (Gemini Flash)**, **AlloyDB (PostgreSQL)**, and **Google Cloud Storage (GCS)**.

---

## 🚀 Key Features & 4-Screen Flow

1. **Screen 1: New Possession Walk Form (`/`)**
   - Inputs: Buyer Name, Builder / Developer, Project Name, Tower / Wing, Flat Number, BHK configuration, and Possession Date.
   - Automatically initializes the walk and default possession inspection rooms:
     - *Living Room*, *Kitchen*, *Bedroom 1 (Master)*, *Bedroom 2*, *Bathrooms*, *Balcony*.
   - Large tap targets and mobile-optimized input layout.

2. **Screen 2: Room-by-Room Walk (`/walks/[walkId]`)**
   - Summary of flat and total logged defects.
   - Expanding any room triggers **Gemini on Vertex AI** (`project snagwalk-515212`) to generate a tailored 4-6 point possession inspection checklist.
   - Interactive checklist items with progress tracking.
   - Direct button to capture snags in each room.

3. **Screen 3: Snag Capture & AI Vision Analysis (`/walks/[walkId]/rooms/[roomId]/snag`)**
   - One-tap mobile camera trigger (`capture="environment"`) or file upload.
   - Uploads photo directly to **Google Cloud Storage** (`gs://snagwalk-photos-515212`).
   - Analyzed by **Gemini Flash on Vertex AI** with strict schema guardrails:
     - `category`: `wall_paint`, `tiles`, `plumbing`, `electrical`, `doors_windows`, `woodwork`, `ceiling`, `flooring`, `other`.
     - `severity`: `minor`, `major`, `critical`.
     - `description` & `location_note`.
     - Non-defect detection safely classified as `other`.
   - Stored in AlloyDB `snags` table with an instant **edit option** to review/adjust details before saving.

4. **Screen 4: Formal Builder Snag Letter & PDF Export (`/walks/[walkId]/letter`)**
   - Gemini writes an official pre-possession snagging letter grounded **strictly in the database defects** (never hallucinates extra snags).
   - Tone: Formal, polite, and firm, addressed to the builder.
   - Grouped by room, listing severity and referenced photo numbers (`Photo #1`, `Photo #2`...).
   - Demands a **15-day rectification timeline** and written confirmation before handover.
   - Photo evidence annexure showing every captured defect photo with corresponding photo tags.
   - **Download PDF** button with client-side document rendering (`jspdf` & `html2canvas`).

---

## 🛡️ Guardrails Compliance

- **Database Rules**:
  - `snake_case` column and table names across `walks`, `rooms`, `snags`.
  - UUID primary key `id` (`gen_random_uuid()`).
  - Parameterized SQL queries only (node-postgres `$1, $2, ...`).
  - Prohibits `DROP TABLE` and `TRUNCATE`.
  - Photos stored in `gs://snagwalk-photos-515212` with only URLs kept in DB.
- **Gemini Guardrails**:
  - Strict JSON output structure.
  - Allowed categories and severities enforced by validation schemas.
- **Letter Guardrails**:
  - Formal tone addressed to builder.
  - Grouped by room with severity and photo number.
  - Mandated 15-day timeline and written confirmation.
- **UI Guardrails**:
  - Mobile-first container (`max-w-md`).
  - One primary action per screen with ≥48px touch targets.

---

## ⚙️ Environment Variables

Read from environment variables, never hardcoded:

```bash
# AlloyDB Connection
DB_HOST=your-alloydb-ip
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your-alloydb-password
DB_NAME=postgres
DB_SSL=false

# Google Cloud Settings
GOOGLE_CLOUD_PROJECT=snagwalk-515212
VERTEX_AI_LOCATION=us-central1
GCS_BUCKET_NAME=snagwalk-photos-515212
GEMINI_API_KEY=
```

---

## 🛠️ Running Locally

```bash
# Install dependencies
pnpm install

# Build
pnpm run build

# Start dev server
pnpm run dev
```

---

## 🐳 Dockerfile for Cloud Run

A production multi-stage `Dockerfile` is included:
- Built on `node:22-alpine`.
- Standalone Next.js runner for optimal image size and quick cold starts.
- Listens on port `8080` (Google Cloud Run standard).
