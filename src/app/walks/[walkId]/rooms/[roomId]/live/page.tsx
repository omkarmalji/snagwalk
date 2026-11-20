'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeft,
  Camera,
  CircleNotch,
  Headphones,
  Lightbulb,
  Microphone,
  MicrophoneSlash,
  PhoneDisconnect,
  Sparkle,
  Timer,
  Waveform,
  WarningCircle,
} from '@phosphor-icons/react';
import { Button, ButtonLink, Card, SeverityBadge, cn } from '@/components/ui';
import { api } from '@/lib/client';
import { categoryLabel } from '@/lib/shared';

/**
 * Live inspector: Gemini Live watches the camera (about 1 frame a second), listens, talks the buyer through the room,
 * and calls log_snag when it sees a defect. A sharp frame is then saved through the normal snag route, so live snags
 * get the same photo storage, classification and bounding box as manual ones.
 */

type Phase = 'intro' | 'connecting' | 'live' | 'ended' | 'error';
interface Logged {
  key: number;
  note: string;
  thumb: string;
  status: 'saving' | 'saved' | 'error';
  severity?: string;
  category?: string;
}

// Mic tap: posts raw Float32 frames to the main thread, which resamples to 16 kHz PCM16.
const WORKLET = `class PcmTap extends AudioWorkletProcessor {
  process(inputs) { const ch = inputs[0] && inputs[0][0]; if (ch) this.port.postMessage(ch.slice(0)); return true; }
}
registerProcessor('pcm-tap', PcmTap);`;

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export default function LiveInspectorPage() {
  const { walkId, roomId } = useParams<{ walkId: string; roomId: string }>();
  const [roomName, setRoomName] = useState('');
  const [liveUrl, setLiveUrl] = useState<string | null | undefined>(undefined);
  const [phase, setPhase] = useState<Phase>('intro');
  const [error, setError] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [heard, setHeard] = useState('');
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [left, setLeft] = useState(300);
  const [logged, setLogged] = useState<Logged[]>([]);

  const video = useRef<HTMLVideoElement>(null);
  const ws = useRef<WebSocket | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const capCtx = useRef<AudioContext | null>(null);
  const playCtx = useRef<AudioContext | null>(null);
  const sources = useRef(new Set<AudioBufferSourceNode>());
  const nextTime = useRef(0);
  const timers = useRef<number[]>([]);
  const mutedRef = useRef(false);
  const endsAt = useRef(0);
  const captionBuf = useRef('');
  const keySeq = useRef(0);

  useEffect(() => {
    api<{ rooms: Array<{ id: string; room_name: string }> }>(`/api/walks/${walkId}`)
      .then((d) => setRoomName(d.rooms.find((r) => r.id === roomId)?.room_name ?? 'Room'))
      .catch(() => setRoomName('Room'));
    api<{ url: string | null }>('/api/live/config')
      .then((c) => setLiveUrl(c.url))
      .catch(() => setLiveUrl(null));
  }, [walkId, roomId]);

  const teardown = useCallback(() => {
    timers.current.forEach((t) => clearInterval(t));
    timers.current = [];
    try {
      if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify({ type: 'end' }));
      ws.current?.close();
    } catch {}
    ws.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    sources.current.forEach((s) => {
      try {
        s.stop();
      } catch {}
    });
    sources.current.clear();
    void capCtx.current?.close().catch(() => {});
    void playCtx.current?.close().catch(() => {});
    capCtx.current = null;
    playCtx.current = null;
  }, []);

  useEffect(() => teardown, [teardown]);

  const stopPlayback = () => {
    sources.current.forEach((s) => {
      try {
        s.stop();
      } catch {}
    });
    sources.current.clear();
    nextTime.current = 0;
  };

  const play = (b64: string) => {
    const ctx = playCtx.current;
    if (!ctx) return;
    const bytes = fromBase64(b64);
    const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
    if (!pcm.length) return;
    const buf = ctx.createBuffer(1, pcm.length, 24000);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const at = Math.max(ctx.currentTime + 0.03, nextTime.current);
    src.start(at);
    nextTime.current = at + buf.duration;
    sources.current.add(src);
    src.onended = () => sources.current.delete(src);
  };

  const grabFrame = (maxEdge: number, quality: number): string | null => {
    const v = video.current;
    if (!v || !v.videoWidth) return null;
    const scale = Math.min(1, maxEdge / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(v.videoWidth * scale);
    c.height = Math.round(v.videoHeight * scale);
    c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', quality);
  };

  const logSnag = async (args: { description?: string; severity?: string; category?: string }) => {
    const dataUrl = grabFrame(1600, 0.85);
    if (!dataUrl) return;
    const key = ++keySeq.current;
    const note = String(args.description ?? '').slice(0, 200);
    setLogged((l) => [{ key, note, thumb: grabFrame(240, 0.6) ?? dataUrl, status: 'saving', severity: args.severity, category: args.category }, ...l]);
    try {
      const blob = await (await fetch(dataUrl)).blob();
      const form = new FormData();
      form.append('photo', new File([blob], `live-${Date.now()}.jpg`, { type: 'image/jpeg' }));
      form.append('note', note);
      const res = await api<{ snag: { severity: string; category: string; description: string } }>(
        `/api/rooms/${roomId}/snags`,
        { method: 'POST', body: form }
      );
      setLogged((l) =>
        l.map((x) =>
          x.key === key
            ? { ...x, status: 'saved', severity: res.snag.severity, category: res.snag.category, note: res.snag.description }
            : x
        )
      );
    } catch {
      setLogged((l) => l.map((x) => (x.key === key ? { ...x, status: 'error' } : x)));
    }
  };

  const start = async () => {
    if (!liveUrl) return;
    setError(null);
    setPhase('connecting');
    setCaption('');
    setHeard('');
    // Audio contexts are created and resumed inside the tap, before any await: iOS Safari only allows audio that
    // starts within the user gesture.
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const pc = new Ctx();
    const cc = new Ctx();
    playCtx.current = pc;
    capCtx.current = cc;
    const resumed = Promise.all([pc.resume(), cc.resume()]);
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      stream.current = media;
      if (video.current) {
        video.current.srcObject = media;
        await video.current.play().catch(() => {});
      }

      await resumed;

      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
      await cc.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const srcNode = cc.createMediaStreamSource(media);
      const tap = new AudioWorkletNode(cc, 'pcm-tap');
      const sink = cc.createGain();
      sink.gain.value = 0;
      srcNode.connect(tap);
      tap.connect(sink).connect(cc.destination);

      const socket = new WebSocket(`${liveUrl}?room=${encodeURIComponent(roomName || 'room')}`);
      ws.current = socket;

      // Resample the mic to 16 kHz PCM16 and send 100 ms chunks. While Gemini is talking the mic is gated, so the
      // phone speaker cannot interrupt it (earphones avoid the gap).
      const ratio = cc.sampleRate / 16000;
      let pending: number[] = [];
      let pos = 0;
      let out: number[] = [];
      tap.port.onmessage = (e: MessageEvent<Float32Array>) => {
        const input = e.data;
        pending = pending.concat(Array.from(input));
        while (pos + 1 < pending.length) {
          const i = Math.floor(pos);
          const f = pos - i;
          out.push(pending[i] * (1 - f) + pending[i + 1] * f);
          pos += ratio;
        }
        const drop = Math.floor(pos);
        pending = pending.slice(drop);
        pos -= drop;
        if (out.length >= 1600) {
          const chunk = out;
          out = [];
          const gated = mutedRef.current || (playCtx.current && playCtx.current.currentTime < nextTime.current + 0.25);
          if (gated || socket.readyState !== WebSocket.OPEN) return;
          const pcm = new Int16Array(chunk.length);
          for (let k = 0; k < chunk.length; k++) pcm[k] = Math.max(-1, Math.min(1, chunk[k])) * 0x7fff;
          socket.send(JSON.stringify({ type: 'audio', data: toBase64(new Uint8Array(pcm.buffer)) }));
        }
      };

      socket.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.type === 'ready') {
          setPhase('live');
          endsAt.current = Date.now() + (m.maxSeconds ?? 300) * 1000;
          timers.current.push(
            window.setInterval(() => {
              const frame = grabFrame(640, 0.6);
              if (frame && socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: 'frame', data: frame.split(',')[1] }));
              }
            }, 1000),
            window.setInterval(() => {
              setLeft(Math.max(0, Math.round((endsAt.current - Date.now()) / 1000)));
              setSpeaking(Boolean(playCtx.current && playCtx.current.currentTime < nextTime.current));
            }, 250)
          );
        } else if (m.type === 'audio') {
          play(m.data);
        } else if (m.type === 'transcript') {
          if (m.role === 'model') {
            captionBuf.current += m.text;
            setCaption(captionBuf.current);
          } else {
            setHeard((h) => (h + m.text).slice(-120));
          }
        } else if (m.type === 'turn') {
          captionBuf.current = '';
          setHeard('');
        } else if (m.type === 'interrupted') {
          stopPlayback();
          captionBuf.current = '';
        } else if (m.type === 'log_snag') {
          void logSnag(m.args ?? {});
        } else if (m.type === 'error') {
          setError(m.message);
        } else if (m.type === 'end') {
          teardown();
          setPhase((p) => (p === 'error' ? p : 'ended'));
        }
      };
      socket.onerror = () => {
        setError('Could not connect to the live inspector.');
        setPhase('error');
        teardown();
      };
      socket.onclose = () => {
        setPhase((p) => (p === 'live' || p === 'connecting' ? 'ended' : p));
        teardown();
      };
    } catch (e) {
      const name = (e as DOMException)?.name;
      setError(
        name === 'NotAllowedError'
          ? 'Camera or microphone permission was blocked. Allow both in your browser settings and try again.'
          : 'Could not start the camera and microphone on this device.'
      );
      setPhase('error');
      teardown();
    }
  };

  const end = () => {
    teardown();
    setPhase('ended');
  };

  const ask = (text: string) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify({ type: 'text', text }));
  };

  const toggleMute = () => {
    mutedRef.current = !mutedRef.current;
    setMuted(mutedRef.current);
  };

  const saved = logged.filter((l) => l.status === 'saved').length;
  const live = phase === 'live' || phase === 'connecting';

  return (
    <div className="min-h-[100dvh] bg-bg">
      {/* Camera stage. The video element always exists so the stream can attach before the socket is ready. */}
      <div className={cn('fixed inset-0 z-30 bg-black', !live && 'hidden')}>
        <video ref={video} playsInline muted className="absolute inset-0 size-full object-cover" />
        <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/70 to-transparent px-4 pb-10 pt-[max(14px,env(safe-area-inset-top))]">
          <div className="mx-auto flex max-w-3xl items-center gap-3 text-white">
            <span className="flex items-center gap-2 rounded-full bg-white/15 px-3 py-1.5 text-[13px] font-medium backdrop-blur">
              <span className={cn('size-2 rounded-full', phase === 'live' ? 'bg-[#ff5a4f] animate-pulse' : 'bg-white/60')} />
              {phase === 'live' ? 'Live' : 'Connecting'}
            </span>
            <span className="truncate text-[15px] font-semibold">{roomName}</span>
            <span className="tabular ml-auto flex items-center gap-1.5 text-[13px] text-white/80">
              <Timer className="size-4" />
              {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
            </span>
          </div>
        </div>

        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/60 to-transparent px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-16">
          <div className="mx-auto max-w-3xl">
            {logged.length > 0 && (
              <ul className="mb-3 flex gap-2 overflow-x-auto pb-1" aria-label="Defects logged">
                {logged.map((l) => (
                  <li key={l.key} className="demo-in flex w-60 shrink-0 items-center gap-2.5 rounded-2xl bg-white/95 p-2 pr-3 text-ink shadow-lg">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={l.thumb} alt="" className="size-12 shrink-0 rounded-xl object-cover" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        {l.status === 'saving' ? (
                          <span className="flex items-center gap-1 text-[12px] font-medium text-ink-2">
                            <CircleNotch className="size-3.5 animate-spin" weight="bold" /> Saving
                          </span>
                        ) : l.status === 'error' ? (
                          <span className="text-[12px] font-medium text-crit">Not saved</span>
                        ) : (
                          <SeverityBadge severity={l.severity ?? 'minor'} className="h-5 px-2 text-[11px]" />
                        )}
                        {l.category && <span className="truncate text-[11px] text-ink-3">{categoryLabel(l.category)}</span>}
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-ink-2">{l.note}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div aria-live="polite" className="min-h-[4.5rem] text-white">
              {phase === 'connecting' ? (
                <p className="flex items-center gap-2 text-[16px] text-white/85">
                  <CircleNotch className="size-5 animate-spin" weight="bold" /> Connecting to Gemini Live
                </p>
              ) : (
                <>
                  <p className="flex items-start gap-2 text-[17px] font-medium leading-snug [text-wrap:pretty]">
                    <Waveform className={cn('mt-0.5 size-5 shrink-0', speaking ? 'text-[#9db7ff]' : 'text-white/50')} weight="bold" />
                    <span className="line-clamp-3">{caption || (speaking ? '' : 'Listening. Point the camera and ask anything.')}</span>
                  </p>
                  {heard && <p className="mt-1.5 truncate pl-7 text-[13px] text-white/60">You: {heard}</p>}
                </>
              )}
            </div>

            {phase === 'live' && (
              <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                {['What do you see here?', 'Is this a defect? Log it if so.', 'What should I check next?'].map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => ask(q)}
                    className="h-9 shrink-0 rounded-full bg-white/15 px-3.5 text-[13px] font-medium text-white backdrop-blur transition-colors hover:bg-white/25"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}

            <div className="mt-3 flex items-center gap-2.5">
              <button
                type="button"
                onClick={toggleMute}
                aria-pressed={muted}
                aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
                className={cn(
                  'grid size-14 place-items-center rounded-full backdrop-blur transition-colors',
                  muted ? 'bg-white text-ink' : 'bg-white/15 text-white hover:bg-white/25'
                )}
              >
                {muted ? <MicrophoneSlash className="size-6" weight="bold" /> : <Microphone className="size-6" weight="bold" />}
              </button>
              <Button variant="danger" size="lg" onClick={end} className="flex-1">
                <PhoneDisconnect className="size-5" weight="bold" />
                End inspection{saved ? `, ${saved} logged` : ''}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {!live && (
        <main id="main" className="mx-auto max-w-xl px-4 pb-16 pt-6 sm:pt-12">
          <Link
            href={`/walks/${walkId}`}
            className="-ml-2 inline-flex h-11 items-center gap-1.5 rounded-full px-2 text-[15px] font-medium text-ink-2 hover:text-ink"
          >
            <ArrowLeft className="size-5" weight="bold" /> Back to rooms
          </Link>

          {phase === 'ended' ? (
            <Card className="demo-in mt-4 p-6">
              <p className="text-[13px] font-medium uppercase tracking-[0.08em] text-accent">Live inspection ended</p>
              <h1 className="mt-2 text-[26px] font-semibold tracking-[-0.02em]">
                {saved ? `${saved} ${saved === 1 ? 'defect' : 'defects'} logged in the ${roomName}` : `No defects logged in the ${roomName}`}
              </h1>
              {logged.length > 0 && (
                <ul className="mt-4 grid gap-2">
                  {logged.map((l) => (
                    <li key={l.key} className="flex items-center gap-3 rounded-field bg-surface-2 p-2 pr-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={l.thumb} alt="" className="size-12 rounded-lg object-cover" />
                      <p className="line-clamp-2 flex-1 text-[14px] text-ink-2">{l.note}</p>
                      {l.status === 'saved' && <SeverityBadge severity={l.severity ?? 'minor'} />}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-5 flex flex-wrap gap-2.5">
                <ButtonLink href={`/walks/${walkId}`}>Back to rooms</ButtonLink>
                <ButtonLink href={`/walks/${walkId}/letter`} variant="secondary">
                  Write builder letter
                </ButtonLink>
              </div>
            </Card>
          ) : (
            <Card className="mt-4 p-6 sm:p-8">
              <span className="grid size-12 place-items-center rounded-full bg-accent-soft text-accent">
                <Sparkle className="size-6" weight="fill" />
              </span>
              <h1 className="mt-4 text-[clamp(1.6rem,5vw,2.1rem)] font-semibold leading-tight tracking-[-0.03em]">
                Inspect the {roomName || 'room'} live with Gemini
              </h1>
              <p className="mt-3 text-[16px] leading-relaxed text-ink-2">
                Gemini watches through your camera, talks you through what to check, and logs each defect it sees with a
                photo. Ask it anything as you go, in English, Hindi or Marathi.
              </p>
              <ul className="mt-5 grid gap-3 text-[14px] text-ink-2">
                <li className="flex items-center gap-3">
                  <Headphones className="size-5 shrink-0 text-accent" /> Earphones work best, so it can hear you while it talks.
                </li>
                <li className="flex items-center gap-3">
                  <Lightbulb className="size-5 shrink-0 text-accent" /> Switch on the room lights and move slowly.
                </li>
                <li className="flex items-center gap-3">
                  <Camera className="size-5 shrink-0 text-accent" /> Video is not recorded. Only defect photos are saved to your walk.
                </li>
              </ul>
              {error && (
                <p role="alert" className="mt-5 flex items-start gap-2 rounded-field bg-crit-soft px-3.5 py-3 text-[14px] text-crit">
                  <WarningCircle className="mt-0.5 size-4 shrink-0" weight="fill" /> {error}
                </p>
              )}
              {liveUrl === null ? (
                <p className="mt-6 text-[14px] text-ink-3">The live inspector is not available right now.</p>
              ) : (
                <Button size="lg" className="mt-6 w-full" onClick={start} disabled={!liveUrl || !roomName}>
                  <Waveform className="size-5" weight="bold" />
                  {phase === 'error' ? 'Try again' : 'Start live inspection'}
                </Button>
              )}
              <p className="mt-3 text-center text-[12px] text-ink-3">Up to 5 minutes per session. Powered by Gemini Live.</p>
            </Card>
          )}
        </main>
      )}
    </div>
  );
}
