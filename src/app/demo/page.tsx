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
  Sparkle,
  WarningCircle,
} from '@phosphor-icons/react';
import AppHeader from '@/components/AppHeader';
import { ButtonLink, Button, Card, SeverityBadge, SourceTag, cn } from '@/components/ui';
import { api, jsonInit, rememberWalk } from '@/lib/client';
import { categoryLabel } from '@/lib/shared';

/**
 * Guided demo. Runs the real product end to end, with real Gemini calls and a real saved walk, so a visitor sees the
 * whole flow without standing in a flat. The only scripted part: photos come from /public/demo instead of a camera.
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
  { room: 'Master Bathroom', src: '/demo/bathroom-tile.jpg', caption: 'Cracked floor tiles beside the shower' },
  { room: 'Kitchen', src: '/demo/kitchen-socket.jpg', caption: 'Scorched socket behind the hob' },
  { room: 'Master Bedroom', src: '/demo/bedroom-paint.jpg', caption: 'Paint flaking off the wall' },
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
interface Result {
  room: string;
  src: string;
  snag?: Snag;
  box?: Box | null;
  source?: string;
}

type Phase = 'walk' | 'checklist' | 'photos' | 'letter' | 'done';
const PHASES: Array<{ key: Phase; label: string; icon: typeof House }> = [
  { key: 'walk', label: 'Set up the flat', icon: House },
  { key: 'checklist', label: 'Gemini writes the checklist', icon: ListChecks },
  { key: 'photos', label: 'Photograph defects, Gemini classifies', icon: Camera },
  { key: 'letter', label: 'Gemini drafts the builder letter', icon: FileText },
];

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function DemoPage() {
  const [phase, setPhase] = useState<Phase>('walk');
  const [caption, setCaption] = useState('Creating a 2 BHK walk with 9 rooms');
  const [walkId, setWalkId] = useState<string | null>(null);
  const [tryRoomId, setTryRoomId] = useState<string | null>(null);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [checklistSource, setChecklistSource] = useState<string | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [active, setActive] = useState<number>(-1);
  const [letter, setLetter] = useState<string | null>(null);
  const [letterSource, setLetterSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const started = useRef(false);
  const alive = useRef(true);
  const t0 = useRef(0);
  const doneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (phase !== 'done') return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    doneRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
  }, [phase]);

  const run = useCallback(async () => {
    setError(null);
    setPhase('walk');
    setResults([]);
    setChecklist([]);
    setLetter(null);
    setActive(-1);
    t0.current = performance.now();
    try {
      // Photos load while the walk is created.
      const photos = Promise.all(
        SHOTS.map(async (s) => {
          const blob = await (await fetch(s.src)).blob();
          return new File([blob], s.src.split('/').pop()!, { type: 'image/jpeg' });
        })
      );

      setCaption('Creating a 2 BHK walk: rooms are set up from the configuration');
      const { walk } = await api<{ walk: { id: string } }>(
        '/api/walks',
        jsonInit('POST', { ...DEMO_WALK, possession_date: new Date().toISOString().slice(0, 10) })
      );
      rememberWalk(walk.id);
      setWalkId(walk.id);
      const { rooms } = await api<{ rooms: Room[] }>(`/api/walks/${walk.id}`);
      const roomId = (name: string) => rooms.find((r) => r.room_name === name)?.id ?? rooms[0].id;
      setTryRoomId(roomId('Living Room'));
      if (!alive.current) return;
      await wait(900);

      setPhase('checklist');
      setCaption('Gemini is writing checks for the master bathroom');
      const cl = await api<{ checklist: ChecklistItem[]; source: string }>(
        `/api/rooms/${roomId('Master Bathroom')}/checklist`
      );
      if (!alive.current) return;
      setChecklist(cl.checklist.slice(0, 6));
      setChecklistSource(cl.source);
      setCaption(`${cl.checklist.length} checks written for this room: slope, grout, fittings, waterproofing`);
      await wait(2600);

      setPhase('photos');
      const files = await photos;
      for (let i = 0; i < SHOTS.length; i++) {
        if (!alive.current) return;
        const shot = SHOTS[i];
        setActive(i);
        setResults((prev) => [...prev, { room: shot.room, src: shot.src }]);
        setCaption(`${shot.room}: Gemini is looking at the photo`);
        const form = new FormData();
        form.append('photo', files[i]);
        const res = await api<{ snag: Snag; box_2d: Box | null; source: string }>(
          `/api/rooms/${roomId(shot.room)}/snags`,
          { method: 'POST', body: form }
        );
        if (!alive.current) return;
        setResults((prev) => prev.map((r, j) => (j === i ? { ...r, snag: res.snag, box: res.box_2d, source: res.source } : r)));
        setCaption(`${shot.room}: ${categoryLabel(res.snag.category)}, ${res.snag.severity}. Saved with the photo.`);
        await wait(2200);
      }

      setPhase('letter');
      setActive(-1);
      setCaption('Gemini is drafting the letter, using only the 3 logged defects');
      const lt = await api<{ letter: string; source: string }>(
        `/api/walks/${walk.id}/letter`,
        jsonInit('POST', { language: 'en' })
      );
      if (!alive.current) return;
      setLetter(lt.letter);
      setLetterSource(lt.source);
      setElapsed(Math.round((performance.now() - t0.current) / 1000));
      setCaption('A dated letter with photo references, RERA Section 14(3) and a 15-day deadline');
      await wait(1200);
      setPhase('done');
    } catch (e) {
      if (alive.current) setError((e as Error).message || 'Something went wrong.');
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    if (!started.current) {
      started.current = true;
      void run();
    }
    return () => {
      alive.current = false;
    };
  }, [run]);

  const phaseIndex = phase === 'done' ? PHASES.length : PHASES.findIndex((p) => p.key === phase);
  const counts = { critical: 0, major: 0, minor: 0 } as Record<string, number>;
  results.forEach((r) => r.snag && (counts[r.snag.severity] = (counts[r.snag.severity] ?? 0) + 1));

  return (
    <div className="min-h-[100dvh]">
      <AppHeader back={{ href: '/', label: 'Home' }} title="Demo" />
      <main id="main" className="mx-auto max-w-6xl px-4 pb-24 pt-6 sm:px-6 sm:pt-10">
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

            <div className="mt-5 lg:hidden" aria-hidden>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-700 ease-out"
                  style={{ width: `${(Math.min(phaseIndex + (phase === 'done' ? 0 : 0.5), PHASES.length) / PHASES.length) * 100}%` }}
                />
              </div>
              <p className="mt-2 text-[13px] font-medium text-ink-2">
                {phase === 'done' ? 'All 4 steps done' : `Step ${phaseIndex + 1} of 4: ${PHASES[phaseIndex]?.label}`}
              </p>
            </div>

            <ol className="mt-7 hidden gap-1 lg:grid" aria-label="Demo steps">
              {PHASES.map((p, i) => {
                const done = i < phaseIndex;
                const current = i === phaseIndex && !error;
                const Icon = p.icon;
                return (
                  <li
                    key={p.key}
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
                      ) : current ? (
                        <CircleNotch className="size-4 animate-spin" weight="bold" />
                      ) : (
                        <Icon className="size-4" />
                      )}
                    </span>
                    {p.label}
                  </li>
                );
              })}
            </ol>

            <p
              role="status"
              aria-live="polite"
              className="mt-4 min-h-[3.5rem] rounded-field lg:mt-6 border border-line bg-surface px-4 py-3 text-[14px] leading-relaxed text-ink-2"
            >
              {error ? (
                <span className="flex items-start gap-2 text-crit">
                  <WarningCircle className="mt-0.5 size-4 shrink-0" weight="fill" />
                  {error}
                </span>
              ) : (
                <span className="flex items-start gap-2">
                  <Sparkle className="mt-0.5 size-4 shrink-0 text-accent" weight="fill" />
                  {caption}
                </span>
              )}
            </p>
            {error && (
              <Button className="mt-3" variant="secondary" icon={<ArrowClockwise className="size-4" weight="bold" />} onClick={run}>
                Run the demo again
              </Button>
            )}

            {results.length > 0 && (
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
            {phase === 'walk' && !error && <StageSkeleton label="Setting up 9 rooms" />}

            {phase === 'checklist' && (
              <Card className="p-5 sm:p-7">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-[18px] font-semibold">Master Bathroom checklist</h2>
                  <SourceTag source={checklistSource} />
                </div>
                {checklist.length === 0 ? (
                  <StageSkeleton label="Gemini is writing checks" bare />
                ) : (
                  <ul className="mt-5 grid gap-2.5">
                    {checklist.map((c, i) => (
                      <li
                        key={c.id}
                        className="demo-in flex items-start gap-3 rounded-field bg-surface-2 px-4 py-3 text-[15px]"
                        style={{ animationDelay: `${i * 120}ms` }}
                      >
                        <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-ink-3/50" />
                        {c.item}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            )}

            {phase === 'photos' && active >= 0 && results[active] && <PhotoStage result={results[active]} caption={SHOTS[active].caption} />}

            {(phase === 'letter' || phase === 'done') && (
              <div className="grid gap-5">
                <div className="grid grid-cols-3 gap-3">
                  {results.map((r) => (
                    <figure key={r.src} className="overflow-hidden rounded-field border border-line bg-surface">
                      <div className="relative aspect-[4/3]">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={r.src} alt="" className="absolute inset-0 size-full object-cover" />
                      </div>
                      <figcaption className="flex items-center justify-between gap-2 px-2.5 py-2 text-[12px]">
                        <span className="truncate text-ink-2">{r.room}</span>
                        {r.snag && <SeverityBadge severity={r.snag.severity} className="h-5 px-2 text-[11px]" />}
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
                    <div className="demo-letter max-h-[420px] overflow-hidden text-[14px] leading-relaxed [mask-image:linear-gradient(to_bottom,black_75%,transparent)]">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{letter}</ReactMarkdown>
                    </div>
                  ) : (
                    <StageSkeleton label="Gemini is drafting from 3 snags" bare />
                  )}
                </div>
              </div>
            )}

            {phase === 'done' && walkId && (
              <Card ref={doneRef} className="demo-in mt-5 scroll-mt-24 p-5 sm:p-6">
                <p className="text-[17px] font-semibold">
                  Done in {elapsed} seconds: 3 defects logged and a letter ready to send.
                </p>
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
              Every result above is computed live by Gemini 3.5 Flash and saved to Firestore. Sample photos: Wikimedia
              Commons, CC BY-SA (<a href="/demo/CREDITS.md" className="underline">credits</a>).
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}

function PhotoStage({ result, caption }: { result: Result; caption: string }) {
  const analyzing = !result.snag;
  const box = result.box;
  return (
    <div className="grid gap-4 sm:grid-cols-5">
      <div className="relative overflow-hidden rounded-card border border-line bg-ink sm:col-span-3">
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={result.src} alt={caption} className="block max-h-[62vh] w-full object-contain" />
          {analyzing && (
            <>
              <div aria-hidden className="absolute inset-0 bg-ink/20" />
              <div aria-hidden className="demo-scan absolute inset-x-0 h-20 bg-gradient-to-b from-transparent via-accent/40 to-transparent">
                <div className="absolute inset-x-0 top-1/2 h-px bg-accent" />
              </div>
            </>
          )}
          {box && !analyzing && (
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
          {result.room}
        </span>
      </div>

      <Card className="p-5 sm:col-span-2">
        {analyzing ? (
          <div className="grid gap-3">
            <p className="flex items-center gap-2 text-[14px] font-medium text-ink-2">
              <Sparkle className="size-4 animate-pulse text-accent" weight="fill" /> Gemini is classifying
            </p>
            <div className="skeleton h-6 w-24 rounded-full" />
            <div className="skeleton h-4 w-full rounded-field" />
            <div className="skeleton h-4 w-4/5 rounded-field" />
            <div className="skeleton h-4 w-3/5 rounded-field" />
          </div>
        ) : (
          <div className="demo-in grid gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={result.snag!.severity} />
              <span className="rounded-full bg-surface-2 px-2.5 py-1 text-[12px] font-medium text-ink-2">
                {categoryLabel(result.snag!.category)}
              </span>
              <SourceTag source={result.source} />
            </div>
            <p className="text-[15px] leading-relaxed text-ink">{result.snag!.description}</p>
            {result.snag!.location_note && (
              <p className="text-[13px] text-ink-3">Where: {result.snag!.location_note}</p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

function StageSkeleton({ label, bare }: { label: string; bare?: boolean }) {
  const body = (
    <div className="grid gap-3" aria-label={label}>
      <p className="flex items-center gap-2 text-[14px] font-medium text-ink-2">
        <CircleNotch className="size-4 animate-spin text-accent" weight="bold" /> {label}
      </p>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="skeleton h-11 rounded-field" style={{ width: `${100 - i * 9}%` }} />
      ))}
    </div>
  );
  return bare ? <div className="mt-5">{body}</div> : <Card className="p-5 sm:p-7">{body}</Card>;
}
