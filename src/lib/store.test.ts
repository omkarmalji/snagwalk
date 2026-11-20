import { describe, expect, it } from 'vitest';
import { LocalStore, type NewWalk } from './store';
import { numberSnags } from './walks';
import { defaultRoomsFor } from './shared';

const walk: NewWalk = {
  buyer_name: 'Ananya Iyer',
  builder_name: 'Sobha Ltd',
  project_name: 'Dream Acres',
  tower: 'Tower 7',
  flat_number: '1402',
  bhk: 2,
  possession_date: '2026-11-20',
};

const snag = (walk_id: string, room_id: string, description: string) => ({
  walk_id,
  room_id,
  category: 'wall_paint',
  severity: 'major',
  description,
  location_note: null,
  photo_url: `https://storage.googleapis.com/b/snags/${description}.jpg`,
});

describe('LocalStore (same contract as FirestoreStore)', () => {
  it('creates a walk with its rooms in BHK order', async () => {
    const store = new LocalStore();
    const w = await store.createWalk(walk, defaultRoomsFor(2));
    expect(w.letter_text).toBeNull();
    const rooms = await store.listRooms(w.id);
    expect(rooms.map((r) => r.room_type)).toEqual(defaultRoomsFor(2));
    expect(rooms.every((r) => r.walk_id === w.id && r.checklist.length === 0)).toBe(true);
  });

  it('isolates walks: rooms and snags of one walk never leak into another', async () => {
    const store = new LocalStore();
    const a = await store.createWalk(walk, ['Kitchen']);
    const b = await store.createWalk({ ...walk, flat_number: '1403' }, ['Kitchen']);
    const [roomA] = await store.listRooms(a.id);
    await store.createSnag(snag(a.id, roomA.id, 'leak'));
    expect(await store.listSnagsByWalk(b.id)).toEqual([]);
    expect(await store.listRooms(b.id)).toHaveLength(1);
  });

  it('lists requested walks newest first and skips unknown ids', async () => {
    const store = new LocalStore();
    const first = await store.createWalk(walk, []);
    const second = await store.createWalk(walk, []);
    const got = await store.getWalks([first.id, second.id, '00000000-0000-4000-8000-000000000000']);
    expect(got.map((w) => w.id)).toEqual([second.id, first.id]);
  });

  it('updates and deletes snags, reporting missing ones', async () => {
    const store = new LocalStore();
    const w = await store.createWalk(walk, ['Balcony']);
    const [room] = await store.listRooms(w.id);
    const s = await store.createSnag(snag(w.id, room.id, 'crack'));

    const edited = await store.updateSnag(s.id, { category: 'tiles', severity: 'critical', description: 'Hollow tile', location_note: 'Door' });
    expect(edited).toMatchObject({ id: s.id, category: 'tiles', severity: 'critical', photo_url: s.photo_url });
    expect(await store.updateSnag('missing', { category: 'other', severity: 'minor', description: 'x', location_note: null })).toBeNull();

    await store.deleteSnag(s.id);
    expect(await store.listSnagsByRoom(room.id)).toEqual([]);
  });

  it('saves checklists and letters', async () => {
    const store = new LocalStore();
    const w = await store.createWalk(walk, ['Kitchen']);
    const [room] = await store.listRooms(w.id);
    expect(await store.setChecklist(room.id, [{ id: '1', item: 'Check sink', category: 'plumbing', checked: true }])).toBe(true);
    expect((await store.getRoom(room.id))!.checklist[0].checked).toBe(true);
    expect(await store.setChecklist('missing', [])).toBe(false);

    await store.setLetter(w.id, 'Dear builder');
    expect((await store.getWalk(w.id))!.letter_text).toBe('Dear builder');
  });
});

describe('numberSnags', () => {
  it('numbers snags by room order, then capture order, so letter and annexure agree', async () => {
    const store = new LocalStore();
    const w = await store.createWalk(walk, ['Entrance', 'Living Room', 'Kitchen']);
    const [entrance, living, kitchen] = await store.listRooms(w.id);
    // Captured out of room order on purpose.
    await store.createSnag(snag(w.id, kitchen.id, 'k1'));
    await store.createSnag(snag(w.id, living.id, 'l1'));
    await store.createSnag(snag(w.id, entrance.id, 'e1'));
    await store.createSnag(snag(w.id, living.id, 'l2'));

    const { snags, groups } = numberSnags(await store.listRooms(w.id), await store.listSnagsByWalk(w.id));
    expect(snags.map((s) => `${s.photo_number}:${s.description}`)).toEqual(['1:e1', '2:l1', '3:l2', '4:k1']);
    expect(groups.map((g) => g.snags.map((s) => s.photo_number))).toEqual([[1], [2, 3], [4]]);
    expect(snags[1].room_name).toBe('Living Room');
  });

  it('drops snags whose room no longer exists', () => {
    const { snags } = numberSnags([], [{ ...snag('w', 'gone', 'x'), id: 's', created_at: '2026-11-20T00:00:00Z' }]);
    expect(snags).toEqual([]);
  });
});
