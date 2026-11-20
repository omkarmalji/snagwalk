'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import ReactMarkdown, { type Components } from 'react-markdown';
import { computePageBreaks } from '@/lib/pdf-breaks';
import remarkGfm from 'remark-gfm';
import {
  ArrowClockwise,
  Check,
  Copy,
  DownloadSimple,
  ShareNetwork,
  Sparkle,
  WarningCircle,
} from '@phosphor-icons/react';
import AppHeader from '@/components/AppHeader';
import { Button, Card, SeverityBadge, Skeleton, SourceTag, cn } from '@/components/ui';
import { api, formatDate, jsonInit, toWhatsAppText } from '@/lib/client';
import { gsap, useGSAP, useReveal, prefersReducedMotion, EASE } from '@/lib/motion';
import { LETTER_LANGUAGES, categoryLabel, photoSrc, type LetterLanguage } from '@/lib/shared';

interface Snag {
  id: string;
  room_name: string;
  category: string;
  severity: string;
  description: string;
  location_note: string | null;
  photo_url: string;
  photo_number: number;
}

interface Walk {
  buyer_name: string;
  builder: string;
  project: string;
  tower: string;
  flat_number: string;
  possession_date: string;
}

interface LetterResponse {
  walk: Walk;
  snags: Snag[];
  letter: string | null;
  source: 'gemini' | 'fallback' | null;
  language: LetterLanguage;
  stale: boolean;
}

const md: Components = {
  h1: (p) => <h3 className="mb-3 mt-7 text-[17px] font-semibold tracking-tight" {...p} />,
  h2: (p) => <h3 className="mb-3 mt-7 text-[17px] font-semibold tracking-tight" {...p} />,
  h3: (p) => (
    <h4 className="mb-2 mt-6 border-b border-line pb-1.5 text-[15px] font-semibold tracking-tight" {...p} />
  ),
  h4: (p) => <h5 className="mb-2 mt-5 text-[14px] font-semibold" {...p} />,
  p: (p) => <p className="my-3 text-[14.5px] leading-[1.7]" {...p} />,
  ul: (p) => <ul className="my-3 space-y-2 pl-0" {...p} />,
  ol: (p) => <ol className="my-3 list-decimal space-y-2 pl-5" {...p} />,
  // The bullet is a text glyph, not a positioned box: html2canvas draws text a few px lower than the browser,
  // so only a glyph stays on the same baseline as the words in the exported PDF.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  li: ({ children, node, ...p }) => (
    <li className="flex gap-2.5 text-[14.5px] leading-[1.65]" {...p}>
      <span aria-hidden className="w-2 shrink-0 select-none text-ink-3">
        •
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </li>
  ),
  strong: (p) => <strong className="font-semibold text-ink" {...p} />,
  hr: () => <hr className="my-6 border-line" />,
  table: (p) => (
    <div className="my-4 overflow-x-auto">
      <table className="w-full border-collapse text-[13.5px]" {...p} />
    </div>
  ),
  th: (p) => <th className="border-b border-line px-2 py-2 text-left font-semibold" {...p} />,
  td: (p) => <td className="border-b border-line px-2 py-2 align-top" {...p} />,
};

export default function LetterPage() {
  const { walkId } = useParams<{ walkId: string }>();
  const scope = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  const [data, setData] = useState<LetterResponse | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [language, setLanguage] = useState<LetterLanguage>('en');
  const languageRef = useRef<LetterLanguage>('en');

  const generate = useCallback(async (lang?: LetterLanguage) => {
    const target = lang ?? languageRef.current;
    languageRef.current = target;
    setLanguage(target);
    setGenerating(true);
    setError(null);
    try {
      setData(await api<LetterResponse>(`/api/walks/${walkId}/letter`, jsonInit('POST', { language: target })));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }, [walkId]);

  useEffect(() => {
    if (started.current) return; // StrictMode runs effects twice in dev; generate once.
    started.current = true;
    api<LetterResponse>(`/api/walks/${walkId}/letter`)
      .then((d) => {
        setData(d);
        languageRef.current = d.language;
        setLanguage(d.language);
        if (!d.letter || d.stale) generate(d.language);
      })
      .catch((e) => setError((e as Error).message));
  }, [walkId, generate]);

  useReveal(scope, [Boolean(data)]);

  // Storytelling: the letter assembles block by block once Gemini returns it.
  useGSAP(
    () => {
      if (generating || !data?.letter || !bodyRef.current || prefersReducedMotion()) return;
      gsap.fromTo(
        bodyRef.current.children,
        { autoAlpha: 0, y: 8 },
        { autoAlpha: 1, y: 0, duration: 0.5, ease: EASE, stagger: 0.035 }
      );
    },
    { dependencies: [generating, data?.letter], scope: bodyRef }
  );

  const snags = data?.snags ?? [];
  const counts = {
    critical: snags.filter((s) => s.severity === 'critical').length,
    major: snags.filter((s) => s.severity === 'major').length,
    minor: snags.filter((s) => s.severity === 'minor').length,
  };
  const ready = Boolean(data?.letter) && !generating;

  async function copy() {
    if (!data?.letter) return;
    await navigator.clipboard.writeText(toWhatsAppText(data.letter));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function share() {
    if (!data?.letter) return;
    const text = toWhatsAppText(data.letter);
    if (navigator.share) {
      try {
        await navigator.share({ title: `Snag notice, Flat ${data.walk.flat_number}`, text });
        return;
      } catch {
        // cancelled
      }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  }

  async function downloadPdf() {
    if (!paperRef.current || !data) return;
    setDownloading(true);
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);

      // Layout in CSS px at A4 width (794px = 210mm). Every page gets the same top and bottom margin.
      const A4_W = 794;
      const A4_H = Math.floor((A4_W * 297) / 210);
      const MARGIN = 56;
      const usable = A4_H - 2 * MARGIN;
      // Blocks that must never be split across pages: their [top, bottom] in the cloned layout.
      let blocks: Array<[number, number]> = [];

      const canvas = await html2canvas(paperRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#fffffd',
        logging: false,
        // Lay the document out at A4 width whatever the device, so a phone and a laptop produce the same PDF.
        windowWidth: 1024,
        onclone: (_doc, el) => {
          Object.assign(el.style, { width: `${A4_W}px`, padding: '8px 72px', borderRadius: '0', boxShadow: 'none' });
          const origin = el.getBoundingClientRect().top;
          blocks = Array.from(el.querySelectorAll('p, li, h1, h2, h3, h4, figure, tr, blockquote, hr, [data-pdf-keep]')).map((n) => {
            const r = n.getBoundingClientRect();
            // Headings travel with the block after them, so a heading never ends a page on its own.
            const keepWithNext = /^H[1-4]$/.test(n.tagName) || n.hasAttribute('data-pdf-keep');
            const next = keepWithNext ? n.nextElementSibling : null;
            const bottom = next ? Math.max(r.bottom, next.getBoundingClientRect().bottom) : r.bottom;
            return [r.top - origin, bottom - origin];
          });
        },
      });

      // Break each page at the last block boundary that fits, so text lines and photos are never cut in half.
      const totalH = canvas.height / (canvas.width / A4_W);
      const breaks = computePageBreaks(blocks, totalH, usable);

      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageW = pdf.internal.pageSize.getWidth();
      const mmPerCss = pageW / A4_W;
      const scale = canvas.width / A4_W;
      breaks.forEach(([from, to], page) => {
        const slice = document.createElement('canvas');
        slice.width = canvas.width;
        slice.height = Math.max(1, Math.round((to - from) * scale));
        const ctx = slice.getContext('2d')!;
        ctx.fillStyle = '#fffffd';
        ctx.fillRect(0, 0, slice.width, slice.height);
        ctx.drawImage(canvas, 0, Math.round(from * scale), canvas.width, slice.height, 0, 0, canvas.width, slice.height);
        if (page > 0) pdf.addPage();
        pdf.setFillColor(255, 255, 253);
        pdf.rect(0, 0, pageW, pdf.internal.pageSize.getHeight(), 'F');
        pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', 0, MARGIN * mmPerCss, pageW, (to - from) * mmPerCss);
      });
      pdf.save(`Snag-notice-Flat-${data.walk.flat_number}-${data.walk.tower}.pdf`.replace(/\s+/g, '-'));
    } catch (err) {
      console.error('PDF export failed, using print dialog:', err);
      window.print();
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div ref={scope} className="min-h-[100dvh]">
      <AppHeader back={{ href: `/walks/${walkId}`, label: 'Rooms' }} title="Builder letter" />

      <main id="main" className="mx-auto max-w-6xl px-4 pb-32 pt-6 sm:px-6 lg:pb-20 lg:pt-10">
        <div className="grid gap-8 lg:grid-cols-12 lg:gap-12">
          <aside className="no-print min-w-0 lg:order-2 lg:col-span-4">
            <div className="lg:sticky lg:top-24">
              <div data-reveal>
                <h1 className="text-[30px] font-semibold tracking-[-0.03em] sm:text-[36px]">Builder letter</h1>
                <p className="mt-1 text-[15px] text-ink-2">
                  {data ? `To ${data.walk.builder}. Asks for every defect to be fixed within 15 days.` : ' '}
                </p>
              </div>

              <Card data-reveal className="mt-6 grid grid-cols-4 divide-x divide-line">
                <Count label="Total" value={snags.length} />
                <Count label="Critical" value={counts.critical} tone="text-crit" />
                <Count label="Major" value={counts.major} tone="text-major" />
                <Count label="Minor" value={counts.minor} tone="text-ink-2" />
              </Card>

              <fieldset data-reveal className="mt-4 min-w-0">
                <legend className="label">Letter language</legend>
                <div className="grid grid-cols-3 gap-1 rounded-full border border-line bg-surface-2 p-1">
                  {LETTER_LANGUAGES.map((l) => (
                    <button
                      key={l.value}
                      type="button"
                      lang={l.value}
                      aria-pressed={language === l.value}
                      disabled={generating}
                      onClick={() => l.value !== language && generate(l.value)}
                      className={cn(
                        'h-10 rounded-full text-[14px] font-medium transition-colors duration-200 disabled:cursor-wait',
                        language === l.value ? 'bg-surface text-ink shadow-lift' : 'text-ink-2 hover:text-ink'
                      )}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              </fieldset>

              <div data-reveal className="mt-4 hidden flex-col gap-2 lg:flex">
                <Button size="lg" onClick={downloadPdf} loading={downloading} disabled={!ready} className="w-full">
                  {!downloading && <DownloadSimple className="size-5" weight="bold" />}
                  Download PDF
                </Button>
                <SecondaryActions ready={ready} copied={copied} generating={generating} onShare={share} onCopy={copy} onRegenerate={() => generate()} />
              </div>

              <div data-reveal className="mt-4 flex items-center gap-2 text-[13px] text-ink-2">
                {generating ? (
                  <span>Drafting from {snags.length} recorded snags</span>
                ) : (
                  data?.source && (
                    <>
                      <SourceTag source={data.source} />
                      <span>
                        {data.source === 'gemini'
                          ? 'Written from your recorded snags only'
                          : language === 'en'
                            ? 'Gemini unavailable, standard template used'
                            : 'Gemini unavailable, standard English template used'}
                      </span>
                    </>
                  )
                )}
              </div>

              <div className="mt-4 lg:hidden">
                <SecondaryActions ready={ready} copied={copied} generating={generating} onShare={share} onCopy={copy} onRegenerate={() => generate()} />
              </div>
            </div>
          </aside>

          <section className="min-w-0 lg:order-1 lg:col-span-8">
            {error && (
              <div className="mb-4 flex items-start gap-3 rounded-card bg-crit-soft p-4 text-crit">
                <WarningCircle className="mt-0.5 size-5 shrink-0" weight="fill" />
                <div className="flex-1 text-[14px]">
                  <p className="font-medium">{error}</p>
                  <button type="button" onClick={() => generate()} className="mt-1 font-semibold underline underline-offset-2">
                    Try again
                  </button>
                </div>
              </div>
            )}

            <article
              ref={paperRef}
              data-reveal
              lang={language === 'en' ? 'en-IN' : language}
              className="paper rounded-[6px] px-6 py-8 shadow-paper ring-1 ring-black/5 sm:px-12 sm:py-12"
            >
              {!ready ? (
                <PaperSkeleton count={snags.length} generating={generating || !data} />
              ) : (
                <>
                  <div ref={bodyRef} className="text-ink">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={md}>
                      {data!.letter!}
                    </ReactMarkdown>
                  </div>

                  {snags.length > 0 && (
                    <section className="mt-10 border-t-2 border-ink pt-6">
                      <div data-pdf-keep>
                        <h3 className="text-[15px] font-semibold tracking-tight">Annexure: photographs</h3>
                        <p className="mt-1 text-[13px] text-ink-2">
                          Flat {data!.walk.flat_number}, {data!.walk.tower}, {data!.walk.project}. Inspected{' '}
                          {formatDate(data!.walk.possession_date)}.
                        </p>
                      </div>
                      <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
                        {snags.map((s) => (
                          <figure key={s.id} className="break-inside-avoid">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={photoSrc(s.photo_url)}
                              alt={`Photo ${s.photo_number}: ${s.description}`}
                              crossOrigin="anonymous"
                              className="aspect-[4/3] w-full rounded-[4px] bg-surface-2 object-cover"
                            />
                            <figcaption className="mt-2">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[13px] font-semibold">Photo #{s.photo_number}</span>
                                <SeverityBadge severity={s.severity} className="h-5 px-2 text-[11px]" />
                              </div>
                              <p className="mt-0.5 text-[12px] text-ink-2">
                                {s.room_name}, {categoryLabel(s.category).toLowerCase()}
                              </p>
                            </figcaption>
                          </figure>
                        ))}
                      </div>
                    </section>
                  )}

                  <p className="mt-10 text-[11px] text-ink-3">Prepared with SnagWalk on {formatDate(new Date().toISOString())}.</p>
                </>
              )}
            </article>
          </section>
        </div>
      </main>

      <div className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/90 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl lg:hidden">
        <Button size="lg" onClick={downloadPdf} loading={downloading} disabled={!ready} className="w-full">
          {!downloading && <DownloadSimple className="size-5" weight="bold" />}
          Download PDF
        </Button>
      </div>
    </div>
  );
}

function Count({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="px-3 py-4 text-center">
      <p className={cn('tabular text-[24px] font-semibold leading-none tracking-tight', tone)}>{value}</p>
      <p className="mt-1.5 text-[12px] text-ink-3">{label}</p>
    </div>
  );
}

function SecondaryActions({
  ready,
  copied,
  generating,
  onShare,
  onCopy,
  onRegenerate,
}: {
  ready: boolean;
  copied: boolean;
  generating: boolean;
  onShare: () => void;
  onCopy: () => void;
  onRegenerate: () => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <Button variant="secondary" onClick={onShare} disabled={!ready} className="px-2">
        <ShareNetwork className="size-[18px]" />
        Share
      </Button>
      <Button variant="secondary" onClick={onCopy} disabled={!ready} className="px-2">
        {copied ? <Check className="size-[18px] text-ok" weight="bold" /> : <Copy className="size-[18px]" />}
        {copied ? 'Copied' : 'Copy'}
      </Button>
      <Button variant="secondary" onClick={onRegenerate} disabled={generating} className="px-2">
        <ArrowClockwise className={cn('size-[18px]', generating && 'animate-spin')} />
        Redo
      </Button>
    </div>
  );
}

function PaperSkeleton({ count, generating }: { count: number; generating: boolean }) {
  return (
    <div aria-label="Drafting letter">
      {generating && (
        <p className="mb-6 flex items-center gap-2 text-[14px] font-medium text-ink-2">
          <Sparkle className="size-4 animate-pulse text-accent" weight="fill" />
          Gemini is drafting your letter{count ? ` from ${count} ${count === 1 ? 'snag' : 'snags'}` : ''}
        </p>
      )}
      <Skeleton className="h-3 w-28" />
      <Skeleton className="mt-6 h-3 w-48" />
      <Skeleton className="mt-2 h-3 w-40" />
      <Skeleton className="mt-8 h-4 w-3/4" />
      <div className="mt-6 space-y-2.5">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className={cn('h-3', i === 3 ? 'w-2/3' : 'w-full')} />
        ))}
      </div>
      <Skeleton className="mt-8 h-3.5 w-36" />
      <div className="mt-4 space-y-2.5">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className={cn('h-3', i === 2 ? 'w-1/2' : 'w-11/12')} />
        ))}
      </div>
    </div>
  );
}
