import { cn } from '@/components/ui';

/**
 * SnagWalk mark: a floor plan drawn as one orthogonal route that reads as an S, with an opening on the right edge
 * (the way in). Traced from public/brand/snagwalk-logo-v2.png (98.8% pixel overlap) onto a 390 x 398 grid.
 * Brand blue is #193BC4; see docs/DESIGN.md.
 */
export const BRAND_BLUE = '#193BC4';

const MARK_RECTS: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 0, 390, 57], // top wall
  [211, 57, 38, 40], // door stop
  [332, 0, 58, 115], // right wall, above the opening
  [0, 0, 59, 280], // left wall
  [114, 152, 276, 57], // middle corridor
  [332, 152, 58, 246], // right wall, below the opening
  [0, 248, 225, 32], // lower corridor
  [168, 248, 57, 150], // stem
  [168, 340, 222, 58], // bottom wall
  [0, 321, 102, 77], // corner block
];

export const MARK_VIEWBOX = '0 0 390 398';

/** Mark only. Takes the current text colour, so `text-brand` (default) follows light and dark mode. */
export function LogoMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox={MARK_VIEWBOX}
      className={cn('text-brand', className)}
      fill="currentColor"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {MARK_RECTS.map(([x, y, w, h], i) => (
        // Static list: the index is a stable key (two rects share an origin, so coordinates are not unique).
        <rect key={i} x={x} y={y} width={w} height={h} />
      ))}
    </svg>
  );
}

/** Horizontal lockup: mark + wordmark, as in the brand file. */
export default function BrandLogo({ className, size = 'md' }: { className?: string; size?: 'md' | 'lg' }) {
  return (
    <span className={cn('inline-flex items-center', size === 'lg' ? 'gap-3' : 'gap-2.5', className)}>
      <LogoMark className={size === 'lg' ? 'size-9' : 'size-[26px]'} />
      <span
        className={cn(
          'font-bold leading-none tracking-[-0.03em] text-ink',
          size === 'lg' ? 'text-[28px]' : 'text-[19px]'
        )}
      >
        SnagWalk
      </span>
    </span>
  );
}
