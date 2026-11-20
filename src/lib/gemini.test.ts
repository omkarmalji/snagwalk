import { describe, expect, it } from 'vitest';
import { RERA_CLAUSE, isRetryableAiError, normalizeSnagAnalysis, parseJson, templateLetter, type LetterRoomGroup, type LetterWalk } from './gemini';

describe('parseJson', () => {
  it('strips markdown code fences around JSON', () => {
    expect(parseJson<{ a: number }>('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
});

describe('normalizeSnagAnalysis', () => {
  it('passes a valid analysis through unchanged', () => {
    const r = normalizeSnagAnalysis(
      { category: 'wall_paint', severity: 'major', description: 'Peeling paint', location_note: 'Above skirting', box_2d: [100, 200, 400, 600] },
      'Living Room'
    );
    expect(r).toEqual({
      category: 'wall_paint',
      severity: 'major',
      description: 'Peeling paint',
      location_note: 'Above skirting',
      box_2d: [100, 200, 400, 600],
    });
  });

  it('unwraps an array response (Gemini sometimes returns [ {...} ])', () => {
    const r = normalizeSnagAnalysis([{ category: 'plumbing', severity: 'critical', description: 'Leak' }], 'Kitchen');
    expect(r.category).toBe('plumbing');
    expect(r.severity).toBe('critical');
  });

  it('forces out-of-enum values back to the fixed enums', () => {
    const r = normalizeSnagAnalysis({ category: 'Wall Crack & Dampness', severity: 'MODERATE' }, 'Bedroom 2');
    expect(r.category).toBe('other');
    expect(r.severity).toBe('minor');
  });

  it('falls back to the room name and a neutral description when fields are missing', () => {
    const r = normalizeSnagAnalysis({}, 'Balcony');
    expect(r.location_note).toBe('Balcony');
    expect(r.description).toMatch(/defect/i);
    expect(r.box_2d).toBeNull();
  });

  it.each([
    [[0, 0, 1001, 10]], // out of range
    [[500, 100, 400, 200]], // ymin > ymax
    [[1, 2, 3]], // wrong length
    ['0,0,10,10'], // not an array
  ])('drops an invalid box %j', (box) => {
    expect(normalizeSnagAnalysis({ category: 'other', box_2d: box }, 'Room').box_2d).toBeNull();
  });

  it('survives null and non-object input', () => {
    expect(normalizeSnagAnalysis(null, 'Room').category).toBe('other');
    expect(normalizeSnagAnalysis('nope', 'Room').severity).toBe('minor');
  });
});

describe('templateLetter (Gemini-unavailable fallback)', () => {
  const walk: LetterWalk = {
    buyer_name: 'Ananya Iyer',
    builder: 'Sobha Ltd',
    project: 'Dream Acres',
    tower: 'Tower 7',
    flat_number: '1402',
    bhk: '2 BHK',
    possession_date: '2026-11-19',
  };
  const rooms: LetterRoomGroup[] = [
    {
      room_name: 'Kitchen',
      snags: [
        { photo_number: 1, category: 'plumbing', severity: 'critical', description: 'Sink leaks', location_note: 'Under sink' },
        { photo_number: 2, category: 'tiles', severity: 'minor', description: 'Dirty grout', location_note: null },
      ],
    },
    {
      room_name: 'Balcony',
      snags: [{ photo_number: 3, category: 'doors_windows', severity: 'major', description: 'Door jams', location_note: 'Hinge side' }],
    },
  ];

  it('cites every recorded photo exactly once and invents none', () => {
    const letter = templateLetter(walk, rooms, '20 November 2026');
    for (const n of [1, 2, 3]) expect(letter.match(new RegExp(`\\[Photo #${n}\\]`, 'g'))).toHaveLength(1);
    expect(letter).not.toMatch(/\[Photo #4\]/);
  });

  it('asks for rectification within 15 days and carries the RERA clause', () => {
    const letter = templateLetter(walk, rooms, '20 November 2026');
    expect(letter).toMatch(/15 days/);
    expect(letter).toContain(RERA_CLAUSE);
    expect(RERA_CLAUSE).toMatch(/Section 14\(3\)/);
  });

  it('groups by room and upper-cases severity', () => {
    const letter = templateLetter(walk, rooms, '20 November 2026');
    expect(letter).toMatch(/### Kitchen[\s\S]*### Balcony/);
    expect(letter).toMatch(/Severity: CRITICAL\. Sink leaks Location: Under sink\./);
  });

  it('says so plainly when nothing was recorded', () => {
    expect(templateLetter(walk, [], '20 November 2026')).toMatch(/No defects were recorded/);
  });

  it('uses no em dashes (UI copy rule)', () => {
    expect(templateLetter(walk, rooms, '20 November 2026')).not.toContain('—');
  });
});

describe('isRetryableAiError', () => {
  it('retries quota and overload errors', () => {
    expect(isRetryableAiError({ status: 429, message: 'x' })).toBe(true);
    expect(isRetryableAiError(new Error('Resource exhausted. Please try again later.'))).toBe(true);
    expect(isRetryableAiError(new Error('got status: 503 Service Unavailable'))).toBe(true);
  });
  it('fails fast on bad requests and auth errors', () => {
    expect(isRetryableAiError({ status: 400, message: 'Invalid argument' })).toBe(false);
    expect(isRetryableAiError(new Error('Permission denied on resource'))).toBe(false);
    expect(isRetryableAiError(new Error('model gemini-x-1429 not found'))).toBe(false);
  });
});
