'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowRight,
  Camera,
  CheckCircle,
  ImageSquare,
  PencilSimple,
  Trash,
  Sparkle,
  X,
} from '@phosphor-icons/react';
import AppHeader from '@/components/AppHeader';
import { Button, ButtonLink, Card, SeverityBadge, Skeleton, SourceTag, cn } from '@/components/ui';
import { api, compressImage, jsonInit } from '@/lib/client';
import { gsap, useGSAP, useReveal, prefersReducedMotion, EASE } from '@/lib/motion';
import { CATEGORIES, SEVERITIES, categoryLabel, photoSrc } from '@/lib/shared';

interface Snag {
  id: string;
  room_id: string;
  category: string;
  severity: string;
  description: string;
  location_note: string | null;
  photo_url: string;
  created_at: string;
}

interface Draft {
  id: string;
  photo: string;
  category: string;
  severity: string;
  description: string;
  location_note: string;
  box: [number, number, number, number] | null;
  source: 'gemini' | 'fallback' | null;
  isNew: boolean;
}

type Phase = 'idle' | 'analyzing' | 'review';

export default function SnagCapturePage() {
  const { walkId, roomId } = useParams<{ walkId: string; roomId: string }>();
  const scope = useRef<HTMLDivElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const libraryInput = useRef<HTMLInputElement>(null);

  const [roomName, setRoomName] = useState<string | null>(null);
  const [nextRoom, setNextRoom] = useState<{ id: string; name: string } | null>(null);
  const [snags, setSnags] = useState<Snag[] | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [preview, setPreview] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const loadSnags = useCallback(async () => {
    const d = await api<{ snags: Snag[] }>(`/api/rooms/${roomId}/snags`);
    setSnags(d.snags);
  }, [roomId]);

  useEffect(() => {
    api<{ rooms: Array<{ id: string; room_name: string }> }>(`/api/walks/${walkId}`)
      .then((d) => {
        const idx = d.rooms.findIndex((r) => r.id === roomId);
        setRoomName(d.rooms[idx]?.room_name ?? 'Room');
        const nxt = d.rooms[idx + 1];
        setNextRoom(nxt ? { id: nxt.id, name: nxt.room_name } : null);
      })
      .catch(() => setRoomName('Room'));
    loadSnags().catch(() => setSnags([]));
  }, [walkId, roomId, loadSnags]);

  useReveal(scope, [snags === null, roomName === null]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const original = e.target.files?.[0];
    e.target.value = '';
    if (!original) return;
    setError(null);
    setDraft(null);
    setPhase('analyzing');
    const file = await compressImage(original);
    const url = URL.createObjectURL(file);
    setPreview(url);

    try {
      const body = new FormData();
      body.append('photo', file);
      const res = await api<{ snag: Snag; box_2d: Draft['box']; source: Draft['source'] }>(
        `/api/rooms/${roomId}/snags`,
        { method: 'POST', body }
      );
      setDraft({
        id: res.snag.id,
        photo: url,
        category: res.snag.category,
        severity: res.snag.severity,
        description: res.snag.description,
        location_note: res.snag.location_note ?? '',
        box: res.box_2d,
        source: res.source,
        isNew: true,
      });
      setPhase('review');
      loadSnags();
    } catch (err) {
      setError((err as Error).message);
      setPhase('idle');
      setPreview(null);
    }
  }

  function editExisting(s: Snag) {
    setError(null);
    setPreview(photoSrc(s.photo_url));
    setDraft({
      id: s.id,
      photo: photoSrc(s.photo_url),
      category: s.category,
      severity: s.severity,
      description: s.description,
      location_note: s.location_note ?? '',
      box: null,
      source: null,
      isNew: false,
    });
    setPhase('review');
    scope.current?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }

  function reset() {
    setPhase('idle');
    setDraft(null);
    setPreview(null);
    setError(null);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    if (!draft.description.trim()) {
      setError('Describe the defect before saving.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api(`/api/snags/${draft.id}`, jsonInit('PUT', draft));
      setToast(draft.isNew ? 'Snag saved' : 'Snag updated');
      reset();
      loadSnags();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function discard() {
    if (!draft) return;
    if (draft.isNew) {
      setSaving(true);
      try {
        await api(`/api/snags/${draft.id}`, { method: 'DELETE' });
        loadSnags();
      } catch {
        // already gone
      } finally {
        setSaving(false);
      }
    }
    reset();
  }

  async function remove(id: string) {
    setSnags((prev) => prev?.filter((s) => s.id !== id) ?? prev);
    try {
      await api(`/api/snags/${id}`, { method: 'DELETE' });
      setToast('Snag deleted');
    } catch {
      loadSnags();
    }
  }

  const title = roomName ?? '';

  return (
    <div ref={scope} className="min-h-[100dvh]">
      <AppHeader back={{ href: `/walks/${walkId}`, label: 'Rooms' }} title={title} />

      <input ref={cameraInput} type="file" accept="image/*" capture="environment" onChange={onFile} className="hidden" />
      <input ref={libraryInput} type="file" accept="image/*" onChange={onFile} className="hidden" />

      <main className="mx-auto max-w-6xl px-4 pb-24 pt-6 sm:px-6 lg:pt-10">
        <div className="mb-6" data-reveal>
          {roomName === null ? (
            <Skeleton className="h-10 w-56" />
          ) : (
            <h1 className="text-[30px] font-semibold tracking-[-0.03em] sm:text-[36px]">{roomName}</h1>
          )}
          <p className="mt-1 text-[15px] text-ink-2">
            Photograph one defect at a time. Gemini fills in the details, you check them.
          </p>
        </div>

        <div className="grid gap-8 lg:grid-cols-12 lg:gap-12">
          <section className="min-w-0 lg:col-span-7" aria-live="polite">
            {phase === 'idle' && (
              <div data-reveal className="space-y-3">
                {error && <p className="rounded-field bg-crit-soft px-4 py-3 text-[14px] text-crit">{error}</p>}
                <button
                  type="button"
                  onClick={() => cameraInput.current?.click()}
                  className="group relative flex aspect-[4/3] w-full flex-col items-center justify-center gap-4 overflow-hidden rounded-card bg-ink text-bg transition-transform duration-300 ease-out active:scale-[0.99] sm:aspect-[16/9]"
                >
                  <span className="grid size-16 place-items-center rounded-full bg-bg/10 ring-1 ring-bg/20 transition-transform duration-500 ease-out group-hover:scale-105">
                    <Camera className="size-8" weight="duotone" />
                  </span>
                  <span className="text-center">
                    <span className="block text-[18px] font-semibold">Take a photo</span>
                    <span className="mt-1 block text-[14px] text-bg/60">Opens the back camera on your phone</span>
                  </span>
                </button>
                <Button variant="secondary" size="lg" className="w-full" onClick={() => libraryInput.current?.click()}>
                  <ImageSquare className="size-5" />
                  Choose from gallery
                </Button>
              </div>
            )}

            {phase !== 'idle' && preview && (
              <Card className="overflow-hidden">
                <PhotoStage src={preview} analyzing={phase === 'analyzing'} box={draft?.box ?? null} />
                {phase === 'analyzing' && (
                  <div className="flex items-center gap-3 px-5 py-4">
                    <Sparkle className="size-5 animate-pulse text-accent" weight="fill" />
                    <div>
                      <p className="text-[15px] font-medium">Gemini is inspecting the photo</p>
                      <p className="text-[13px] text-ink-2">Classifying category and severity while the photo uploads</p>
                    </div>
                  </div>
                )}
                {phase === 'review' && draft && (
                  <ReviewForm
                    draft={draft}
                    setDraft={setDraft}
                    saving={saving}
                    error={error}
                    onSubmit={save}
                    onDiscard={discard}
                  />
                )}
              </Card>
            )}
          </section>

          <aside className="min-w-0 lg:col-span-5">
            <div className="lg:sticky lg:top-24">
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="text-[15px] font-semibold">Logged in this room</h2>
                {snags && <span className="tabular text-[13px] text-ink-2">{snags.length}</span>}
              </div>
              {snags === null ? (
                <div className="space-y-2.5">
                  <Skeleton className="h-24 rounded-card" />
                  <Skeleton className="h-24 rounded-card" />
                </div>
              ) : snags.length === 0 ? (
                <div data-reveal className="rounded-card border border-dashed border-line px-5 py-8 text-center">
                  <p className="text-[15px] font-medium">No snags here yet</p>
                  <p className="mt-1 text-[14px] text-ink-2">If the room is clean, move on to the next one.</p>
                </div>
              ) : (
                <SnagList snags={snags} activeId={draft?.id} onEdit={editExisting} onDelete={remove} />
              )}

              <div data-reveal className="mt-6 grid gap-2">
                {nextRoom ? (
                  <ButtonLink href={`/walks/${walkId}/rooms/${nextRoom.id}/snag`} variant="secondary" size="lg" className="w-full">
                    Next room: {nextRoom.name}
                    <ArrowRight className="size-4" weight="bold" />
                  </ButtonLink>
                ) : (
                  <ButtonLink href={`/walks/${walkId}/letter`} variant="secondary" size="lg" className="w-full">
                    Last room. Write the builder letter
                    <ArrowRight className="size-4" weight="bold" />
                  </ButtonLink>
                )}
                <Link
                  href={`/walks/${walkId}`}
                  className="py-2 text-center text-[14px] font-medium text-ink-2 hover:text-ink"
                >
                  Back to all rooms
                </Link>
              </div>
            </div>
          </aside>
        </div>
      </main>

      <Toast message={toast} />
    </div>
  );
}

/** Photo with an AI scan sweep while analysing, and the defect box drawn in once Gemini answers. */
function PhotoStage({
  src,
  analyzing,
  box,
}: {
  src: string;
  analyzing: boolean;
  box: [number, number, number, number] | null;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (!analyzing || !line.current || !wrap.current || prefersReducedMotion()) return;
      const h = () => wrap.current?.offsetHeight ?? 0;
      gsap.fromTo(line.current, { y: 0 }, { y: h, duration: 1.6, ease: 'sine.inOut', repeat: -1, yoyo: true });
    },
    { dependencies: [analyzing], scope: wrap, revertOnUpdate: true }
  );

  useGSAP(
    () => {
      if (!box || !boxRef.current) return;
      if (prefersReducedMotion()) return;
      gsap.fromTo(
        boxRef.current,
        { autoAlpha: 0, scale: 1.25 },
        { autoAlpha: 1, scale: 1, duration: 0.7, ease: EASE, delay: 0.1 }
      );
    },
    { dependencies: [box], scope: wrap }
  );

  return (
    <div className="flex justify-center bg-ink/95">
      <div ref={wrap} className="relative max-w-full overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="Defect photo" className="block max-h-[56vh] w-auto max-w-full" />
        {analyzing && (
          <>
            <div className="absolute inset-0 bg-ink/25" />
            <div
              ref={line}
              className="absolute inset-x-0 top-0 h-16 -translate-y-1/2 bg-gradient-to-b from-transparent via-accent/35 to-transparent"
            >
              <div className="absolute inset-x-0 top-1/2 h-px bg-accent" />
            </div>
          </>
        )}
        {box && !analyzing && (
          <div
            ref={boxRef}
            className="pointer-events-none absolute rounded-md border-2 border-accent shadow-[0_0_0_9999px_rgb(0_0_0/0.25)]"
            style={{
              top: `${box[0] / 10}%`,
              left: `${box[1] / 10}%`,
              height: `${(box[2] - box[0]) / 10}%`,
              width: `${(box[3] - box[1]) / 10}%`,
            }}
          />
        )}
      </div>
    </div>
  );
}

function ReviewForm({
  draft,
  setDraft,
  saving,
  error,
  onSubmit,
  onDiscard,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  saving: boolean;
  error: string | null;
  onSubmit: (e: React.FormEvent) => void;
  onDiscard: () => void;
}) {
  const ref = useRef<HTMLFormElement>(null);
  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      gsap.fromTo(
        ref.current!.children,
        { autoAlpha: 0, y: 10 },
        { autoAlpha: 1, y: 0, duration: 0.55, ease: EASE, stagger: 0.05 }
      );
    },
    { scope: ref, dependencies: [draft.id] }
  );

  const sevTone: Record<string, string> = {
    critical: 'bg-crit text-bg',
    major: 'bg-major text-bg',
    minor: 'bg-ink text-bg',
  };

  return (
    <form ref={ref} onSubmit={onSubmit} className="space-y-5 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[17px] font-semibold tracking-tight">{draft.isNew ? 'Check the details' : 'Edit snag'}</h2>
        {draft.source === 'gemini' && <SourceTag source="gemini" />}
        {draft.source === 'fallback' && (
          <span className="rounded-full bg-major-soft px-2.5 py-1 text-[12px] font-medium text-major">
            AI unavailable, fill in manually
          </span>
        )}
      </div>

      <fieldset>
        <legend className="label">Severity</legend>
        <div className="grid grid-cols-3 gap-1 rounded-full border border-line bg-surface-2 p-1">
          {SEVERITIES.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={draft.severity === s}
              onClick={() => setDraft({ ...draft, severity: s })}
              className={cn(
                'h-10 rounded-full text-[14px] font-medium capitalize transition-colors duration-200',
                draft.severity === s ? sevTone[s] : 'text-ink-2 hover:text-ink'
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="label">Category</legend>
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map((c) => (
            <button
              key={c.value}
              type="button"
              aria-pressed={draft.category === c.value}
              onClick={() => setDraft({ ...draft, category: c.value })}
              className={cn(
                'h-10 rounded-full border px-3.5 text-[14px] transition-colors duration-200',
                draft.category === c.value
                  ? 'border-accent bg-accent-soft font-medium text-accent'
                  : 'border-line text-ink-2 hover:border-ink-3 hover:text-ink'
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="desc" className="label">
          What is wrong
        </label>
        <textarea
          id="desc"
          rows={4}
          className="field resize-none"
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
        />
      </div>

      <div>
        <label htmlFor="loc" className="label">
          Where exactly
        </label>
        <input
          id="loc"
          className="field"
          placeholder="Left wall, near the switchboard"
          value={draft.location_note}
          onChange={(e) => setDraft({ ...draft, location_note: e.target.value })}
        />
      </div>

      {error && <p className="rounded-field bg-crit-soft px-4 py-3 text-[14px] text-crit">{error}</p>}

      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        <Button type="button" variant="ghost" size="lg" onClick={onDiscard} disabled={saving} className="sm:w-auto">
          <X className="size-4" weight="bold" />
          {draft.isNew ? 'Discard photo' : 'Cancel'}
        </Button>
        <Button type="submit" size="lg" loading={saving} className="w-full sm:flex-1">
          {!saving && <CheckCircle className="size-5" weight="bold" />}
          {draft.isNew ? 'Save snag' : 'Save changes'}
        </Button>
      </div>
    </form>
  );
}

function SnagList({
  snags,
  activeId,
  onEdit,
  onDelete,
}: {
  snags: Snag[];
  activeId?: string;
  onEdit: (s: Snag) => void;
  onDelete: (id: string) => void;
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const seen = useRef<Set<string> | null>(null);

  // Feedback: only newly added snags slide in; existing rows stay put.
  useGSAP(
    () => {
      const ids = new Set(snags.map((s) => s.id));
      if (seen.current && !prefersReducedMotion()) {
        const fresh = snags.filter((s) => !seen.current!.has(s.id)).map((s) => `[data-id="${s.id}"]`);
        if (fresh.length) {
          gsap.fromTo(fresh.join(','), { autoAlpha: 0, x: 16 }, { autoAlpha: 1, x: 0, duration: 0.6, ease: EASE });
        }
      }
      seen.current = ids;
    },
    { scope: listRef, dependencies: [snags] }
  );

  return (
    <ul ref={listRef} className="space-y-2.5">
      {snags.map((s) => (
        <li key={s.id} data-id={s.id}>
          <Card className={cn('flex gap-3 p-3', activeId === s.id && 'border-accent')}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photoSrc(s.photo_url)} alt="" className="size-[72px] shrink-0 rounded-[12px] bg-surface-2 object-cover" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <SeverityBadge severity={s.severity} />
                <span className="truncate text-[13px] text-ink-2">{categoryLabel(s.category)}</span>
              </div>
              <p className="mt-1 line-clamp-2 text-[14px] leading-snug">{s.description}</p>
              {s.location_note && <p className="mt-0.5 truncate text-[13px] text-ink-3">{s.location_note}</p>}
              {confirmId === s.id && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-[13px] text-ink-2">Delete this snag?</span>
                  <Button size="sm" variant="danger" onClick={() => onDelete(s.id)}>
                    Delete
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmId(null)}>
                    Keep
                  </Button>
                </div>
              )}
            </div>
            {confirmId !== s.id && (
              <div className="-mr-1 flex shrink-0 flex-col">
                <button
                  type="button"
                  onClick={() => onEdit(s)}
                  className="grid size-10 place-items-center rounded-full text-ink-2 hover:bg-surface-2 hover:text-ink"
                  aria-label="Edit snag"
                >
                  <PencilSimple className="size-[18px]" />
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmId(s.id)}
                  className="grid size-10 place-items-center rounded-full text-ink-2 hover:bg-crit-soft hover:text-crit"
                  aria-label="Delete snag"
                >
                  <Trash className="size-[18px]" />
                </button>
              </div>
            )}
          </Card>
        </li>
      ))}
    </ul>
  );
}

function Toast({ message }: { message: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState<string | null>(null);

  useEffect(() => {
    if (message) setShown(message);
  }, [message]);

  // Feedback: slides in when a save/delete lands, slides out and unmounts when it expires.
  useGSAP(
    () => {
      const el = ref.current;
      if (!el || !shown) return;
      const reduce = prefersReducedMotion();
      if (message) {
        gsap.fromTo(el, { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: reduce ? 0 : 0.45, ease: EASE });
      } else {
        gsap.to(el, {
          autoAlpha: 0,
          y: 16,
          duration: reduce ? 0 : 0.3,
          ease: 'power2.in',
          onComplete: () => setShown(null),
        });
      }
    },
    { dependencies: [message, shown] }
  );

  if (!shown) return null;
  return (
    <div ref={ref} role="status" className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
      <span className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-[14px] font-medium text-bg shadow-lift">
        <CheckCircle className="size-4" weight="fill" />
        {shown}
      </span>
    </div>
  );
}
