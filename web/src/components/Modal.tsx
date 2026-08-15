import { useEffect } from "react";
import type { ReactNode } from "react";

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}

export function Modal({ title, onClose, children, wide }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 px-4 py-10" onClick={onClose}>
      <div
        className={`w-full ${wide ? "max-w-4xl" : "max-w-lg"} rounded-lg border border-border bg-surface-1 shadow-2xl shadow-black/50`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h2 className="text-sm font-semibold text-ink-primary">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-ink-muted hover:bg-surface-2 hover:text-ink-secondary" title="Close">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
