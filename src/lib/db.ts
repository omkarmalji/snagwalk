import { Pool, QueryResult, QueryResultRow } from 'pg';
import fs from 'fs';
import path from 'path';

// AlloyDB / PostgreSQL connection configuration
// Read DB host, user and password from environment variables, never hardcode them.
const dbHost = process.env.DB_HOST || process.env.PGHOST;
const dbPort = parseInt(process.env.DB_PORT || process.env.PGPORT || '5432', 10);
const dbUser = process.env.DB_USER || process.env.PGUSER || 'postgres';
const dbPassword = process.env.DB_PASSWORD || process.env.PGPASSWORD || '';
const dbName = process.env.DB_NAME || process.env.PGDATABASE || 'postgres';
const dbSsl = process.env.DB_SSL === 'true';

let pool: Pool | null = null;

export function getDbPool(): Pool {
  if (!pool) {
    pool = new Pool({
      host: dbHost,
      port: dbPort,
      user: dbUser,
      password: dbPassword,
      database: dbName,
      ssl: dbSsl ? { rejectUnauthorized: false } : undefined,
      max: 5,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 1500, // fast timeout for development resiliency
    });

    pool.on('error', (err) => {
      console.warn('AlloyDB pool client error:', err.message);
    });
  }
  return pool;
}

// Persistent disk-backed store for local dev resilience across Next.js worker processes
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
  checklist: any;
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
      const content = fs.readFileSync(STORAGE_FILE, 'utf-8');
      return JSON.parse(content);
    }
  } catch (e) {
    console.warn('Could not read local data store:', e);
  }
  return { walks: [], rooms: [], snags: [] };
}

function saveStorage(data: StorageSchema) {
  try {
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.warn('Could not save local data store:', e);
  }
}

/**
 * Execute a parameterized query on AlloyDB.
 * Guardrail Rule 3: Parameterized SQL queries only. Never concatenate user input into SQL.
 * Guardrail Rule 4: Never execute DROP TABLE or TRUNCATE.
 */
export async function query<T extends QueryResultRow = any>(
  text: string,
  params: any[] = []
): Promise<QueryResult<T>> {
  // Guardrail Rule 4: Prohibit DROP TABLE and TRUNCATE
  const normalizedQuery = text.trim().toUpperCase();
  if (
    normalizedQuery.startsWith('DROP ') ||
    normalizedQuery.includes(' DROP TABLE ') ||
    normalizedQuery.startsWith('TRUNCATE ')
  ) {
    throw new Error('Guardrail violation: DROP TABLE and TRUNCATE are prohibited.');
  }

  // If DB host is configured, try direct PostgreSQL connection
  if (dbHost) {
    try {
      const db = getDbPool();
      return await db.query<T>(text, params);
    } catch (err: any) {
      console.warn(
        `AlloyDB connection not accessible directly from current network (${err.message}). Using persistent storage fallback for local development.`
      );
      return handleLocalQuery<T>(text, params);
    }
  }

  return handleLocalQuery<T>(text, params);
}

/**
 * Persistent fallback SQL emulator for local dev when outside GCP VPC.
 */
function handleLocalQuery<T extends QueryResultRow = any>(
  text: string,
  params: any[]
): QueryResult<T> {
  const q = text.trim();
  const lower = q.toLowerCase();
  const store = loadStorage();

  const emptyResult: QueryResult<T> = {
    rows: [] as T[],
    command: '',
    rowCount: 0,
    oid: 0,
    fields: [],
  };

  // CREATE TABLE check
  if (lower.startsWith('create table') || lower.startsWith('create extension')) {
    return emptyResult;
  }

  // INSERT INTO walks
  if (lower.startsWith('insert into walks')) {
    const id = crypto.randomUUID();
    const [buyer_name, builder_name, project_name, tower, flat_number, bhk, possession_date] = params;
    const record: WalkRecord = {
      id,
      buyer_name,
      builder_name,
      project_name,
      tower,
      flat_number,
      bhk: typeof bhk === 'number' ? bhk : parseInt(String(bhk), 10) || 2,
      possession_date: String(possession_date),
      letter_text: null,
      created_at: new Date().toISOString(),
    };
    store.walks.push(record);
    saveStorage(store);
    return { ...emptyResult, rows: [record as unknown as T], rowCount: 1 };
  }

  // INSERT INTO rooms
  if (lower.startsWith('insert into rooms')) {
    const id = crypto.randomUUID();
    const [walk_id, room_type, status, checklist] = params;
    const record: RoomRecord = {
      id,
      walk_id,
      room_type,
      status: status || 'pending',
      checklist: typeof checklist === 'string' ? JSON.parse(checklist) : checklist || [],
      created_at: new Date().toISOString(),
    };
    store.rooms.push(record);
    saveStorage(store);
    return { ...emptyResult, rows: [record as unknown as T], rowCount: 1 };
  }

  // INSERT INTO snags
  if (lower.startsWith('insert into snags')) {
    const id = crypto.randomUUID();
    const [walk_id, room_id, category, severity, description, location_note, photo_url] = params;
    const record: SnagRecord = {
      id,
      walk_id,
      room_id,
      category,
      severity,
      description,
      location_note: location_note || null,
      photo_url,
      created_at: new Date().toISOString(),
    };
    store.snags.push(record);
    saveStorage(store);
    return { ...emptyResult, rows: [record as unknown as T], rowCount: 1 };
  }

  // SELECT ... FROM walks WHERE id = $1
  if (lower.includes('from walks') && lower.includes('where id = $1')) {
    const walkId = params[0];
    const walk = store.walks.find((w) => w.id === walkId);
    return {
      ...emptyResult,
      rows: walk ? [walk as unknown as T] : [],
      rowCount: walk ? 1 : 0,
    };
  }

  // SELECT ... FROM walks ORDER BY created_at
  if (lower.includes('from walks') && !lower.includes('where')) {
    return {
      ...emptyResult,
      rows: store.walks as unknown as T[],
      rowCount: store.walks.length,
    };
  }

  // SELECT ... FROM rooms WHERE walk_id = $1
  if (lower.includes('from rooms') && lower.includes('where walk_id = $1')) {
    const walkId = params[0];
    const rooms = store.rooms.filter((r) => r.walk_id === walkId);
    return {
      ...emptyResult,
      rows: rooms as unknown as T[],
      rowCount: rooms.length,
    };
  }

  // SELECT ... FROM rooms r JOIN walks w ... WHERE r.id = $1
  if (lower.includes('from rooms') && lower.includes('where r.id = $1')) {
    const roomId = params[0];
    const room = store.rooms.find((r) => r.id === roomId);
    if (!room) return emptyResult;
    const walk = store.walks.find((w) => w.id === room.walk_id);
    const combined = {
      ...room,
      bhk: walk?.bhk || 2,
      project_name: walk?.project_name || '',
      builder_name: walk?.builder_name || '',
      flat_number: walk?.flat_number || '',
    };
    return {
      ...emptyResult,
      rows: [combined as unknown as T],
      rowCount: 1,
    };
  }

  // SELECT ... FROM rooms WHERE id = $1
  if (lower.includes('from rooms') && lower.includes('where id = $1')) {
    const roomId = params[0];
    const room = store.rooms.find((r) => r.id === roomId);
    return {
      ...emptyResult,
      rows: room ? [room as unknown as T] : [],
      rowCount: room ? 1 : 0,
    };
  }

  // SELECT snags count per room
  if (lower.includes('from snags') && lower.includes('group by room_id')) {
    const walkId = params[0];
    const walkSnags = store.snags.filter((s) => s.walk_id === walkId);
    const counts = new Map<string, number>();
    for (const s of walkSnags) {
      counts.set(s.room_id, (counts.get(s.room_id) || 0) + 1);
    }
    const rows = Array.from(counts.entries()).map(([room_id, snag_count]) => ({
      room_id,
      snag_count,
    }));
    return { ...emptyResult, rows: rows as unknown as T[], rowCount: rows.length };
  }

  // SELECT ... FROM snags WHERE walk_id = $1
  if (lower.includes('from snags') && lower.includes('where s.walk_id = $1')) {
    const walkId = params[0];
    const snags = store.snags
      .filter((s) => s.walk_id === walkId)
      .map((s) => {
        const room = store.rooms.find((r) => r.id === s.room_id);
        return { ...s, room_type: room?.room_type || 'Room' };
      });
    return {
      ...emptyResult,
      rows: snags as unknown as T[],
      rowCount: snags.length,
    };
  }

  // SELECT ... FROM snags WHERE room_id = $1
  if (lower.includes('from snags') && lower.includes('where room_id = $1')) {
    const roomId = params[0];
    const snags = store.snags.filter((s) => s.room_id === roomId);
    return {
      ...emptyResult,
      rows: snags as unknown as T[],
      rowCount: snags.length,
    };
  }

  // SELECT ... FROM snags WHERE id = $1
  if (lower.includes('from snags') && lower.includes('where id = $1')) {
    const snagId = params[0];
    const snag = store.snags.find((s) => s.id === snagId);
    return {
      ...emptyResult,
      rows: snag ? [snag as unknown as T] : [],
      rowCount: snag ? 1 : 0,
    };
  }

  // UPDATE rooms SET checklist = $1 WHERE id = $2
  if (lower.startsWith('update rooms set checklist = $1 where id = $2')) {
    const [checklist, id] = params;
    const room = store.rooms.find((r) => r.id === id);
    if (room) {
      room.checklist = typeof checklist === 'string' ? JSON.parse(checklist) : checklist;
      saveStorage(store);
      return { ...emptyResult, rows: [room as unknown as T], rowCount: 1 };
    }
  }

  // UPDATE walks SET letter_text = $1 WHERE id = $2
  if (lower.includes('update walks set letter_text = $1 where id = $2')) {
    const [letter_text, id] = params;
    const walk = store.walks.find((w) => w.id === id);
    if (walk) {
      walk.letter_text = letter_text;
      saveStorage(store);
      return { ...emptyResult, rows: [walk as unknown as T], rowCount: 1 };
    }
  }

  // UPDATE snags
  if (lower.startsWith('update snags set category = $1, severity = $2, description = $3, location_note = $4 where id = $5')) {
    const [category, severity, description, location_note, id] = params;
    const snag = store.snags.find((s) => s.id === id);
    if (snag) {
      snag.category = category;
      snag.severity = severity;
      snag.description = description;
      snag.location_note = location_note;
      saveStorage(store);
      return { ...emptyResult, rows: [snag as unknown as T], rowCount: 1 };
    }
  }

  // DELETE FROM snags WHERE id = $1
  if (lower.startsWith('delete from snags where id = $1')) {
    const id = params[0];
    const idx = store.snags.findIndex((s) => s.id === id);
    if (idx !== -1) {
      store.snags.splice(idx, 1);
      saveStorage(store);
      return { ...emptyResult, rowCount: 1 };
    }
  }

  return emptyResult;
}

export async function initializeDatabase() {
  // Tables already exist in AlloyDB per user requirements.
  return;
}
