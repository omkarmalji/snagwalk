'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Camera, FileText, ListChecks, CaretRight } from '@phosphor-icons/react';
import AppHeader from '@/components/AppHeader';
import { Button, Card, cn } from '@/components/ui';
import { api, formatDate, jsonInit, knownWalkIds, rememberWalk } from '@/lib/client';
import { gsap, useGSAP, useReveal, prefersReducedMotion } from '@/lib/motion';
import { BHK_OPTIONS, defaultRoomsFor } from '@/lib/shared';

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
  { key: 'builder', label: 'Builder', placeholder: 'Sobha Limited' },
  { key: 'project', label: 'Project', placeholder: 'Sobha Dream Acres' },
  { key: 'tower', label: 'Tower or wing', placeholder: 'Tower 7' },
  { key: 'flat_number', label: 'Flat number', placeholder: '1402' },
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
  const roomsRef = useRef<HTMLDivElement>(null);

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

  // Feedback: the room preview re-flows when the BHK changes.
  useGSAP(
    () => {
      if (prefersReducedMotion() || !roomsRef.current) return;
      gsap.fromTo(
        roomsRef.current.children,
        { autoAlpha: 0, y: 6 },
        { autoAlpha: 1, y: 0, duration: 0.45, ease: 'power3.out', stagger: 0.02 }
      );
    },
    { dependencies: [bhk], scope: roomsRef }
  );

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
    <div ref={scope} className="min-h-[100dvh]">
      <AppHeader />
      <main className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <div className="grid gap-x-16 gap-y-10 pt-8 sm:pt-12 lg:grid-cols-12 lg:pt-20">
          <section className="lg:col-span-6 lg:row-start-1">
            <h1
              data-reveal
              className="max-w-[16ch] text-[clamp(2.25rem,5.2vw,3.9rem)] font-semibold leading-[1.02] tracking-[-0.035em]"
            >
              Catch every defect before you take the keys.
            </h1>
            <p data-reveal className="mt-5 max-w-[46ch] text-[17px] leading-relaxed text-ink-2">
              Walk your new flat room by room. Gemini reads each defect photo and drafts the formal letter your builder must
              answer.
            </p>
          </section>

          <section className="lg:col-span-6 lg:col-start-7 lg:row-span-2 lg:row-start-1">
            <Card data-reveal className="p-5 shadow-lift sm:p-7">
              <h2 className="text-[20px] font-semibold tracking-tight">Start a possession walk</h2>
              <p className="mt-1 text-[14px] text-ink-2">Takes 30 seconds. You can add rooms later.</p>

              <form onSubmit={submit} noValidate className="mt-6 grid grid-cols-2 gap-x-3 gap-y-4">
                {FIELDS.map((f) => (
                  <div key={f.key} className={cn(f.key === 'tower' || f.key === 'flat_number' ? 'col-span-1' : 'col-span-2')}>
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
                      <p id={`${f.key}-err`} className="mt-1.5 text-[13px] text-crit">
                        Required
                      </p>
                    )}
                  </div>
                ))}

                <fieldset className="col-span-2">
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
                </fieldset>

                <div className="col-span-2">
                  <label htmlFor="date" className="label">
                    Inspection date
                  </label>
                  <input id="date" type="date" className="field" value={date} onChange={(e) => setDate(e.target.value)} />
                </div>

                <div className="col-span-2 rounded-field bg-surface-2/70 p-3.5">
                  <p className="text-[13px] font-medium text-ink-2">{rooms.length} rooms will be set up</p>
                  <div ref={roomsRef} className="mt-2 flex flex-wrap gap-1.5">
                    {rooms.map((r) => (
                      <span key={r} className="rounded-full bg-surface px-2.5 py-1 text-[12.5px] text-ink-2 ring-1 ring-line">
                        {r}
                      </span>
                    ))}
                  </div>
                </div>

                {formError && (
                  <p role="alert" className="col-span-2 rounded-field bg-crit-soft px-3.5 py-3 text-[14px] text-crit">
                    {formError}
                  </p>
                )}

                <Button
                  type="submit"
                  size="lg"
                  loading={submitting}
                  className="col-span-2 mt-1 w-full"
                >
                  {submitting ? 'Setting up rooms' : 'Start the walk'}
                  {!submitting && <ArrowRight className="size-5" weight="bold" />}
                </Button>
              </form>
            </Card>
          </section>

          <section className="lg:col-span-6 lg:row-start-2">
            {walks && walks.length > 0 && (
              <div data-reveal className="mb-12">
                <h2 className="text-[15px] font-semibold">Continue a walk</h2>
                <ul className="mt-3 divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
                  {walks.slice(0, 4).map((w) => (
                    <li key={w.id}>
                      <Link
                        href={`/walks/${w.id}`}
                        className="group flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-surface-2/60"
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
              </div>
            )}

            <ul className="space-y-7">
              {FEATURES.map(({ icon: Icon, title, body }) => (
                <li key={title} data-reveal className="flex gap-4">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
                    <Icon className="size-5" weight="duotone" />
                  </span>
                  <div>
                    <h3 className="text-[16px] font-semibold tracking-tight">{title}</h3>
                    <p className="mt-1 max-w-[52ch] text-[15px] leading-relaxed text-ink-2">{body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </main>
    </div>
  );
}
