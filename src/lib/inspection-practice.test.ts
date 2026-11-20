import { describe, expect, it } from 'vitest';
import { CATEGORIES } from '@/lib/shared';
import { getDefaultChecklist } from '@/lib/gemini';
import { INSPECTION_METHODS, PRACTICE_SOURCES, ROOM_PRACTICE, practiceKeyFor } from '@/lib/inspection-practice';

const categories = new Set<string>(CATEGORIES.map((c) => c.value));

describe('inspection practice', () => {
  it('maps room names to the right offline list', () => {
    expect(practiceKeyFor('Modular Kitchen')).toBe('kitchen');
    expect(practiceKeyFor('Master Bathroom')).toBe('bath');
    expect(practiceKeyFor('Common Toilet')).toBe('bath');
    expect(practiceKeyFor('Utility Balcony')).toBe('balcony');
    expect(practiceKeyFor('Entrance & Passage')).toBe('entrance');
    expect(practiceKeyFor('Bedroom 2')).toBe('room');
  });

  it('every offline list has 4 to 6 checks with valid categories', () => {
    for (const list of Object.values(ROOM_PRACTICE)) {
      expect(list.length).toBeGreaterThanOrEqual(4);
      expect(list.length).toBeLessThanOrEqual(6);
      for (const [item, category] of list) {
        expect(item.split(/\s+/).length).toBeLessThanOrEqual(16);
        expect(categories.has(category)).toBe(true);
      }
    }
  });

  it('wet rooms include the water test and every room type includes a hands-on method', () => {
    expect(ROOM_PRACTICE.bath.some(([i]) => /bucket/i.test(i))).toBe(true);
    expect(ROOM_PRACTICE.balcony.some(([i]) => /pour water/i.test(i))).toBe(true);
    expect(ROOM_PRACTICE.room.some(([i]) => /coin tap/i.test(i))).toBe(true);
  });

  it('getDefaultChecklist returns numbered, unchecked items', () => {
    const list = getDefaultChecklist('Master Bathroom');
    expect(list.map((i) => i.id)).toEqual(list.map((_, i) => String(i + 1)));
    expect(list.every((i) => i.checked === false)).toBe(true);
  });

  it('methods and sources are present for the prompt and the docs', () => {
    expect(INSPECTION_METHODS.length).toBeGreaterThanOrEqual(6);
    expect(PRACTICE_SOURCES.every((s) => s.url.startsWith('https://'))).toBe(true);
  });
});
