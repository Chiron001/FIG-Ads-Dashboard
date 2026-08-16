import { useEffect, useRef, useState, type ReactNode } from "react";

interface Props {
  tone?: "warning" | "info" | "good";
  /** Accessible label AND the tooltip shown on hover, e.g. "About this figure". */
  label: string;
  children: ReactNode;
  /** Popover opens to the left instead of the right -- use near the right
   * edge of the viewport so it doesn't overflow. */
  align?: "left" | "right";
}

const TONE_VAR: Record<NonNullable<Props["tone"]>, string> = {
  warning: "var(--color-status-warning)",
  info: "var(--color-status-info)",
  good: "var(--color-status-good)",
};

/** A small "i" trigger that reveals a glass popover on click -- the compact
 * alternative to a permanently-visible banner. Used for the caveat/
 * attribution notes that used to run the full width of the page: the
 * information is one click away rather than always taking up vertical
 * space, which reads calmer and less "generated." */
export function InfoNote({ tone = "info", label, children, align = "left" }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const color = TONE_VAR[tone];

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <span className="relative inline-flex" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        title={label}
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold transition-colors"
        style={{ borderColor: `color-mix(in oklab, ${color} 50%, transparent)`, color }}
      >
        i
      </button>
      {open && (
        <div
          className={`glass animate-fade-slide-in absolute top-full z-30 mt-2 w-80 rounded-xl p-3 text-xs leading-relaxed text-ink-secondary ${
            align === "left" ? "left-0" : "right-0"
          }`}
        >
          {children}
        </div>
      )}
    </span>
  );
}
