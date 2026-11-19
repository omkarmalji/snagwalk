'use client';

import { useRef, type DependencyList, type RefObject } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(useGSAP);

export { gsap, useGSAP };

export const EASE = 'expo.out';
const NO_MOTION = '(prefers-reduced-motion: reduce)';

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(NO_MOTION).matches;
}

/**
 * Staggers in every not-yet-revealed [data-reveal] element inside the scope.
 * Re-runs when deps change, so content that arrives after a fetch animates in once, in document order.
 * Communicates hierarchy: summary first, then the list.
 */
export function useReveal(scope: RefObject<HTMLElement | null>, deps: DependencyList = []) {
  useGSAP(
    () => {
      const els = gsap.utils
        .toArray<HTMLElement>('[data-reveal]:not([data-revealed])', scope.current)
        .filter((el) => el.offsetParent !== null || el.getClientRects().length > 0);
      if (!els.length) return;
      els.forEach((el) => el.setAttribute('data-revealed', ''));
      if (prefersReducedMotion()) {
        gsap.set(els, { autoAlpha: 1 });
        return;
      }
      gsap.fromTo(
        els,
        { autoAlpha: 0, y: 14 },
        { autoAlpha: 1, y: 0, duration: 0.7, ease: EASE, stagger: 0.05, clearProps: 'transform' }
      );
      // On revert (unmount, or StrictMode's dev double-mount) forget the marker so a remount animates again.
      return () => els.forEach((el) => el.removeAttribute('data-revealed'));
    },
    { scope, dependencies: [...deps] }
  );
}

/** Animates a number from its previous value to the new one. Feedback when a snag is added. */
export function useCountUp(value: number) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(0);
  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      const from = prev.current;
      prev.current = value;
      if (prefersReducedMotion() || from === value) {
        el.textContent = String(value);
        return;
      }
      const obj = { n: from };
      gsap.to(obj, {
        n: value,
        duration: 0.9,
        ease: 'power3.out',
        onUpdate: () => {
          el.textContent = String(Math.round(obj.n));
        },
      });
      gsap.fromTo(el, { y: from < value ? 6 : -6 }, { y: 0, duration: 0.5, ease: EASE });
    },
    { dependencies: [value] }
  );
  return ref;
}
