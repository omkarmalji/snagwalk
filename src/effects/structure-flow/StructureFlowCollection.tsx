'use client';

import { useEffect, useRef, useState } from 'react';
import { NebulaBackground, type NeuformCraftEffectProps } from './NeuformCraftEffects';

/**
 * Family entry point for ThreeUI Structure Flow. Only the Nebula variant ships in this project (registered source
 * bundle nebula.json); other variants are not included.
 *
 * Host responsibilities, outside the authored renderer:
 * - a sized, overflow-controlled parent (`.threeui-background`)
 * - forwarding pointer positions into the sandboxed frame, so the authored pointer drift works behind content
 * - prefers-reduced-motion: a static frame of the same palette instead of the animated field
 */
export type StructureFlowVariant = 'nebula';

export type StructureFlowCollectionProps = NeuformCraftEffectProps & { variant: StructureFlowVariant };

export function StructureFlowCollection({ variant, className, ...props }: StructureFlowCollectionProps) {
  const host = useRef<HTMLDivElement>(null);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (reduced) return;
    let frame = 0;
    let last: { x: number; y: number } | null = null;
    const send = () => {
      frame = 0;
      const target = host.current?.querySelector('iframe')?.contentWindow;
      if (target && last) target.postMessage({ type: 'threeui:pointer', x: last.x, y: last.y }, '*');
    };
    const onMove = (e: PointerEvent) => {
      // clientWidth excludes the scrollbar, matching the fixed full-viewport frame.
      const root = document.documentElement;
      last = { x: e.clientX / root.clientWidth, y: e.clientY / root.clientHeight };
      if (!frame) frame = requestAnimationFrame(send);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [reduced]);

  if (variant !== 'nebula') return null;

  return (
    <div ref={host} className={['threeui-background', className].filter(Boolean).join(' ')}>
      {reduced ? (
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse 70% 80% at 72% 18%, rgb(24 44 120 / 0.85), transparent 70%), radial-gradient(ellipse 50% 60% at 100% 55%, rgb(18 34 96 / 0.7), transparent 70%), #09090b',
          }}
        />
      ) : (
        <NebulaBackground {...props} style={{ pointerEvents: 'none' }} />
      )}
    </div>
  );
}
