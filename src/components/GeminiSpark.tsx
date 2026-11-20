import { cn } from '@/components/ui';

/**
 * Generic four-point AI sparkle in the accent blue: the "Gemini is working" signal across the app. Deliberately not
 * Google's Gemini logo (that needs brand permission and its gradient breaks the no-purple rule); the product is named
 * in text next to it. `active` animates it (slow turn + twinkle); motion is CSS-only and off under reduced motion.
 */
const SPARK = 'M12 0C12.6 6.4 17.6 11.4 24 12C17.6 12.6 12.6 17.6 12 24C11.4 17.6 6.4 12.6 0 12C6.4 11.4 11.4 6.4 12 0Z';

export function GeminiSpark({ className, active = false }: { className?: string; active?: boolean }) {
  return (
    <span aria-hidden className={cn('gemini-spark relative inline-block shrink-0', active && 'is-active', className)}>
      <svg viewBox="0 0 24 24" className="gemini-spark-main block size-full" fill="currentColor">
        <path d={SPARK} />
      </svg>
      <svg
        viewBox="0 0 24 24"
        className="gemini-spark-mini absolute -right-[22%] -top-[22%] size-[42%]"
        fill="currentColor"
      >
        <path d={SPARK} />
      </svg>
    </span>
  );
}

/** "Gemini is ..." status line: animated spark plus a soft blue sweep across the text. */
export function GeminiWorking({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn('flex items-center gap-2.5 text-[14px] font-medium', className)}>
      <GeminiSpark active className="size-4" />
      <span className="gemini-shimmer">{children}</span>
    </p>
  );
}
