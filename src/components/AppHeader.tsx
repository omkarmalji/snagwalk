'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft } from '@phosphor-icons/react';
import { cn } from '@/components/ui';
import BrandLogo from '@/components/BrandLogo';

interface Health {
  ai: { live: boolean; model: string; lastError: string | null; lastOk: string | null };
  db: { mode: string };
  storage: { mode: string };
}

/** Shows whether Gemini and the database are live. Real semantic state, refreshed on each page load. */
function SystemStatus() {
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/health')
      .then((r) => r.json())
      .then((h) => !cancelled && setHealth(h))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  if (!health) return null;

  const aiKnown = health.ai.lastOk || health.ai.lastError;
  const aiOk = health.ai.live;
  const localDb = health.db.mode === 'local';
  const model = health.ai.model.replace(/^gemini-/i, 'Gemini ').replace(/-/g, ' ').replace(/\b(flash|pro|lite|preview)\b/gi, (w) => w[0].toUpperCase() + w.slice(1));
  const label = !aiKnown ? model : aiOk ? `${model} live` : 'AI offline';
  const title = [
    `AI: ${health.ai.model}${health.ai.lastError && !aiOk ? ` (last error: ${health.ai.lastError})` : ''}`,
    `Database: ${localDb ? 'local dev store' : health.db.mode}`,
    `Photos: ${health.storage.mode}`,
  ].join('\n');

  return (
    <span
      title={title}
      className="hidden items-center gap-2 rounded-full border border-line px-3 py-1.5 text-[12px] font-medium text-ink-2 sm:inline-flex"
    >
      <span
        className={cn('size-1.5 rounded-full', !aiKnown ? 'bg-ink-3' : aiOk ? 'bg-ok' : 'bg-major')}
        aria-hidden
      />
      {label}
      {localDb && <span className="text-ink-3">Local DB</span>}
    </span>
  );
}

export default function AppHeader({
  back,
  title,
  right,
  overlay,
}: {
  back?: { href: string; label: string };
  title?: ReactNode;
  right?: ReactNode;
  /** Over a full-bleed background (landing): the backdrop shows through. */
  overlay?: boolean;
}) {
  return (
    <header
      className={cn(
        'no-print sticky top-0 z-30 border-b backdrop-blur-xl',
        overlay
          ? 'border-white/[0.07] bg-bg/25 supports-[backdrop-filter]:bg-bg/20'
          : 'border-line/70 bg-bg/80 supports-[backdrop-filter]:bg-bg/70'
      )}
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-full focus:bg-accent focus:px-4 focus:py-2 focus:text-[14px] focus:font-medium focus:text-accent-ink"
      >
        Skip to content
      </a>
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
        {back ? (
          <Link
            href={back.href}
            className="-ml-2 inline-flex h-11 items-center gap-1.5 rounded-full px-2 text-[15px] font-medium text-ink-2 transition-colors hover:text-ink"
          >
            <ArrowLeft className="size-5" weight="bold" />
            <span className="max-w-[40vw] truncate">{back.label}</span>
          </Link>
        ) : (
          <Link href="/" className="flex items-center gap-2.5" aria-label="SnagWalk home">
            <BrandLogo />
          </Link>
        )}
        {title && <div className="min-w-0 flex-1 truncate text-center text-[15px] font-semibold sm:hidden">{title}</div>}
        <div className="ml-auto flex items-center gap-2">
          <SystemStatus />
          {right}
        </div>
      </div>
    </header>
  );
}
