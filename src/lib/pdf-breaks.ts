/** A block that must not be split across pages: [top, bottom] in CSS px from the top of the document. */
export type Block = readonly [number, number];

/**
 * Split a tall document into page ranges of at most `usable` px, moving each break above any block that
 * would straddle it. A block taller than most of a page is still cut, so a page never comes out nearly empty.
 */
export function computePageBreaks(blocks: readonly Block[], totalHeight: number, usable: number): Array<[number, number]> {
  if (usable <= 0) throw new Error('usable page height must be positive');
  const pages: Array<[number, number]> = [];
  for (let y = 0; y < totalHeight - 1; ) {
    let end = Math.min(y + usable, totalHeight);
    if (end < totalHeight) {
      const straddling = blocks.filter(([top, bottom]) => top > y + 1 && top < end && bottom > end).map(([top]) => top);
      const cut = straddling.length ? Math.min(...straddling) - 6 : end;
      if (cut > y + usable * 0.25) end = cut;
    }
    pages.push([y, end]);
    y = end;
  }
  return pages;
}
