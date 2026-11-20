import { Pool, QueryResult, QueryResultRow, types } from 'pg';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { alloyDbStreamFactory, type AlloyDbIpType } from './alloydb-connector';
import { assertSafeSql } from './sql-guard';

// DATE columns come back as 'YYYY-MM-DD' strings. The default parser builds a local-midnight Date,
// which toISOString() shifts to the previous day in IST.
types.setTypeParser(1082, (v: string) => v);

// AlloyDB / PostgreSQL connection. Read DB host, user and password from environment variables, never hardcode them.
// ALLOYDB_INSTANCE_URI (projects/<p>/locations/<r>/clusters/<c>/instances/<i>) connects through the built-in
// AlloyDB connector (mTLS + IAM, no VPC needed). Otherwise DB_HOST is used as a plain Postgres host.
const instanceUri = process.env.ALLOYDB_INSTANCE_URI?.trim() || '';
const ipType = (process.env.ALLOYDB_IP_TYPE || 'PUBLIC').toUpperCase() as AlloyDbIpType;
const dbHost = instanceUri ? `alloydb:${instanceUri.split('/').pop()}` : process.env.DB_HOST || process.env.PGHOST;
const dbPort = parseInt(process.env.DB_PORT || process.env.PGPORT || '5432', 10);
const dbUser = process.env.DB_USER || process.env.PGUSER || 'postgres';
const dbPassword = process.env.DB_PASSWORD || process.env.PGPASSWORD || '';
const dbName = process.env.DB_NAME || process.env.PGDATABASE || 'postgres';
const dbSsl = process.env.DB_SSL === 'true';

/**
 * Local JSON fallback is for development outside the GCP VPC only.
 * DB_FALLBACK=off disables it (recommended on Cloud Run). Default: on in development, off in production.
 */
const fallbackEnabled =
  (process.env.DB_FALLBACK || (process.env.NODE_ENV === 'production' ? 'off' : 'on')).toLowerCase() !== 'off';

const CIRCUIT_OPEN_MS = 5 * 60_000;

// Process-wide state. Next.js can load this module once per route bundle, so module-level
// variables would give every route its own pool and its own circuit breaker.
type DbState = {
  pool: Pool | null;
  schemaReady: Promise<void> | null;
  circuitOpenUntil: number;
  lastDbError: string | null;
  lastMode: 'alloydb' | 'local' | null;
};
const g = globalThis as typeof globalThis & { __snagwalkDb?: DbState };
const state: DbState = (g.__snagwalkDb ??= { pool: null, schemaReady: null, circuitOpenUntil: 0, lastDbError: null, lastMode: null });

export function getDbPool(): Pool {
  if (!state.pool) {
    const pool = (state.pool = new Pool({
      ...(instanceUri
        ? { stream: alloyDbStreamFactory(instanceUri, ipType), ssl: false }
        : { host: dbHost, port: dbPort, ssl: dbSsl ? { rejectUnauthorized: false } : undefined }),
      user: dbUser,
      password: dbPassword,
      database: dbName,
      max: 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: fallbackEnabled ? 2_500 : 10_000,
    }));
    pool.on('error', (err) => {
      console.warn('[db] pool client error:', err.message);
    });
  }
  return state.pool;
}

/**
 * Idempotent schema bootstrap, run once per process before the first real query.
 * CREATE ... IF NOT EXISTS only: never drops, renames or alters existing tables.
 */
// Mirrors the tables already provisioned in AlloyDB, so a fresh database ends up identical.
const SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS walks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    buyer_name text NOT NULL,
    builder_name text NOT NULL,
    project_name text,
    tower text,
    flat_number text NOT NULL,
    bhk smallint,
    possession_date date,
    letter_text text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS rooms (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    walk_id uuid NOT NULL REFERENCES walks(id) ON DELETE CASCADE,
    room_type text NOT NULL,
    checklist jsonb,
    status text NOT NULL DEFAULT 'pending',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS snags (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    walk_id uuid NOT NULL REFERENCES walks(id) ON DELETE CASCADE,
    room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    photo_url text NOT NULL,
    category text NOT NULL,
    severity text NOT NULL CHECK (severity IN ('minor', 'major', 'critical')),
    description text NOT NULL,
    location_note text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS rooms_walk_id_idx ON rooms (walk_id)`,
  `CREATE INDEX IF NOT EXISTS snags_walk_id_idx ON snags (walk_id)`,
  `CREATE INDEX IF NOT EXISTS snags_room_id_idx ON snags (room_id)`,
];

function ensureSchema(): Promise<void> {
  state.schemaReady ??= (async () => {
    const client = await getDbPool().connect();
    try {
      for (const sql of SCHEMA_SQL) await client.query(sql);
    } finally {
      client.release();
    }
  })().catch((err) => {
    state.schemaReady = null; // retry on the next query
    throw err;
  });
  return state.schemaReady;
}

/** True only for errors meaning "could not reach the database", never for SQL errors. */
function isConnectionError(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  const code = e?.code || '';
  const msg = (e?.message || '').toLowerCase();
  return (
    ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNRESET', 'EAI_AGAIN'].includes(code) ||
    msg.includes('timeout exceeded when trying to connect') ||
    msg.includes('connection terminated') ||
    msg.includes('connect etimedout') ||
    msg.includes('alloydb admin api') ||
    msg.includes('alloydb connector') ||
    msg.includes('could not load the default credentials')
  );
}

export function getDbStatus() {
  const circuitOpen = Date.now() < state.circuitOpenUntil;
  return {
    configured: Boolean(dbHost),
    fallbackEnabled,
    mode: !dbHost ? 'local' : circuitOpen ? 'local' : state.lastMode ?? 'unknown',
    lastError: state.lastDbError,
  };
}

/**
 * Execute a parameterized query.
 * Guardrail: parameterized SQL only, never concatenate user input. Never DROP TABLE or TRUNCATE.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function query<T extends QueryResultRow = any>(
  text: string,
  params: unknown[] = []
): Promise<QueryResult<T>> {
  assertSafeSql(text);

  if (dbHost && Date.now() >= state.circuitOpenUntil) {
    try {
      await ensureSchema();
      const result = await getDbPool().query<T>(text, params);
      state.lastMode = 'alloydb';
      return result;
    } catch (err) {
      if (!isConnectionError(err) || !fallbackEnabled) throw err;
      state.lastDbError = (err as Error).message;
      state.circuitOpenUntil = Date.now() + CIRCUIT_OPEN_MS;
      console.warn(
        `[db] AlloyDB unreachable (${state.lastDbError}). Using local JSON store for ${CIRCUIT_OPEN_MS / 1000}s.`
      );
    }
  } else if (dbHost && !fallbackEnabled) {
    throw new Error('Database unavailable');
  }

  if (!fallbackEnabled) throw new Error('Database is not configured (DB_HOST missing) and DB_FALLBACK is off.');
  state.lastMode = 'local';
  return handleLocalQuery<T>(text, params);
}

// ---------------------------------------------------------------------------
// Local JSON emulator (development only). Pattern-matches the exact SQL used by the API routes.
// ---------------------------------------------------------------------------

const STORAGE_FILE = path.join(process.cwd(), '.snagwalk_local_data.json');

interface WalkRecord {
  id: string;
  buyer_name: string;
  builder_name: string;
  project_name: string;
  tower: string;
  flat_number: string;
  bhk: number;
  possession_date: string;
  letter_text: string | null;
  created_at: string;
}

interface RoomRecord {
  id: string;
  walk_id: string;
  room_type: string;
  checklist: unknown;
  status: string;
  created_at: string;
}

interface SnagRecord {
  id: string;
  walk_id: string;
  room_id: string;
  photo_url: string;
  category: string;
  severity: string;
  description: string;
  location_note: string | null;
  created_at: string;
}

interface StorageSchema {
  walks: WalkRecord[];
  rooms: RoomRecord[];
  snags: SnagRecord[];
}

function loadStorage(): StorageSchema {
  try {
    if (fs.existsSync(STORAGE_FILE)) {
      return JSON.parse(fs.readFileSync(STORAGE_FILE, 'utf-8'));
    }
  } catch (e) {
    console.warn('[db] could not read local data store:', e);
  }
  return { walks: [], rooms: [], snags: [] };
}

function saveStorage(data: StorageSchema) {
  fs.writeFileSync(STORAGE_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// Monotonic timestamps so ORDER BY created_at is stable for rows inserted in the same millisecond.
let lastTs = 0;
function nowIso(): string {
  lastTs = Math.max(Date.now(), lastTs + 1);
  return new Date(lastTs).toISOString();
}

const byCreatedAsc = (a: { created_at: string }, b: { created_at: string }) =>
  a.created_at.localeCompare(b.created_at);

function result<T extends QueryResultRow>(rows: unknown[], command = 'SELECT'): QueryResult<T> {
  return { rows: rows as T[], rowCount: rows.length, command, oid: 0, fields: [] };
}

function parseJsonParam(v: unknown) {
  if (typeof v === 'string') {
    try {
      return JSON.parse(v);
    } catch {
      return [];
    }
  }
  return v ?? [];
}

function handleLocalQuery<T extends QueryResultRow>(text: string, params: unknown[]): QueryResult<T> {
  const lower = text.trim().toLowerCase().replace(/\s+/g, ' ');
  const store = loadStorage();
  const p = params as string[];
  const isSelect = lower.startsWith('select');

  if (lower.startsWith('insert into walks')) {
    const [buyer_name, builder_name, project_name, tower, flat_number, bhk, possession_date] = params;
    const record: WalkRecord = {
      id: crypto.randomUUID(),
      buyer_name: String(buyer_name),
      builder_name: String(builder_name),
      project_name: String(project_name),
      tower: String(tower),
      flat_number: String(flat_number),
      bhk: Number(bhk) || 2,
      possession_date: String(possession_date),
      letter_text: null,
      created_at: nowIso(),
    };
    store.walks.push(record);
    saveStorage(store);
    return result([record], 'INSERT');
  }

  if (lower.startsWith('insert into rooms')) {
    const [walk_id, room_type, status, checklist] = params;
    const record: RoomRecord = {
      id: crypto.randomUUID(),
      walk_id: String(walk_id),
      room_type: String(room_type),
      status: String(status || 'pending'),
      checklist: parseJsonParam(checklist),
      created_at: nowIso(),
    };
    store.rooms.push(record);
    saveStorage(store);
    return result([record], 'INSERT');
  }

  if (lower.startsWith('insert into snags')) {
    const [walk_id, room_id, category, severity, description, location_note, photo_url] = params;
    const record: SnagRecord = {
      id: crypto.randomUUID(),
      walk_id: String(walk_id),
      room_id: String(room_id),
      category: String(category),
      severity: String(severity),
      description: String(description),
      location_note: (location_note as string) || null,
      photo_url: String(photo_url),
      created_at: nowIso(),
    };
    store.snags.push(record);
    saveStorage(store);
    return result([record], 'INSERT');
  }

  // walks
  if (isSelect && lower.includes('from walks') && lower.includes('where id = any($1')) {
    const ids = new Set((params[0] as string[]) || []);
    const rows = store.walks.filter((w) => ids.has(w.id)).sort(byCreatedAsc).reverse();
    return result(rows);
  }
  if (isSelect && lower.includes('from walks') && lower.includes('where id = $1')) {
    return result(store.walks.filter((w) => w.id === p[0]));
  }
  if (isSelect && lower.includes('from walks')) {
    const limit = Number(lower.match(/limit (\d+)/)?.[1] || 50);
    return result([...store.walks].sort(byCreatedAsc).reverse().slice(0, limit));
  }

  // rooms joined with walks
  if (isSelect && lower.includes('from rooms r join walks w') && lower.includes('where r.id = $1')) {
    const room = store.rooms.find((r) => r.id === p[0]);
    if (!room) return result([]);
    const walk = store.walks.find((w) => w.id === room.walk_id);
    return result([
      {
        ...room,
        bhk: walk?.bhk ?? 2,
        project_name: walk?.project_name ?? '',
        builder_name: walk?.builder_name ?? '',
        flat_number: walk?.flat_number ?? '',
      },
    ]);
  }
  if (isSelect && lower.includes('from rooms') && lower.includes('where walk_id = $1')) {
    return result(store.rooms.filter((r) => r.walk_id === p[0]).sort(byCreatedAsc));
  }

  // snags
  if (isSelect && lower.includes('from snags') && lower.includes('group by room_id')) {
    const counts = new Map<string, number>();
    for (const s of store.snags.filter((s) => s.walk_id === p[0])) {
      counts.set(s.room_id, (counts.get(s.room_id) || 0) + 1);
    }
    return result(Array.from(counts, ([room_id, snag_count]) => ({ room_id, snag_count })));
  }
  if (isSelect && lower.includes('from snags s join rooms r') && lower.includes('where s.walk_id = $1')) {
    const rooms = new Map(store.rooms.map((r) => [r.id, r]));
    const rows = store.snags
      .filter((s) => s.walk_id === p[0])
      .map((s) => ({ ...s, room_type: rooms.get(s.room_id)?.room_type ?? 'Room', _room_created: rooms.get(s.room_id)?.created_at ?? '' }))
      .sort((a, b) => a._room_created.localeCompare(b._room_created) || byCreatedAsc(a, b))
      .map(({ _room_created, ...rest }) => { void _room_created; return rest; });
    return result(rows);
  }
  if (isSelect && lower.includes('from snags') && lower.includes('where room_id = $1')) {
    return result(store.snags.filter((s) => s.room_id === p[0]).sort(byCreatedAsc));
  }
  if (isSelect && lower.includes('from snags') && lower.includes('where id = $1')) {
    return result(store.snags.filter((s) => s.id === p[0]));
  }

  // updates
  if (lower.startsWith('update rooms set checklist = $1 where id = $2')) {
    const room = store.rooms.find((r) => r.id === p[1]);
    if (!room) return result([], 'UPDATE');
    room.checklist = parseJsonParam(params[0]);
    saveStorage(store);
    return result([room], 'UPDATE');
  }
  if (lower.startsWith('update walks set letter_text = $1 where id = $2')) {
    const walk = store.walks.find((w) => w.id === p[1]);
    if (!walk) return result([], 'UPDATE');
    walk.letter_text = (params[0] as string) ?? null;
    saveStorage(store);
    return result([walk], 'UPDATE');
  }
  if (lower.startsWith('update snags set category = $1, severity = $2, description = $3, location_note = $4 where id = $5')) {
    const snag = store.snags.find((s) => s.id === p[4]);
    if (!snag) return result([], 'UPDATE');
    Object.assign(snag, { category: p[0], severity: p[1], description: p[2], location_note: p[3] ?? null });
    saveStorage(store);
    return result([snag], 'UPDATE');
  }

  // deletes
  if (lower.startsWith('delete from snags where id = $1')) {
    const idx = store.snags.findIndex((s) => s.id === p[0]);
    if (idx === -1) return result([], 'DELETE');
    const [removed] = store.snags.splice(idx, 1);
    saveStorage(store);
    return result([removed], 'DELETE');
  }

  console.warn('[db] local emulator: unmatched query:', lower.slice(0, 120));
  return result([]);
}
