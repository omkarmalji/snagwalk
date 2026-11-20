import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Firestore } from '@google-cloud/firestore';
import type { ChecklistItem } from '@/lib/gemini';

/**
 * Data layer. Firestore (Native mode) in production: serverless, inside the free tier at SnagWalk's scale,
 * no instances or passwords, and the Cloud Run service account authenticates through IAM.
 * A JSON file store backs local development without credentials, and the unit tests.
 *
 * Collections are top level and keyed by uuid (route params are uuid-validated before any read):
 *   walks/{id}   rooms/{id} (walk_id)   snags/{id} (walk_id, room_id)
 * Every list query filters on one field and sorts in memory, so no composite indexes are needed.
 */

export interface WalkDoc {
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

export interface RoomDoc {
  id: string;
  walk_id: string;
  room_type: string;
  status: string;
  checklist: ChecklistItem[];
  created_at: string;
}

export interface SnagDoc {
  id: string;
  walk_id: string;
  room_id: string;
  category: string;
  severity: string;
  description: string;
  location_note: string | null;
  photo_url: string;
  created_at: string;
}

export type NewWalk = Omit<WalkDoc, 'id' | 'created_at' | 'letter_text'>;
export type NewSnag = Omit<SnagDoc, 'id' | 'created_at'>;
export type SnagEdit = Pick<SnagDoc, 'category' | 'severity' | 'description' | 'location_note'>;

export interface Store {
  readonly kind: 'firestore' | 'local';
  /** Creates the walk and its rooms atomically; rooms keep the given order. */
  createWalk(walk: NewWalk, roomTypes: string[]): Promise<WalkDoc>;
  getWalk(id: string): Promise<WalkDoc | null>;
  /** Newest first. Unknown ids are skipped. */
  getWalks(ids: string[]): Promise<WalkDoc[]>;
  setLetter(walkId: string, letterText: string): Promise<void>;
  addRoom(walkId: string, roomType: string): Promise<RoomDoc>;
  getRoom(id: string): Promise<RoomDoc | null>;
  /** In creation order. */
  listRooms(walkId: string): Promise<RoomDoc[]>;
  /** Returns false when the room does not exist. */
  setChecklist(roomId: string, checklist: ChecklistItem[]): Promise<boolean>;
  createSnag(snag: NewSnag): Promise<SnagDoc>;
  /** In capture order. */
  listSnagsByRoom(roomId: string): Promise<SnagDoc[]>;
  listSnagsByWalk(walkId: string): Promise<SnagDoc[]>;
  /** Returns null when the snag does not exist. */
  updateSnag(id: string, edit: SnagEdit): Promise<SnagDoc | null>;
  deleteSnag(id: string): Promise<void>;
  /** Cheap read used by /api/health. */
  ping(): Promise<void>;
}

const byCreated = (a: { created_at: string }, b: { created_at: string }) => a.created_at.localeCompare(b.created_at);

/** Monotonic ISO timestamps so documents written in the same millisecond still sort in write order. */
let lastTs = 0;
function nowIso(offsetMs = 0): string {
  lastTs = Math.max(Date.now() + offsetMs, lastTs + 1);
  return new Date(lastTs).toISOString();
}

// ---------------------------------------------------------------------------
// Firestore
// ---------------------------------------------------------------------------

export class FirestoreStore implements Store {
  readonly kind = 'firestore' as const;
  constructor(private readonly db: Firestore) {}

  private walks() {
    return this.db.collection('walks');
  }
  private rooms() {
    return this.db.collection('rooms');
  }
  private snags() {
    return this.db.collection('snags');
  }

  async createWalk(walk: NewWalk, roomTypes: string[]): Promise<WalkDoc> {
    const doc: WalkDoc = { ...walk, id: crypto.randomUUID(), letter_text: null, created_at: nowIso() };
    const batch = this.db.batch();
    batch.set(this.walks().doc(doc.id), doc);
    for (const room_type of roomTypes) {
      const room: RoomDoc = { id: crypto.randomUUID(), walk_id: doc.id, room_type, status: 'pending', checklist: [], created_at: nowIso() };
      batch.set(this.rooms().doc(room.id), room);
    }
    await batch.commit();
    return doc;
  }

  async getWalk(id: string) {
    const snap = await this.walks().doc(id).get();
    return snap.exists ? (snap.data() as WalkDoc) : null;
  }

  async getWalks(ids: string[]) {
    if (!ids.length) return [];
    const snaps = await this.db.getAll(...ids.map((id) => this.walks().doc(id)));
    return snaps
      .filter((s) => s.exists)
      .map((s) => s.data() as WalkDoc)
      .sort(byCreated)
      .reverse();
  }

  async setLetter(walkId: string, letterText: string) {
    await this.walks().doc(walkId).update({ letter_text: letterText });
  }

  async addRoom(walkId: string, room_type: string) {
    const room: RoomDoc = { id: crypto.randomUUID(), walk_id: walkId, room_type, status: 'pending', checklist: [], created_at: nowIso() };
    await this.rooms().doc(room.id).set(room);
    return room;
  }

  async getRoom(id: string) {
    const snap = await this.rooms().doc(id).get();
    return snap.exists ? (snap.data() as RoomDoc) : null;
  }

  async listRooms(walkId: string) {
    const snap = await this.rooms().where('walk_id', '==', walkId).get();
    return snap.docs.map((d) => d.data() as RoomDoc).sort(byCreated);
  }

  async setChecklist(roomId: string, checklist: ChecklistItem[]) {
    try {
      await this.rooms().doc(roomId).update({ checklist });
      return true;
    } catch (err) {
      if ((err as { code?: number }).code === 5) return false; // NOT_FOUND
      throw err;
    }
  }

  async createSnag(snag: NewSnag) {
    const doc: SnagDoc = { ...snag, id: crypto.randomUUID(), created_at: nowIso() };
    await this.snags().doc(doc.id).set(doc);
    return doc;
  }

  async listSnagsByRoom(roomId: string) {
    const snap = await this.snags().where('room_id', '==', roomId).get();
    return snap.docs.map((d) => d.data() as SnagDoc).sort(byCreated);
  }

  async listSnagsByWalk(walkId: string) {
    const snap = await this.snags().where('walk_id', '==', walkId).get();
    return snap.docs.map((d) => d.data() as SnagDoc).sort(byCreated);
  }

  async updateSnag(id: string, edit: SnagEdit) {
    const ref = this.snags().doc(id);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      tx.update(ref, edit);
      return { ...(snap.data() as SnagDoc), ...edit };
    });
  }

  async deleteSnag(id: string) {
    await this.snags().doc(id).delete();
  }

  async ping() {
    await this.walks().limit(1).get();
  }
}

// ---------------------------------------------------------------------------
// Local JSON file (development without credentials, and tests)
// ---------------------------------------------------------------------------

interface LocalData {
  walks: WalkDoc[];
  rooms: RoomDoc[];
  snags: SnagDoc[];
}

export class LocalStore implements Store {
  readonly kind = 'local' as const;
  private memory: LocalData | null;

  /** With no file path the store lives in memory only (tests). */
  constructor(private readonly file?: string) {
    this.memory = file ? null : { walks: [], rooms: [], snags: [] };
  }

  private load(): LocalData {
    if (this.memory) return this.memory;
    try {
      if (this.file && fs.existsSync(this.file)) {
        const d = JSON.parse(fs.readFileSync(this.file, 'utf-8')) as Partial<LocalData>;
        return { walks: d.walks ?? [], rooms: d.rooms ?? [], snags: d.snags ?? [] };
      }
    } catch (e) {
      console.warn('[store] could not read local data file:', e);
    }
    return { walks: [], rooms: [], snags: [] };
  }

  private save(d: LocalData) {
    if (this.memory) this.memory = d;
    else fs.writeFileSync(this.file!, JSON.stringify(d, null, 2), 'utf-8');
  }

  async createWalk(walk: NewWalk, roomTypes: string[]) {
    const d = this.load();
    const doc: WalkDoc = { ...walk, id: crypto.randomUUID(), letter_text: null, created_at: nowIso() };
    d.walks.push(doc);
    for (const room_type of roomTypes) {
      d.rooms.push({ id: crypto.randomUUID(), walk_id: doc.id, room_type, status: 'pending', checklist: [], created_at: nowIso() });
    }
    this.save(d);
    return doc;
  }

  async getWalk(id: string) {
    return this.load().walks.find((w) => w.id === id) ?? null;
  }

  async getWalks(ids: string[]) {
    const set = new Set(ids);
    return this.load().walks.filter((w) => set.has(w.id)).sort(byCreated).reverse();
  }

  async setLetter(walkId: string, letterText: string) {
    const d = this.load();
    const w = d.walks.find((x) => x.id === walkId);
    if (w) {
      w.letter_text = letterText;
      this.save(d);
    }
  }

  async addRoom(walkId: string, room_type: string) {
    const d = this.load();
    const room: RoomDoc = { id: crypto.randomUUID(), walk_id: walkId, room_type, status: 'pending', checklist: [], created_at: nowIso() };
    d.rooms.push(room);
    this.save(d);
    return room;
  }

  async getRoom(id: string) {
    return this.load().rooms.find((r) => r.id === id) ?? null;
  }

  async listRooms(walkId: string) {
    return this.load().rooms.filter((r) => r.walk_id === walkId).sort(byCreated);
  }

  async setChecklist(roomId: string, checklist: ChecklistItem[]) {
    const d = this.load();
    const r = d.rooms.find((x) => x.id === roomId);
    if (!r) return false;
    r.checklist = checklist;
    this.save(d);
    return true;
  }

  async createSnag(snag: NewSnag) {
    const d = this.load();
    const doc: SnagDoc = { ...snag, id: crypto.randomUUID(), created_at: nowIso() };
    d.snags.push(doc);
    this.save(d);
    return doc;
  }

  async listSnagsByRoom(roomId: string) {
    return this.load().snags.filter((s) => s.room_id === roomId).sort(byCreated);
  }

  async listSnagsByWalk(walkId: string) {
    return this.load().snags.filter((s) => s.walk_id === walkId).sort(byCreated);
  }

  async updateSnag(id: string, edit: SnagEdit) {
    const d = this.load();
    const s = d.snags.find((x) => x.id === id);
    if (!s) return null;
    Object.assign(s, edit);
    this.save(d);
    return { ...s };
  }

  async deleteSnag(id: string) {
    const d = this.load();
    d.snags = d.snags.filter((s) => s.id !== id);
    this.save(d);
  }

  async ping() {}
}

// ---------------------------------------------------------------------------
// Selection. DATA_STORE=firestore|local; default firestore in production, local in development.
// Process-wide on globalThis: Next.js loads library modules once per route bundle.
// ---------------------------------------------------------------------------

type StoreState = { store: Store | null; lastError: string | null; lastOkAt: string | null };
const g = globalThis as typeof globalThis & { __snagwalkStore?: StoreState };
const state: StoreState = (g.__snagwalkStore ??= { store: null, lastError: null, lastOkAt: null });

const LOCAL_FILE = path.join(process.cwd(), '.snagwalk_local_data.json');

function storeKind(): 'firestore' | 'local' {
  const v = (process.env.DATA_STORE || (process.env.NODE_ENV === 'production' ? 'firestore' : 'local')).toLowerCase();
  return v === 'local' ? 'local' : 'firestore';
}

export function getStore(): Store {
  if (!state.store) {
    state.store =
      storeKind() === 'local'
        ? new LocalStore(LOCAL_FILE)
        : new FirestoreStore(
            new Firestore({
              projectId: process.env.GOOGLE_CLOUD_PROJECT || 'snagwalk-515212',
              databaseId: process.env.FIRESTORE_DATABASE || '(default)',
              ignoreUndefinedProperties: true,
            })
          );
  }
  return state.store;
}

/** Health check: which store is live and whether its last ping worked. */
export async function getStoreStatus() {
  const store = getStore();
  try {
    await store.ping();
    state.lastOkAt = new Date().toISOString();
    state.lastError = null;
  } catch (err) {
    state.lastError = (err as Error).message.slice(0, 300);
  }
  return {
    configured: true,
    mode: store.kind,
    live: state.lastError === null,
    lastError: state.lastError,
  };
}
