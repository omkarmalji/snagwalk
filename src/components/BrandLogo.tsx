import { cn } from '@/components/ui';

/** SnagWalk mark: house outline, an inspection lens inside, and a tick rising off the roof. */
export const LOGO_TEAL = '#063B40';
export const LOGO_ORANGE = '#F5962B';

export function LogoGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="135 140 820 820" className={className} aria-hidden fill="none">
      <g stroke={LOGO_TEAL} strokeWidth="66" strokeLinecap="round" strokeLinejoin="round">
        <path d="M205 558 L492 290 L540 330" />
        <path d="M808 560 L748 505 V853 H268 V500" />
      </g>
      <g stroke={LOGO_ORANGE} strokeLinejoin="round">
        <path d="M540 330 L690 448 L890 238" strokeWidth="66" />
        <circle cx="890" cy="238" r="33" fill={LOGO_ORANGE} stroke="none" />
        <circle cx="490" cy="617" r="112" strokeWidth="46" />
        <path d="M572 699 L638 766" strokeWidth="50" strokeLinecap="round" />
      </g>
    </svg>
  );
}

/** Logo on its light tile, as in the pitch deck. Stays light in dark mode. */
export default function BrandLogo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'grid size-9 shrink-0 place-items-center rounded-[11px] bg-[#FBF7F1] shadow-[0_1px_2px_rgb(0_0_0/0.12)] ring-1 ring-black/5',
        className
      )}
    >
      <LogoGlyph className="size-[78%]" />
    </span>
  );
}
