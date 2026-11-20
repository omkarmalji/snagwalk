import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Guards docs/DESIGN.md: every text/background pairing we ship meets WCAG 2.1 AA in both themes. */
const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');

type Rgb = [number, number, number];

function block(selectorStart: string, from = 0): Record<string, Rgb> {
  const start = css.indexOf(selectorStart, from);
  if (start < 0) throw new Error(`missing ${selectorStart}`);
  const open = css.indexOf('{', start + selectorStart.length - 1);
  const close = css.indexOf('}', open);
  const tokens: Record<string, Rgb> = {};
  for (const m of css.slice(open + 1, close).matchAll(/--([\w-]+):\s*(\d+)\s+(\d+)\s+(\d+);/g)) {
    tokens[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])];
  }
  return tokens;
}

const light = block(':root {');
const dark = block(':root {', css.indexOf('@media (prefers-color-scheme: dark)'));
const paper = { ...light, ...block('.paper {') };

function luminance([r, g, b]: Rgb) {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: Rgb, b: Rgb) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT = ['ink', 'ink-2', 'ink-3', 'accent', 'crit', 'major', 'ok'];
const BACKGROUNDS = ['bg', 'surface', 'surface-2'];
const PAIRS: Array<[string, string]> = [
  ['accent-ink', 'accent'],
  ['accent', 'accent-soft'],
  ['crit', 'crit-soft'],
  ['major', 'major-soft'],
];

describe.each([
  ['light', light],
  ['dark', dark],
  ['paper', paper],
] as const)('%s theme', (_name, t) => {
  it.each(TEXT.flatMap((fg) => BACKGROUNDS.map((bg) => [fg, bg])))('%s on %s is AA', (fg, bg) => {
    expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it.each(PAIRS)('%s on %s is AA', (fg, bg) => {
    expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it('brand mark is visible against the page (3:1 for graphics)', () => {
    expect(contrast(t.brand, t.bg)).toBeGreaterThanOrEqual(3);
  });
});

describe('brand', () => {
  it('light accent is the logo blue #193BC4', () => {
    expect(light.accent).toEqual([25, 59, 196]);
    expect(light.brand).toEqual([25, 59, 196]);
  });
});
