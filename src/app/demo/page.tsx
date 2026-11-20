'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ArrowClockwise,
  ArrowRight,
  Camera,
  Check,
  CircleNotch,
  FileText,
  House,
  ListChecks,
  Pause,
  Play,
  WarningCircle,
} from '@phosphor-icons/react';
import AppHeader from '@/components/AppHeader';
import { GeminiSpark, GeminiWorking } from '@/components/GeminiSpark';
import { ButtonLink, Button, Card, SeverityBadge, SourceTag, cn } from '@/components/ui';
import { api, jsonInit, rememberWalk } from '@/lib/client';
import { categoryLabel } from '@/lib/shared';

/**
 * Guided demo: a step player over the real product. Every result is a live Gemini call and the walk is really saved;
 * the only scripted part is that photos come from /public/demo instead of the camera.
 *
 * Presenter controls: Play/Pause (Space), Next (Right arrow), Restart. While a step is on screen the next ones are
 * already being computed (checklist and all photo analyses start together), so Next is never a long wait.
 */

const DEMO_WALK = {
  buyer_name: 'Ananya Iyer',
  builder: 'Skyline Developers',
  project: 'Palm Grove Residency',
  tower: 'Tower B',
  flat_number: '1402',
  bhk: 2,
};

const SHOTS = [
  { room: 'Master Bathroom', src: '/demo/bathroom-seepage.jpg', caption: 'Seepage stain spreading across the bathroom ceiling' },
  { room: 'Master Bedroom', src: '/demo/bedroom-crack.jpg', caption: 'Crack running from the door frame into the wall' },
  { room: 'Entrance & Passage', src: '/demo/entrance-damp.jpg', caption: 'Damp spots creeping up the corner by the entrance' },
] as const;

type Box = [number, number, number, number];
interface Room {
  id: string;
  room_name: string;
}
interface ChecklistItem {
  id: string;
  item: string;
}
interface Snag {
  id: string;
  category: string;
  severity: string;
  description: string;
  location_note: string | null;
}
interface PhotoResult {
  snag: Snag;
  box_2d: Box | null;
  source: string;
}

// Steps: 0 walk, 1 checklist, 2-4 photos, 5 letter, 6 done.
const LAST = 6;
const PHASES: Array<{ label: string; icon: typeof House; steps: number[] }> = [
  { label: 'Set up the flat', icon: House, steps: [0] },
  { label: 'Gemini writes the checklist', icon: ListChecks, steps: [1] },
  { label: 'Photograph defects, Gemini classifies', icon: Camera, steps: [2, 3, 4] },
  { label: 'Gemini drafts the builder letter', icon: FileText, steps: [5] },
];
const DWELL: Record<number, number> = { 0: 900, 1: 3800, 2: 3800, 3: 3800, 4: 3800, 5: 1800 };
const MIN_SCAN_MS = 1400;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function captionFor(step: number, ready: boolean, photos: Array<PhotoResult | undefined>, checklistCount: number) {
  if (step === 0) return ready ? '2 BHK walk created: 9 rooms set up from the configuration.' : 'Creating the walk and its rooms';
  if (step === 1)
    return ready
      ? `${checklistCount} checks written for the master bathroom: seepage, slope, grout, fittings.`
      : 'Gemini is writing checks for the master bathroom';
  if (step >= 2 && step <= 4) {
    const shot = SHOTS[step - 2];
    const r = photos[step - 2];
    return ready && r
      ? `${shot.room}: ${categoryLabel(r.snag.category)}, ${r.snag.severity}. Saved with the photo.`
      : `${shot.room}: Gemini is looking at the photo`;
  }
  if (step === 5)
    return ready
      ? 'A dated letter with photo references, RERA Section 14(3) and a 15-day deadline.'
      : 'Gemini is drafting the letter, using only the 3 logged defects';
  return 'Done. Open the walk, read the full letter, or add a defect with your own photo.';
}

export default function DemoPage() {
  const [step, setStep] = useState(0);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [queued, setQueued] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState(0);

  const [walkId, setWalkId] = useState<string | null>(null);
  const [tryRoomId, setTryRoomId] = useState<string | null>(null);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [checklistSource, setChecklistSource] = useState<string | null>(null);
  const [photos, setPhotos] = useState<Array<PhotoResult | undefined>>([]);
  const [letter, setLetter] = useState<string | null>(null);
  const [letterSource, setLetterSource] = useState<string | null>(null);

  // Work started at walk creation and awaited step by step.
  const work = useRef<{
    walkId?: string;
    checklist?: Promise<{ checklist: ChecklistItem[]; source: string }>;
    photos?: Array<Promise<PhotoResult>>;
  }>({});
  const doneRef = useRef<HTMLDivElement>(null);

  // Preload the photos so every switch is instant.
  useEffect(() => {
    SHOTS.forEach((s) => {
      const img = new Image();
      img.src = s.src;
    });
  }, []);

  // Run the work for the current step. Re-runs on restart (runId).
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setError(null);
    (async () => {
      try {
        if (step === 0) {
          const { walk } = await api<{ walk: { id: string } }>(
            '/api/walks',
            jsonInit('POST', { ...DEMO_WALK, possession_date: new Date().toISOString().slice(0, 10) })
          );
          if (cancelled) return;
          rememberWalk(walk.id);
          work.current.walkId = walk.id;
          setWalkId(walk.id);
          const { rooms } = await api<{ rooms: Room[] }>(`/api/walks/${walk.id}`);
          const roomId = (name: string) => rooms.find((r) => r.room_name === name)?.id ?? rooms[0].id;
          setTryRoomId(roomId('Living Room'));
          // Start everything that does not depend on order: checklist and all three photo analyses.
          work.current.checklist = api(`/api/rooms/${roomId('Master Bathroom')}/checklist`);
          work.current.photos = SHOTS.map(async (shot) => {
            const blob = await (await fetch(shot.src)).blob();
            const form = new FormData();
            form.append('photo', new File([blob], shot.src.split('/').pop()!, { type: 'image/jpeg' }));
            return api<PhotoResult>(`/api/rooms/${roomId(shot.room)}/snags`, { method: 'POST', body: form });
          });
          // Each step awaits its own promise; this keeps unhandled-rejection noise out of the console.
          work.current.checklist.catch(() => {});
          work.current.photos.forEach((p) => p.catch(() => {}));
        } else if (step === 1) {
          const cl = await work.current.checklist!;
          if (cancelled) return;
          setChecklist(cl.checklist.slice(0, 6));
          setChecklistSource(cl.source);
        } else if (step >= 2 && step <= 4) {
          const i = step - 2;
          const [res] = await Promise.all([work.current.photos![i], wait(MIN_SCAN_MS)]);
          if (cancelled) return;
          setPhotos((prev) => {
            const next = [...prev];
            next[i] = res;
            return next;
          });
        } else if (step === 5) {
          await Promise.all(work.current.photos!);
          const lt = await api<{ letter: string; source: string }>(
            `/api/walks/${work.current.walkId}/letter`,
            jsonInit('POST', { language: 'en' })
          );
          if (cancelled) return;
          setLetter(lt.letter);
          setLetterSource(lt.source);
        }
        if (!cancelled) setReady(true);
      } catch (e) {
        if (!cancelled) setError((e as Error).message || 'Something went wrong.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [step, runId]);

  const advance = useCallback(() => {
    setQueued(false);
    setStep((s) => Math.min(LAST, s + 1));
  }, []);

  // Autoplay: advance after the dwell time once the step is ready. Next pressed early advances as soon as ready.
  useEffect(() => {
    if (!ready || step >= LAST) return;
    if (queued) {
      advance();
      return;
    }
    if (!playing) return;
    const t = setTimeout(advance, DWELL[step] ?? 2500);
    return () => clearTimeout(t);
  }, [ready, playing, queued, step, advance]);

  const next = useCallback(() => {
    if (step >= LAST) return;
    if (ready) advance();
    else setQueued(true);
  }, [ready, step, advance]);

  const restart = () => {
    work.current = {};
    setWalkId(null);
    setChecklist([]);
    setPhotos([]);
    setLetter(null);
    setQueued(false);
    setPlaying(true);
    setStep(0);
    setRunId((n) => n + 1);
  };

  // Presenter keys: Space play/pause, Right arrow next.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === ' ' && t?.tagName !== 'BUTTON' && t?.tagName !== 'A') {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next]);

  useEffect(() => {
    if (step !== LAST) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    doneRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
  }, [step]);

  const phaseIndex = step >= LAST ? PHASES.length : PHASES.findIndex((p) => p.steps.includes(step));
  const shown = photos.filter((_, i) => i + 2 < step || (i + 2 === step && ready));
  const counts = { critical: 0, major: 0, minor: 0 } as Record<string, number>;
  shown.forEach((r) => r && (counts[r.snag.severity] = (counts[r.snag.severity] ?? 0) + 1));
  const caption = captionFor(step, ready, photos, checklist.length);
  const photoIndex = step >= 2 && step <= 4 ? step - 2 : -1;

  return (
    <div className="min-h-[100dvh]">
      <AppHeader back={{ href: '/', label: 'Home' }} title="Demo" />
      <main id="main" className="mx-auto max-w-6xl px-4 pb-36 pt-6 sm:px-6 sm:pt-10">
        <div className="grid gap-8 lg:grid-cols-12 lg:gap-12">
          {/* Narration */}
          <section className="lg:col-span-4">
            <p className="text-[13px] font-medium uppercase tracking-[0.08em] text-accent">Live demo</p>
            <h1 className="mt-2 text-[clamp(1.6rem,4vw,2.4rem)] font-semibold leading-[1.08] tracking-[-0.03em]">
              Flat 1402, Tower B
            </h1>
            <p className="mt-2 text-[15px] text-ink-2">
              {DEMO_WALK.project}, {DEMO_WALK.builder}. 2 BHK, inspected today.
            </p>

            <ol className="mt-7 hidden gap-1 lg:grid" aria-label="Demo steps">
              {PHASES.map((p, i) => {
                const done = i < phaseIndex;
                const current = i === phaseIndex && !error;
                const Icon = p.icon;
                const working = current && !ready;
                return (
                  <li
                    key={p.label}
                    aria-current={current ? 'step' : undefined}
                    className={cn(
                      'flex items-center gap-3 rounded-field px-3 py-2.5 text-[15px] transition-colors duration-300',
                      current ? 'bg-accent-soft font-medium text-ink' : done ? 'text-ink-2' : 'text-ink-3'
                    )}
                  >
                    <span
                      className={cn(
                        'grid size-8 shrink-0 place-items-center rounded-full border transition-colors duration-300',
                        done ? 'border-transparent bg-accent text-accent-ink' : current ? 'border-accent text-accent' : 'border-line'
                      )}
                    >
                      {done ? (
                        <Check className="size-4" weight="bold" />
                      ) : working ? (
                        <CircleNotch className="size-4 animate-spin" weight="bold" />
                      ) : (
                        <Icon className="size-4" weight={current ? 'bold' : 'regular'} />
                      )}
                    </span>
                    <span className="flex-1">{p.label}</span>
                    {i === 2 && current && <span className="tabular text-[12px] text-ink-3">{photoIndex + 1}/3</span>}
                  </li>
                );
              })}
            </ol>

            <p
              role="status"
              aria-live="polite"
              className="mt-5 min-h-[3.5rem] rounded-field border border-line bg-surface px-4 py-3 text-[14px] leading-relaxed text-ink-2 lg:mt-6"
            >
              {error ? (
                <span className="flex items-start gap-2 text-crit">
                  <WarningCircle className="mt-0.5 size-4 shrink-0" weight="fill" />
                  {error}
                </span>
              ) : (
                <span className="flex items-start gap-2">
                  <GeminiSpark active={!ready} className="mt-0.5 size-4" />
                  {caption}
                </span>
              )}
            </p>
            {error && (
              <Button className="mt-3" variant="secondary" icon={<ArrowClockwise className="size-4" weight="bold" />} onClick={restart}>
                Run the demo again
              </Button>
            )}

            {shown.length > 0 && (
              <dl className="mt-6 hidden grid-cols-3 gap-2 text-center lg:grid">
                {(['critical', 'major', 'minor'] as const).map((s) => (
                  <div key={s} className="rounded-field border border-line bg-surface px-2 py-3">
                    <dd
                      className={cn(
                        'tabular text-[26px] font-semibold leading-none',
                        s === 'critical' ? 'text-crit' : s === 'major' ? 'text-major' : 'text-ink-2'
                      )}
                    >
                      {counts[s]}
                    </dd>
                    <dt className="mt-1.5 text-[12px] capitalize text-ink-3">{s}</dt>
                  </div>
                ))}
              </dl>
            )}
          </section>

          {/* Stage */}
          <section className="lg:col-span-8" aria-label="What the app is doing">
            {step === 0 && !error && <StageSkeleton label="Setting up 9 rooms" />}

            {step === 1 && (
              <Card className="p-5 sm:p-7">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-[18px] font-semibold">Master Bathroom checklist</h2>
                  <SourceTag source={checklistSource} />
                </div>
                {!ready ? (
                  <StageSkeleton label="Gemini is writing checks" bare />
                ) : (
                  <ul className="mt-5 grid gap-2.5">
                    {checklist.map((c, i) => (
                      <li
                        key={c.id}
                        className="demo-in flex items-start gap-3 rounded-field bg-surface-2 px-4 py-3 text-[15px]"
                        style={{ animationDelay: `${i * 110}ms` }}
                      >
                        <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-ink-3/50" />
                        {c.item}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            )}

            {photoIndex >= 0 && (
              <PhotoStage
                key={photoIndex}
                room={SHOTS[photoIndex].room}
                src={SHOTS[photoIndex].src}
                caption={SHOTS[photoIndex].caption}
                result={ready ? photos[photoIndex] : undefined}
              />
            )}

            {step >= 5 && (
              <div className="grid gap-5">
                <div className="grid grid-cols-3 gap-3">
                  {SHOTS.map((s, i) => (
                    <figure key={s.src} className="overflow-hidden rounded-field border border-line bg-surface">
                      <div className="relative aspect-[4/3]">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={s.src} alt="" className="absolute inset-0 size-full object-cover" />
                      </div>
                      <figcaption className="flex items-center justify-between gap-2 px-2.5 py-2 text-[12px]">
                        <span className="truncate text-ink-2">{s.room}</span>
                        {photos[i] && <SeverityBadge severity={photos[i]!.snag.severity} className="h-5 px-2 text-[11px]" />}
                      </figcaption>
                    </figure>
                  ))}
                </div>

                <div className="paper relative overflow-hidden rounded-card p-6 shadow-paper sm:p-9">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <span className="text-[12px] font-medium uppercase tracking-[0.08em] text-ink-3">Builder letter</span>
                    <SourceTag source={letterSource} />
                  </div>
                  {letter ? (
                    <div className="demo-in demo-letter max-h-[420px] overflow-hidden text-[14px] leading-relaxed [mask-image:linear-gradient(to_bottom,black_75%,transparent)]">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{letter}</ReactMarkdown>
                    </div>
                  ) : (
                    <StageSkeleton label="Gemini is drafting from 3 snags" bare />
                  )}
                </div>
              </div>
            )}

            {step === LAST && walkId && (
              <Card ref={doneRef} className="demo-in mt-5 scroll-mt-24 p-5 sm:p-6">
                <p className="text-[17px] font-semibold">3 defects logged and a letter ready to send.</p>
                <p className="mt-1 text-[14px] text-ink-2">
                  This walk is saved. Open it, change anything, or add a defect with your own photo.
                </p>
                <div className="mt-4 flex flex-wrap gap-2.5">
                  {tryRoomId && (
                    <ButtonLink href={`/walks/${walkId}/rooms/${tryRoomId}/snag`}>
                      <Camera className="size-5" weight="bold" />
                      Try it with your photo
                    </ButtonLink>
                  )}
                  <ButtonLink href={`/walks/${walkId}/letter`} variant="secondary">
                    Full letter, PDF and WhatsApp
                  </ButtonLink>
                  <ButtonLink href={`/walks/${walkId}`} variant="ghost">
                    Open the walk <ArrowRight className="size-4" weight="bold" />
                  </ButtonLink>
                </div>
              </Card>
            )}

            <p className="mt-6 text-[12px] text-ink-3">
              Every result above is computed live by Gemini 3.5 Flash on Vertex AI and saved to Cloud Firestore. Photo
              sources:{' '}
              <a href="/demo/CREDITS.md" className="underline">
                credits
              </a>
              .
            </p>
          </section>
        </div>
      </main>

      {/* Presenter controls */}
      <div className="no-print fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[max(16px,env(safe-area-inset-bottom))]">
        <div className="flex w-full max-w-md items-center gap-2 rounded-full border border-line bg-surface/90 p-1.5 shadow-lift backdrop-blur-xl">
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            disabled={step >= LAST}
            aria-label={playing ? 'Pause demo' : 'Play demo'}
            aria-keyshortcuts="Space"
            className="grid size-11 shrink-0 place-items-center rounded-full bg-ink text-bg transition-transform active:scale-95 disabled:opacity-40"
          >
            {playing && step < LAST ? <Pause className="size-5" weight="fill" /> : <Play className="size-5" weight="fill" />}
          </button>
          <div className="min-w-0 flex-1 px-1">
            <div className="h-1 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
                style={{ width: `${((step + (ready ? 1 : 0.5)) / (LAST + 1)) * 100}%` }}
              />
            </div>
            <p className="mt-1 truncate text-[12px] text-ink-2">
              {step >= LAST ? 'Demo complete' : `Step ${step + 1} of ${LAST}${playing ? '' : ', paused'}`}
              {queued && !ready ? ', next when ready' : ''}
            </p>
          </div>
          {step >= LAST ? (
            <Button size="sm" variant="secondary" onClick={restart} icon={<ArrowClockwise className="size-4" weight="bold" />}>
              Restart
            </Button>
          ) : (
            <Button size="sm" onClick={next} aria-keyshortcuts="ArrowRight" className="h-11 px-4">
              Next <ArrowRight className="size-4" weight="bold" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function PhotoStage({ room, src, caption, result }: { room: string; src: string; caption: string; result?: PhotoResult }) {
  const box = result?.box_2d;
  return (
    <div className="demo-in grid gap-4 sm:grid-cols-5">
      <div className="relative overflow-hidden rounded-card border border-line bg-ink sm:col-span-3">
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={caption} className="block max-h-[62vh] w-full object-contain" />
          {!result && (
            <>
              <div aria-hidden className="absolute inset-0 bg-ink/20" />
              <div aria-hidden className="demo-scan absolute inset-x-0 h-20 bg-gradient-to-b from-transparent via-accent/40 to-transparent">
                <div className="absolute inset-x-0 top-1/2 h-px bg-accent" />
              </div>
            </>
          )}
          {box && (
            <div
              className="demo-box pointer-events-none absolute rounded-md border-2 border-white shadow-[0_0_0_9999px_rgb(0_0_0/0.35)]"
              style={{
                top: `${box[0] / 10}%`,
                left: `${box[1] / 10}%`,
                height: `${(box[2] - box[0]) / 10}%`,
                width: `${(box[3] - box[1]) / 10}%`,
              }}
            />
          )}
        </div>
        <span className="absolute left-3 top-3 rounded-full bg-black/60 px-3 py-1 text-[12px] font-medium text-white backdrop-blur">
          {room}
        </span>
      </div>

      <Card className="p-5 sm:col-span-2">
        {!result ? (
          <div className="grid gap-3">
            <GeminiWorking>Gemini 3.5 Flash is classifying</GeminiWorking>
            <div className="skeleton h-6 w-24 rounded-full" />
            <div className="skeleton h-4 w-full rounded-field" />
            <div className="skeleton h-4 w-4/5 rounded-field" />
            <div className="skeleton h-4 w-3/5 rounded-field" />
          </div>
        ) : (
          <div className="demo-in grid gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={result.snag.severity} />
              <span className="rounded-full bg-surface-2 px-2.5 py-1 text-[12px] font-medium text-ink-2">
                {categoryLabel(result.snag.category)}
              </span>
              <SourceTag source={result.source} />
            </div>
            <p className="text-[15px] leading-relaxed text-ink">{result.snag.description}</p>
            {result.snag.location_note && <p className="text-[13px] text-ink-3">Where: {result.snag.location_note}</p>}
          </div>
        )}
      </Card>
    </div>
  );
}

function StageSkeleton({ label, bare }: { label: string; bare?: boolean }) {
  const body = (
    <div className="grid gap-3" aria-label={label}>
      {label.startsWith('Gemini') ? (
        <GeminiWorking>{label}</GeminiWorking>
      ) : (
        <p className="flex items-center gap-2 text-[14px] font-medium text-ink-2">
          <CircleNotch className="size-4 animate-spin text-accent" weight="bold" /> {label}
        </p>
      )}
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="skeleton h-11 rounded-field" style={{ width: `${100 - i * 9}%` }} />
      ))}
    </div>
  );
  return bare ? <div className="mt-5">{body}</div> : <Card className="p-5 sm:p-7">{body}</Card>;
}
