import { describe, expect, it } from 'vitest';
import { categoryLabel, defaultRoomsFor, parseBhk, parseLetterLanguage, photoSrc } from './shared';
import { formatDate, toWhatsAppText } from './client';

describe('defaultRoomsFor', () => {
  it('sets up a 1 BHK with one bedroom and one bathroom, no utility', () => {
    expect(defaultRoomsFor(1)).toEqual(['Entrance & Passage', 'Living Room', 'Kitchen', 'Master Bedroom', 'Bathroom', 'Balcony']);
  });

  it('sets up a 2 BHK with nine rooms', () => {
    const rooms = defaultRoomsFor(2);
    expect(rooms).toHaveLength(9);
    expect(rooms).toContain('Bedroom 2');
    expect(rooms).toContain('Common Bathroom');
    expect(rooms).toContain('Utility Area');
  });

  it('caps bathrooms at three for larger flats', () => {
    const rooms = defaultRoomsFor(5);
    expect(rooms.filter((r) => /Bathroom/.test(r))).toHaveLength(3);
    expect(rooms).toContain('Bedroom 5');
  });

  it('never repeats a room name', () => {
    for (const bhk of [1, 2, 3, 4, 5]) {
      const rooms = defaultRoomsFor(bhk);
      expect(new Set(rooms).size).toBe(rooms.length);
    }
  });
});

describe('parseBhk', () => {
  it.each([
    ['3 BHK', 3],
    [4, 4],
    ['9', 5],
    ['0', 1],
    ['', 2],
    [undefined, 2],
  ])('parses %j as %i', (input, expected) => {
    expect(parseBhk(input)).toBe(expected);
  });
});

describe('parseLetterLanguage', () => {
  it('accepts supported languages and defaults to English', () => {
    expect(parseLetterLanguage('hi')).toBe('hi');
    expect(parseLetterLanguage('mr')).toBe('mr');
    expect(parseLetterLanguage('fr')).toBe('en');
    expect(parseLetterLanguage(undefined)).toBe('en');
  });
});

describe('photoSrc', () => {
  it('routes private bucket URLs through the same-origin proxy', () => {
    expect(photoSrc('https://storage.googleapis.com/snagwalk-photos-515212/snags/abc.jpg')).toBe('/api/photos/snags/abc.jpg');
  });

  it('leaves other URLs alone and handles empty input', () => {
    expect(photoSrc('/local/abc.jpg')).toBe('/local/abc.jpg');
    expect(photoSrc(null)).toBe('');
  });
});

describe('categoryLabel', () => {
  it('maps enum values to labels and humanises unknown ones', () => {
    expect(categoryLabel('doors_windows')).toBe('Doors & windows');
    expect(categoryLabel('false_ceiling')).toBe('false ceiling');
  });
});

describe('toWhatsAppText', () => {
  it('converts markdown headings and bold to WhatsApp formatting', () => {
    expect(toWhatsAppText('### Kitchen\n\n\n\n**[Photo #1]** Leak')).toBe('*Kitchen*\n\n*[Photo #1]* Leak');
  });
});

describe('formatDate', () => {
  it('formats a calendar date without shifting the day', () => {
    expect(formatDate('2026-11-19')).toMatch(/19 Nov 2026/);
  });

  it('returns unparseable input unchanged', () => {
    expect(formatDate('soon')).toBe('soon');
  });
});
