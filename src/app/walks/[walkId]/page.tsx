'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowClockwise,
  Bathtub,
  Bed,
  Camera,
  CaretDown,
  Check,
  CookingPot,
  Couch,
  Door,
  FileText,
  Plant,
  Plus,
  SquaresFour,
  WarningCircle,
  WashingMachine,
  type Icon,
  Waveform,
} from '@phosphor-icons/react';
import AppHeader from '@/components/AppHeader';
import { Button, ButtonLink, Card, Skeleton, SourceTag, cn } from '@/components/ui';
import { api, formatDate, jsonInit, rememberWalk } from '@/lib/client';
import { gsap, useCountUp, useGSAP, useReveal, prefersReducedMotion, EASE } from '@/lib/motion';
import { photoSrc } from '@/lib/shared';

function roomIcon(name: string): Icon {
  const n = name.toLowerCase();
  if (n.includes('kitchen')) return CookingPot;
  if (n.includes('bath') || n.includes('toilet')) return Bathtub;
  if (n.includes('bed')) return Bed;
  if (n.includes('living') || n.includes('dining')) return Couch;
  if (n.includes('balcony') || n.includes('terrace')) return Plant;
  if (n.includes('utility') || n.includes('wash')) return WashingMachine;
  if (n.includes('entrance') || n.includes('passage') || n.includes('foyer')) return Door;
  return SquaresFour;
}

interface ChecklistItem {
  id: string;
  item: string;
  category: string;
  checked: boolean;
}

interface Room {
  id: string;
  room_name: string;
  checklist: ChecklistItem[];
  snag_count: number;
  severities: { critical: number; major: number; minor: number };
  thumbs: string[];
}

interface Walk {
  id: string;
  buyer_name: string;
  builder: string;
  project: string;
  tower: string;
  flat_number: string;
  bhk_label: string;
  possession_date: string;
}

interface WalkResponse {
  walk: Walk;
  rooms: Room[];
  letter: { exists: boolean; stale: boolean; source: string | null };
}

export default function WalkPage() {
  const { walkId } = useParams<{ walkId: string }>();
  const router = useRouter();
  const scope = useRef<HTMLDivElement>(null);

  const [data, setData] = useState<WalkResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [loadingChecklist, setLoadingChecklist] = useState<string | null>(null);
  const [checklistSource, setChecklistSource] = useState<Record<string, string>>({});
  const [liveEnabled, setLiveEnabled] = useState(false);

  useEffect(() => {
    api<{ url: string | null }>('/api/live/config')
      .then((c) => setLiveEnabled(Boolean(c.url)))
      .catch(() => setLiveEnabled(false));
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const d = await api<WalkResponse>(`/api/walks/${walkId}`);
      setData(d);
      rememberWalk(walkId);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [walkId]);

  useEffect(() => {
    load();
  }, [load]);

  useReveal(scope, [Boolean(data), data?.rooms.length]);

  const fetchChecklist = useCallback(async (roomId: string, regenerate = false) => {
    setLoadingChecklist(roomId);
    try {
      const d = await api<{ checklist: ChecklistItem[]; source: string }>(`/api/rooms/${roomId}/checklist`, {
        method: regenerate ? 'POST' : 'GET',
      });
      setData((prev) =>
        prev ? { ...prev, rooms: prev.rooms.map((r) => (r.id === roomId ? { ...r, checklist: d.checklist } : r)) } : prev
      );
      setChecklistSource((s) => ({ ...s, [roomId]: d.source }));
    } catch {
      // keep the empty state with its retry button
    } finally {
      setLoadingChecklist(null);
    }
  }, []);

  function toggleRoom(room: Room) {
    const next = openId === room.id ? null : room.id;
    setOpenId(next);
    if (next && room.checklist.length === 0) fetchChecklist(room.id);
  }

  function toggleItem(roomId: string, itemId: string) {
    const room = data?.rooms.find((r) => r.id === roomId);
    if (!room) return;
    const updated = room.checklist.map((it) => (it.id === itemId ? { ...it, checked: !it.checked } : it));
    setData((prev) =>
      prev ? { ...prev, rooms: prev.rooms.map((r) => (r.id === roomId ? { ...r, checklist: updated } : r)) } : prev
    );
    fetch(`/api/rooms/${roomId}/checklist`, jsonInit('PUT', { checklist: updated })).catch(() => {});
  }

  if (error) {
    return (
      <div className="min-h-[100dvh]">
        <AppHeader back={{ href: '/', label: 'Home' }} />
        <div className="mx-auto max-w-md px-4 py-24 text-center">
          <WarningCircle className="mx-auto size-10 text-crit" weight="duotone" />
          <h1 className="mt-4 text-[20px] font-semibold">We could not open this walk</h1>
          <p className="mt-2 text-[15px] text-ink-2">{error}</p>
          <div className="mt-6 flex justify-center gap-2">
            <Button variant="secondary" onClick={load}>
              Try again
            </Button>
            <ButtonLink href="/">Start a new walk</ButtonLink>
          </div>
        </div>
      </div>
    );
  }

  const rooms = data?.rooms ?? [];
  const totals = rooms.reduce(
    (acc, r) => {
      acc.snags += r.snag_count;
      acc.critical += r.severities.critical;
      acc.major += r.severities.major;
      acc.minor += r.severities.minor;
      acc.checks += r.checklist.length;
      acc.done += r.checklist.filter((c) => c.checked).length;
      return acc;
    },
    { snags: 0, critical: 0, major: 0, minor: 0, checks: 0, done: 0 }
  );

  const letterLabel = data?.letter.exists ? (data.letter.stale ? 'Update builder letter' : 'View builder letter') : 'Write builder letter';

  return (
    <div ref={scope} className="min-h-[100dvh]">
      <AppHeader back={{ href: '/', label: 'All walks' }} title={data ? `Flat ${data.walk.flat_number}` : undefined} />

      <main id="main" className="mx-auto max-w-6xl px-4 pb-36 pt-6 sm:px-6 lg:pb-20 lg:pt-10">
        <div className="grid gap-8 lg:grid-cols-12 lg:gap-12">
          {/* Summary */}
          <aside className="min-w-0 lg:col-span-4">
            <div className="lg:sticky lg:top-24">
              {!data ? (
                <SummarySkeleton />
              ) : (
                <>
                  <div data-reveal>
                    <p className="text-[14px] text-ink-2">
                      {data.walk.project}, {data.walk.builder}
                    </p>
                    <h1 className="mt-1 text-[32px] font-semibold leading-tight tracking-[-0.03em] sm:text-[38px]">
                      Flat {data.walk.flat_number}, {data.walk.tower}
                    </h1>
                    <p className="mt-2 text-[14px] text-ink-2">
                      {data.walk.bhk_label} for {data.walk.buyer_name}, inspected {formatDate(data.walk.possession_date)}
                    </p>
                  </div>

                  <Card data-reveal className="mt-6 p-5">
                    <div className="flex items-end justify-between">
                      <div>
                        <p className="text-[13px] font-medium text-ink-2">Snags logged</p>
                        <SnagTotal value={totals.snags} />
                      </div>
                      <dl className="flex gap-4 pb-1.5 text-right">
                        <Stat label="Critical" value={totals.critical} tone="text-crit" />
                        <Stat label="Major" value={totals.major} tone="text-major" />
                        <Stat label="Minor" value={totals.minor} tone="text-ink-2" />
                      </dl>
                    </div>
                    <SeverityBar critical={totals.critical} major={totals.major} minor={totals.minor} />
                    <p className="mt-4 text-[13px] text-ink-2">
                      {totals.checks > 0
                        ? `${totals.done} of ${totals.checks} checks done across opened rooms`
                        : 'Open a room to get its checklist'}
                    </p>
                  </Card>

                  <div data-reveal className="mt-4 hidden lg:block">
                    <ButtonLink href={`/walks/${walkId}/letter`} size="lg" className="w-full">
                      <FileText className="size-5" weight="bold" />
                      {letterLabel}
                    </ButtonLink>
                    {data.letter.exists && data.letter.stale && (
                      <p className="mt-2 text-center text-[13px] text-ink-2">Snags changed since the last letter</p>
                    )}
                  </div>
                </>
              )}
            </div>
          </aside>

          {/* Rooms */}
          <section className="min-w-0 lg:col-span-8" aria-label="Rooms">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-[15px] font-semibold">Rooms</h2>
              {data && <p className="text-[13px] text-ink-2">{rooms.length} rooms</p>}
            </div>

            {!data ? (
              <div className="space-y-2.5">
                {Array.from({ length: 6 }, (_, i) => (
                  <Skeleton key={i} className="h-[72px] rounded-card" />
                ))}
              </div>
            ) : (
              <ul className="space-y-2.5">
                {rooms.map((room) => (
                  <RoomRow
                    key={room.id}
                    room={room}
                    open={openId === room.id}
                    loading={loadingChecklist === room.id}
                    source={checklistSource[room.id]}
                    onToggle={() => toggleRoom(room)}
                    onToggleItem={(itemId) => toggleItem(room.id, itemId)}
                    onRegenerate={() => fetchChecklist(room.id, true)}
                    onCapture={() => router.push(`/walks/${walkId}/rooms/${room.id}/snag`)}
                    onLive={liveEnabled ? () => router.push(`/walks/${walkId}/rooms/${room.id}/live`) : undefined}
                  />
                ))}
                <AddRoom
                  walkId={walkId}
                  onAdded={(room) => {
                    setData((prev) => (prev ? { ...prev, rooms: [...prev.rooms, room] } : prev));
                    setOpenId(room.id);
                    fetchChecklist(room.id);
                  }}
                />
              </ul>
            )}
          </section>
        </div>
      </main>

      {/* Mobile primary action */}
      {data && (
        <div className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/90 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl lg:hidden">
          <ButtonLink href={`/walks/${walkId}/letter`} size="lg" className="w-full">
            <FileText className="size-5" weight="bold" />
            {letterLabel}
            {totals.snags > 0 && <span className="tabular opacity-70">({totals.snags})</span>}
          </ButtonLink>
        </div>
      )}
    </div>
  );
}

function SnagTotal({ value }: { value: number }) {
  const ref = useCountUp(value);
  return (
    <p className="tabular mt-1 text-[44px] font-semibold leading-none tracking-[-0.04em]">
      <span ref={ref}>{value}</span>
    </p>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div>
      <dt className="text-[12px] text-ink-3">{label}</dt>
      <dd className={cn('tabular text-[18px] font-semibold', tone)}>{value}</dd>
    </div>
  );
}

/** Severity mix as one segmented line. Empty state is a single neutral hairline. */
function SeverityBar({ critical, major, minor }: { critical: number; major: number; minor: number }) {
  const total = critical + major + minor;
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      if (prefersReducedMotion() || !ref.current) return;
      gsap.fromTo(ref.current.children, { scaleX: 0 }, { scaleX: 1, duration: 0.8, ease: EASE, stagger: 0.06, transformOrigin: 'left' });
    },
    { dependencies: [critical, major, minor], scope: ref }
  );
  if (total === 0) return <div className="mt-5 h-px bg-line" />;
  return (
    <div ref={ref} className="mt-5 flex h-1.5 gap-1 overflow-hidden rounded-full" aria-hidden>
      {critical > 0 && <span className="rounded-full bg-crit" style={{ flexGrow: critical }} />}
      {major > 0 && <span className="rounded-full bg-major" style={{ flexGrow: major }} />}
      {minor > 0 && <span className="rounded-full bg-ink-3/60" style={{ flexGrow: minor }} />}
    </div>
  );
}

function SummarySkeleton() {
  return (
    <div>
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-3 h-10 w-64" />
      <Skeleton className="mt-3 h-4 w-52" />
      <Skeleton className="mt-6 h-40 rounded-card" />
    </div>
  );
}

function RoomRow({
  room,
  open,
  loading,
  source,
  onToggle,
  onToggleItem,
  onRegenerate,
  onCapture,
  onLive,
}: {
  room: Room;
  open: boolean;
  loading: boolean;
  source?: string;
  onToggle: () => void;
  onToggleItem: (id: string) => void;
  onRegenerate: () => void;
  onCapture: () => void;
  onLive?: () => void;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const caretRef = useRef<SVGSVGElement>(null);
  const first = useRef(true);

  // State transition: the room body expands from its header instead of popping in.
  useGSAP(
    () => {
      const el = bodyRef.current;
      if (!el) return;
      const reduce = prefersReducedMotion();
      if (first.current) {
        first.current = false;
        gsap.set(el, { height: open ? 'auto' : 0, autoAlpha: open ? 1 : 0 });
        return;
      }
      gsap.to(el, {
        height: open ? 'auto' : 0,
        autoAlpha: open ? 1 : 0,
        duration: reduce ? 0 : 0.5,
        ease: open ? EASE : 'power3.inOut',
        onComplete: () => {
          // Keep the opened room's header in view on phones, where the body can push it off screen.
          const card = el.parentElement;
          if (open && card && card.getBoundingClientRect().top < 72) {
            card.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
          }
        },
      });
      if (caretRef.current) gsap.to(caretRef.current, { rotate: open ? 180 : 0, duration: reduce ? 0 : 0.4, ease: EASE });
    },
    { dependencies: [open] }
  );

  const done = room.checklist.filter((c) => c.checked).length;
  const RoomIcon = roomIcon(room.room_name);
  const meta = [
    room.checklist.length ? `${done} of ${room.checklist.length} checks` : null,
    room.snag_count ? `${room.snag_count} ${room.snag_count === 1 ? 'snag' : 'snags'}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <li data-reveal>
      <Card className={cn('scroll-mt-20 overflow-hidden transition-[border-color,box-shadow] duration-300', open && 'border-ink-3/50 shadow-lift')}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-h-[72px] w-full items-center gap-4 px-4 py-3 text-left sm:px-5"
        >
          <span
            className={cn(
              'grid size-9 shrink-0 place-items-center rounded-full text-[13px] font-semibold tabular',
              room.severities.critical
                ? 'bg-crit-soft text-crit'
                : room.snag_count
                  ? 'bg-major-soft text-major'
                  : room.checklist.length && done === room.checklist.length
                    ? 'bg-accent-soft text-accent'
                    : 'bg-surface-2 text-ink-2'
            )}
          >
            {room.snag_count > 0 ? (
              room.snag_count
            ) : room.checklist.length > 0 && done === room.checklist.length ? (
              <Check weight="bold" className="size-4" />
            ) : (
              <RoomIcon className="size-[18px]" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[16px] font-medium">{room.room_name}</span>
            <span className="block truncate text-[13px] text-ink-2">{meta || 'Not inspected yet'}</span>
          </span>
          {room.thumbs.length > 0 && (
            <span className="hidden -space-x-2 sm:flex">
              {room.thumbs.map((t) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={t} src={photoSrc(t)} alt="" className="size-8 rounded-full object-cover ring-2 ring-surface" />
              ))}
            </span>
          )}
          <CaretDown ref={caretRef} className="size-5 shrink-0 text-ink-3" />
        </button>

        <div ref={bodyRef} className="overflow-hidden" style={{ height: 0, visibility: 'hidden' }}>
          <div className="border-t border-line px-4 pb-4 pt-3 sm:px-5 sm:pb-5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <p className="text-[13px] font-medium text-ink-2">Checklist</p>
                <SourceTag source={source} />
              </div>
              <Button variant="ghost" size="sm" onClick={onRegenerate} disabled={loading} className="-mr-2">
                <ArrowClockwise className={cn('size-4', loading && 'animate-spin')} />
                New checklist
              </Button>
            </div>

            {loading ? (
              <div className="space-y-2" aria-label="Generating checklist">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-12" />
                ))}
                <p className="pt-1 text-[13px] text-ink-2">Gemini is writing checks for the {room.room_name.toLowerCase()}</p>
              </div>
            ) : room.checklist.length === 0 ? (
              <button
                type="button"
                onClick={() => onRegenerate()}
                className="w-full rounded-field border border-dashed border-line py-4 text-[14px] text-ink-2 hover:border-ink-3"
              >
                Get a checklist for this room
              </button>
            ) : (
              <ul className="space-y-1.5">
                {room.checklist.map((it) => (
                  <li key={it.id}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={it.checked}
                      onClick={() => onToggleItem(it.id)}
                      className={cn(
                        'flex min-h-12 w-full items-start gap-3 rounded-field px-3 py-3 text-left text-[15px] leading-snug transition-colors duration-200',
                        it.checked ? 'bg-accent-soft/60 text-ink-2' : 'bg-surface-2/60 hover:bg-surface-2'
                      )}
                    >
                      <span
                        className={cn(
                          'mt-px grid size-5 shrink-0 place-items-center rounded-md border transition-colors duration-200',
                          it.checked ? 'border-accent bg-accent text-accent-ink' : 'border-ink-3/60 bg-surface'
                        )}
                      >
                        {it.checked && <Check weight="bold" className="size-3.5" />}
                      </span>
                      <span className={cn(it.checked && 'line-through decoration-ink-3/60')}>{it.item}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className={cn('mt-4 grid gap-2.5', onLive && 'sm:grid-cols-2')}>
              <Button variant="ink" size="lg" onClick={onCapture} className="w-full">
                <Camera className="size-5" weight="bold" />
                Photograph a defect
              </Button>
              {onLive && (
                <Button variant="primary" size="lg" onClick={onLive} className="w-full">
                  <Waveform className="size-5" weight="bold" />
                  Inspect live with Gemini
                </Button>
              )}
            </div>
          </div>
        </div>
      </Card>
    </li>
  );
}

function AddRoom({ walkId, onAdded }: { walkId: string; onAdded: (room: Room) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const { room } = await api<{ room: Room }>(`/api/walks/${walkId}/rooms`, jsonInit('POST', { room_name: name }));
      onAdded(room);
      setName('');
      setOpen(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <li data-reveal>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex h-14 w-full items-center justify-center gap-2 rounded-card border border-dashed border-line text-[15px] font-medium text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
        >
          <Plus className="size-4" weight="bold" />
          Add a room
        </button>
      </li>
    );
  }
  return (
    <li>
      <form onSubmit={add} className="flex gap-2 rounded-card border border-line bg-surface p-2">
        <label htmlFor="new-room" className="sr-only">
          Room name
        </label>
        <input
          id="new-room"
          autoFocus
          className="field h-11 flex-1 border-transparent bg-transparent"
          placeholder="Study, Pooja room, Terrace"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="submit" loading={saving} disabled={!name.trim()}>
          Add
        </Button>
      </form>
      {error && <p className="mt-1.5 px-2 text-[13px] text-crit">{error}</p>}
    </li>
  );
}
