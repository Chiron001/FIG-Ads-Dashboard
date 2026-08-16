import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "./motion";

const EASE_OUT = (t: number) => 1 - Math.pow(1 - t, 3);

/** Ticks a displayed number from its previous value to `target` over
 * ~600ms on change (KPI tiles, first load / range change) -- skipped
 * entirely under prefers-reduced-motion, where it just jumps straight to
 * the target. Null/undefined targets pass through unanimated (nothing to
 * count up to). */
export function useCountUp(target: number | null | undefined, durationMs = 600): number | null | undefined {
  const reducedMotion = usePrefersReducedMotion();
  const [display, setDisplay] = useState(target);
  const [prevTarget, setPrevTarget] = useState(target);
  const fromRef = useRef(0);
  const rafRef = useRef<number | undefined>(undefined);

  // "Adjust state during render" (React's documented pattern for reacting
  // to a prop change without an effect's extra committed frame) -- this
  // runs in the SAME render where `target` changes, so the very first paint
  // after a new value arrives already shows the animation's start point.
  // An effect-based sync here left a one-frame gap where `display` was
  // still stale (often still null/undefined), and the caller's
  // undefined-guard fell back to showing the *final* formatted value for
  // that one frame before the count-up visibly restarted from 0 under it.
  if (target !== prevTarget) {
    setPrevTarget(target);
    if (target == null || reducedMotion) {
      setDisplay(target);
    } else {
      fromRef.current = display ?? 0;
      setDisplay(fromRef.current);
    }
  }

  useEffect(() => {
    if (target == null || reducedMotion || fromRef.current === target) return;
    const from = fromRef.current;
    const to = target; // narrowed to `number`; TS doesn't retain the null-check narrowing on `target` itself across the nested tick() closure
    // Captured from the FIRST rAF callback's own timestamp, not a separate
    // performance.now() call made just before scheduling it -- rAF
    // timestamps mark when the browser's current frame cycle began, which
    // can be a hair earlier than a synchronous call made moments later in
    // the same task, so a separately-captured `start` can end up AFTER the
    // first callback's `now`, producing a negative elapsed time on frame
    // one and a garbage (occasionally negative) eased value.
    let start: number | null = null;
    function tick(now: number) {
      if (start === null) start = now;
      const t = Math.min(1, Math.max(0, (now - start) / durationMs));
      const eased = EASE_OUT(t);
      setDisplay(from + (to - from) * eased);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
      }
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [target, reducedMotion, durationMs]);

  return display;
}
