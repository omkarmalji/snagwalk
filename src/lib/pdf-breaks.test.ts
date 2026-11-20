import { describe, expect, it } from 'vitest';
import { computePageBreaks, type Block } from './pdf-breaks';

const USABLE = 1000;

/** Every px of the document lands on exactly one page, in order. */
function expectContiguous(pages: Array<[number, number]>, total: number) {
  expect(pages[0][0]).toBe(0);
  expect(pages.at(-1)![1]).toBe(total);
  for (let i = 1; i < pages.length; i++) expect(pages[i][0]).toBe(pages[i - 1][1]);
  for (const [from, to] of pages) expect(to - from).toBeLessThanOrEqual(USABLE);
}

describe('computePageBreaks', () => {
  it('keeps a short document on one page', () => {
    expect(computePageBreaks([[0, 100]], 600, USABLE)).toEqual([[0, 600]]);
  });

  it('moves the break above a block that would straddle it', () => {
    const blocks: Block[] = [
      [0, 400],
      [420, 900],
      [920, 1300], // would be cut at 1000
    ];
    const pages = computePageBreaks(blocks, 1500, USABLE);
    expect(pages[0][1]).toBe(914); // 6px above the photo row
    expectContiguous(pages, 1500);
    for (const [top, bottom] of blocks) {
      const page = pages.find(([from, to]) => top >= from && top < to)!;
      expect(bottom).toBeLessThanOrEqual(page[1]);
    }
  });

  it('cuts at the earliest straddling block when several overlap the break (a photo row)', () => {
    const row: Block[] = [
      [950, 1250],
      [960, 1250],
      [955, 1250],
    ];
    expect(computePageBreaks(row, 1400, USABLE)[0][1]).toBe(944);
  });

  it('still cuts a block taller than a page instead of producing an empty page', () => {
    const pages = computePageBreaks([[100, 2600]], 2700, USABLE);
    expectContiguous(pages, 2700);
    expect(pages.length).toBe(3);
  });

  it('does not loop forever on a block starting at the very top', () => {
    const pages = computePageBreaks([[0, 3000]], 3000, USABLE);
    expectContiguous(pages, 3000);
  });

  it('rejects a non-positive page height', () => {
    expect(() => computePageBreaks([], 100, 0)).toThrow();
  });
});
