'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, CalendarBlank, Camera, FileText, ListChecks, CaretRight, Play } from '@phosphor-icons/react';
import AppHeader from '@/components/AppHeader';
import { Button, ButtonLink, Card, cn } from '@/components/ui';
import { api, formatDate, jsonInit, knownWalkIds, rememberWalk } from '@/lib/client';
import { useReveal } from '@/lib/motion';
import { BHK_OPTIONS, defaultRoomsFor } from '@/lib/shared';
import { StructureFlowCollection } from '@/effects/structure-flow/StructureFlowCollection';
import '@/effects/structure-flow/styles.css';

interface WalkSummary {
  id: string;
  buyer_name: string;
  builder: string;
  project: string;
  tower: string;
  flat_number: string;
  bhk_label: string;
  possession_date: string;
  snag_count: number;
}

type FormKey = 'buyer_name' | 'builder' | 'project' | 'tower' | 'flat_number';

const FIELDS: Array<{ key: FormKey; label: string; placeholder: string; autoComplete?: string }> = [
  { key: 'buyer_name', label: 'Your name', placeholder: 'Ananya Iyer', autoComplete: 'name' },
  { key: 'builder', label: 'Builder', placeholder: 'Skyline Developers' },
  { key: 'project', label: 'Project', placeholder: 'Palm Grove Residency' },
  { key: 'tower', label: 'Tower or wing', placeholder: 'Tower 7' },
  { key: 'flat_number', label: 'Flat number', placeholder: '1402' },
];

const STEPS = [
  'Walk each room with a Gemini checklist',
  'Photograph a defect, Gemini classifies it',
  'Send a dated letter with a 15-day deadline',
];

const FEATURES = [
  {
    icon: ListChecks,
    title: 'A checklist for every room',
    body: 'Gemini writes checks for that room: tile slope in bathrooms, earthing in bedrooms, door alignment at the entrance.',
  },
  {
    icon: Camera,
    title: 'Photograph it, Gemini classifies it',
    body: 'Each photo comes back with category, severity and where the defect is. You can correct anything before saving.',
  },
  {
    icon: FileText,
    title: 'A letter your builder has to answer',
    body: 'Defects grouped by room with photo references, a 15-day deadline and a request for written confirmation.',
  },
];

export default function HomePage() {
  const router = useRouter();
  const scope = useRef<HTMLDivElement>(null);

  const [form, setForm] = useState<Record<FormKey, string>>({
    buyer_name: '',
    builder: '',
    project: '',
    tower: '',
    flat_number: '',
  });
  const [bhk, setBhk] = useState(2);
  const [date, setDate] = useState('');
  const [errors, setErrors] = useState<Partial<Record<FormKey, boolean>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [walks, setWalks] = useState<WalkSummary[] | null>(null);

  useEffect(() => {
    setDate(new Date().toISOString().slice(0, 10));
    const ids = knownWalkIds();
    if (!ids.length) {
      setWalks([]);
      return;
    }
    api<{ walks: WalkSummary[] }>(`/api/walks?ids=${ids.join(',')}`)
      .then((d) => setWalks(d.walks))
      .catch(() => setWalks([]));
  }, []);

  useReveal(scope, [walks === null]);

  const rooms = useMemo(() => defaultRoomsFor(bhk), [bhk]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const missing = Object.fromEntries(FIELDS.map((f) => [f.key, !form[f.key].trim()]));
    setErrors(missing);
    if (Object.values(missing).some(Boolean)) {
      const first = FIELDS.find((f) => missing[f.key]);
      document.getElementById(first!.key)?.focus();
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const { walk } = await api<{ walk: { id: string } }>(
        '/api/walks',
        jsonInit('POST', { ...form, bhk, possession_date: date })
      );
      rememberWalk(walk.id);
      router.push(`/walks/${walk.id}`);
    } catch (err) {
      setFormError((err as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <div ref={scope} className="theme-dark relative isolate min-h-[100dvh] bg-bg">
      {/* Full-bleed nebula behind everything, header included. Tinted from indigo to the logo blue, slightly muted. */}
      <div aria-hidden className="fixed inset-0 -z-10">
        <StructureFlowCollection variant="nebula" hue={-27} saturation={0.85} brightness={0.9} />
      </div>
      <AppHeader overlay />
      <main id="main" className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        {/* Above the fold: headline and the whole form in one viewport, on a phone and on a laptop. */}
        <div className="grid gap-x-14 gap-y-4 pt-4 sm:gap-y-8 sm:pt-8 lg:min-h-[calc(100dvh-4rem)] lg:grid-cols-12 lg:items-center lg:py-8">
          <section className="lg:col-span-6">
            <h1
              data-reveal
              className="max-w-[15ch] text-[clamp(1.85rem,5.4vw,4rem)] font-semibold leading-[1.02] tracking-[-0.035em]"
            >
              Find the defects before you sign.
            </h1>
            <p data-reveal className="mt-5 hidden max-w-[46ch] text-[17px] leading-relaxed text-ink-2 sm:block">
              An AI inspector for first-time home buyers. Walk your new flat room by room, photograph what looks wrong, and
              Gemini logs every defect and drafts the formal letter your builder must answer.
            </p>
            <ol data-reveal className="mt-8 hidden gap-3 text-[14px] text-ink-2 lg:grid">
              {STEPS.map((step, i) => (
                <li key={step} className="flex items-center gap-3">
                  <span className="tabular grid size-7 shrink-0 place-items-center rounded-full border border-line font-mono text-[12px] text-ink">
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
            <div data-reveal className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 sm:mt-8">
              <ButtonLink href="/demo" variant="ink" size="md" className="gap-2.5 pl-2">
                <span className="grid size-7 place-items-center rounded-full bg-bg/15">
                  <Play className="size-3.5" weight="fill" />
                </span>
                Watch it work, 60 seconds
              </ButtonLink>
              <span className="text-[13px] text-ink-3">No flat needed. Real Gemini, real photos.</span>
            </div>
          </section>

          <section className="lg:col-span-6">
            <Card
              data-reveal
              className="border-white/10 bg-surface/70 p-4 shadow-[0_24px_64px_-24px_rgb(0_0_0/0.6)] backdrop-blur-xl sm:p-6"
            >
              <h2 className="hidden text-[19px] font-semibold tracking-tight sm:block">Start a possession walk</h2>

              <form onSubmit={submit} noValidate className="grid grid-cols-2 gap-x-3 gap-y-3 sm:mt-5 sm:gap-y-4">
                {FIELDS.map((f) => (
                  <div key={f.key} className="min-w-0">
                    <label htmlFor={f.key} className="label">
                      {f.label}
                    </label>
                    <input
                      id={f.key}
                      className={cn('field', errors[f.key] && 'border-crit focus:border-crit focus:ring-crit/15')}
                      placeholder={f.placeholder}
                      autoComplete={f.autoComplete ?? 'off'}
                      value={form[f.key]}
                      aria-invalid={errors[f.key] || undefined}
                      aria-describedby={errors[f.key] ? `${f.key}-err` : undefined}
                      onChange={(e) => {
                        setForm({ ...form, [f.key]: e.target.value });
                        if (errors[f.key]) setErrors({ ...errors, [f.key]: false });
                      }}
                    />
                    {errors[f.key] && (
                      <p id={`${f.key}-err`} className="mt-1 text-[12.5px] text-crit">
                        Required
                      </p>
                    )}
                  </div>
                ))}

                <div className="min-w-0">
                  <label htmlFor="date" className="label">
                    Inspection date
                  </label>
                  <div className="relative">
                    <input
                      id="date"
                      type="date"
                      className="field date-field pr-10"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                    />
                    <CalendarBlank
                      className="pointer-events-none absolute right-3 top-1/2 size-5 -translate-y-1/2 text-ink-3"
                      aria-hidden
                    />
                  </div>
                </div>

                <fieldset className="col-span-2 min-w-0">
                  <legend className="label">Configuration</legend>
                  <div className="grid grid-cols-5 gap-1 rounded-full border border-line bg-surface-2 p-1">
                    {BHK_OPTIONS.map((n) => (
                      <button
                        key={n}
                        type="button"
                        aria-pressed={bhk === n}
                        onClick={() => setBhk(n)}
                        className={cn(
                          'h-10 rounded-full text-[14px] font-medium transition-colors duration-200',
                          bhk === n ? 'bg-surface text-ink shadow-lift' : 'text-ink-2 hover:text-ink'
                        )}
                      >
                        {n} BHK
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 truncate text-[12.5px] text-ink-3" title={rooms.join(', ')}>
                    <span className="font-medium text-ink-2">{rooms.length} rooms</span> set up for you:{' '}
                    {rooms.slice(0, 3).join(', ')} +{rooms.length - 3} more
                  </p>
                </fieldset>

                {formError && (
                  <p role="alert" className="col-span-2 rounded-field bg-crit-soft px-3.5 py-3 text-[14px] text-crit">
                    {formError}
                  </p>
                )}

                <Button type="submit" size="lg" loading={submitting} className="col-span-2 w-full">
                  {submitting ? 'Setting up rooms' : 'Start the walk'}
                  {!submitting && <ArrowRight className="size-5" weight="bold" />}
                </Button>
              </form>
            </Card>
          </section>
        </div>

        {walks && walks.length > 0 && (
          <section data-reveal className="mt-12 lg:mt-4">
            <h2 className="text-[15px] font-semibold">Continue a walk</h2>
            <ul className="mt-3 grid gap-3 sm:grid-cols-2">
              {walks.slice(0, 4).map((w) => (
                <li key={w.id}>
                  <Link
                    href={`/walks/${w.id}`}
                    className="group flex items-center gap-4 rounded-card border border-white/10 bg-surface/60 px-4 py-3.5 backdrop-blur-xl transition-colors hover:bg-surface-2/70"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-medium">
                        Flat {w.flat_number}, {w.tower}
                      </p>
                      <p className="truncate text-[13px] text-ink-2">
                        {w.project}, {formatDate(w.possession_date)}
                      </p>
                    </div>
                    <span className="tabular text-[13px] text-ink-2">
                      {w.snag_count} {w.snag_count === 1 ? 'snag' : 'snags'}
                    </span>
                    <CaretRight className="size-4 text-ink-3 transition-transform group-hover:translate-x-0.5" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <ul className="mt-14 grid gap-8 sm:grid-cols-3 sm:gap-6">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <li key={title} data-reveal>
              <span className="grid size-10 place-items-center rounded-full bg-accent-soft text-accent">
                <Icon className="size-5" weight="duotone" />
              </span>
              <h3 className="mt-4 text-[16px] font-semibold tracking-tight">{title}</h3>
              <p className="mt-1 max-w-[52ch] text-[15px] leading-relaxed text-ink-2">{body}</p>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
