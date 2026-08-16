import { useEffect, useState } from "react";

/** Tracks a media-query boolean live (not just at mount) -- both
 * prefers-reduced-motion and prefers-reduced-transparency can flip while the
 * app is open (a user toggling an OS setting), and the spec calls both
 * mandatory to respect, not just "read once." */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => (typeof window !== "undefined" ? window.matchMedia(query).matches : false));

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/** Count-ups, the flow band's draw-in animation, and the page-load stagger
 * all gate on this -- CSS transitions/animations are handled globally by the
 * `prefers-reduced-motion` block in index.css, but anything driven from JS
 * (requestAnimationFrame loops, a component skipping straight to the final
 * value) needs this explicitly. */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}

/** Glass surfaces drop to solid via CSS alone (index.css's
 * prefers-reduced-transparency block) -- this is exposed for the rare case a
 * component needs to know in JS too (none currently do, kept for parity with
 * the motion hook and because the spec calls it out as its own, equally
 * mandatory preference). */
export function usePrefersReducedTransparency(): boolean {
  return useMediaQuery("(prefers-reduced-transparency: reduce)");
}
