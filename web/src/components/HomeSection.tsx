import { useEffect, useRef, useState } from "react";
import type { AiQueryHistoryEntry } from "@fig/shared";
import { askAi, fetchAiHistory } from "../lib/api";

interface Props {
  aiConfigured: boolean;
  onGoToSettings: () => void;
}

interface Exchange {
  question: string;
  answer: string | null;
  error: string | null;
  loading: boolean;
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

// A handful of starting-point prompts, shown only before the first real
// question is ever asked -- once real history exists, that's more useful
// than these and takes over the same slot (see `recent` below).
const SUGGESTIONS = [
  "How is spend trending this week vs. last?",
  "Which platform has the best ROAS right now?",
  "What's our best-selling product this month?",
  "Any product where spend is up but sales aren't?",
];

/** The dashboard's landing page: a single natural-language question box,
 * answered by Claude grounded in a real statistical snapshot of the account
 * (see server/src/routes/ai.ts) -- deliberately no charts/KPI grid here, on
 * explicit request ("very much statistical", "don't flood it with charts").
 * A reader who wants to drill into a specific number still uses the
 * platform pages in the sidebar; this page answers the open-ended question
 * those pages can't ("how are we doing", "what needs attention"). */
export function HomeSection({ aiConfigured, onGoToSettings }: Props) {
  const [question, setQuestion] = useState("");
  const [exchange, setExchange] = useState<Exchange | null>(null);
  const [history, setHistory] = useState<AiQueryHistoryEntry[]>([]);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  function loadHistory() {
    fetchAiHistory()
      .then((res) => setHistory(res.entries))
      .catch(() => {});
  }

  useEffect(() => {
    loadHistory();
    inputRef.current?.focus();
  }, []);

  async function ask(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed || !aiConfigured) return;
    setExchange({ question: trimmed, answer: null, error: null, loading: true });
    setQuestion("");
    try {
      const res = await askAi(trimmed);
      setExchange({ question: trimmed, answer: res.answer, error: null, loading: false });
      loadHistory();
    } catch (err) {
      setExchange({ question: trimmed, answer: null, error: String((err as Error).message ?? err), loading: false });
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    ask(question);
  }

  const recent = history.slice(0, 3);

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center py-10 text-center">
      <div className="animate-fade-slide-in space-y-1.5">
        <h2 className="font-display text-2xl text-ink-primary">Ask anything about your ads and store</h2>
        <p className="text-sm text-ink-muted">
          Grounded in your last 30 days of Google, Meta, and Shopify data. For a specific number, the sidebar still has every
          platform's own page.
        </p>
      </div>

      {!aiConfigured && (
        <div className="animate-fade-slide-in mt-6 w-full rounded-xl border border-status-warning/30 bg-status-warning/10 px-4 py-3 text-sm text-ink-secondary">
          <span className="font-medium text-status-warning">Not set up yet.</span> Add an Anthropic API key in{" "}
          <button type="button" onClick={onGoToSettings} className="underline hover:text-ink-primary">
            Settings
          </button>{" "}
          to turn this on.
        </div>
      )}

      <form onSubmit={onSubmit} className="animate-fade-slide-in mt-6 w-full" style={{ animationDelay: "40ms" }}>
        <div className="flex items-end gap-2 rounded-2xl border border-border bg-surface-1 p-2 shadow-[var(--shadow-card)] transition-colors focus-within:border-accent">
          <textarea
            ref={inputRef}
            rows={1}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                ask(question);
              }
            }}
            placeholder={aiConfigured ? "e.g. Which SKUs are above target ROAS this month?" : "Add an API key in Settings to ask a question"}
            disabled={!aiConfigured}
            className="max-h-40 min-h-[2.5rem] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-ink-primary placeholder:text-ink-muted focus:outline-none disabled:cursor-not-allowed"
          />
          <button
            type="submit"
            disabled={!aiConfigured || !question.trim() || exchange?.loading}
            className="shrink-0 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-surface-0 transition-[transform,opacity] duration-[var(--duration-micro)] hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Ask
          </button>
        </div>
      </form>

      {!exchange && recent.length > 0 && (
        <div className="animate-fade-slide-in mt-4 flex w-full flex-wrap items-center justify-center gap-1.5 text-xs" style={{ animationDelay: "80ms" }}>
          <span className="text-ink-muted">Recent:</span>
          {recent.map((h) => (
            <button
              key={h.id}
              type="button"
              onClick={() => ask(h.question)}
              className="max-w-xs truncate rounded-full border border-border px-2.5 py-1 text-ink-secondary transition-colors hover:bg-surface-2 hover:text-ink-primary"
            >
              {h.question}
            </button>
          ))}
          <button type="button" onClick={() => setShowAllHistory(true)} className="text-ink-muted underline hover:text-ink-primary">
            Show all
          </button>
        </div>
      )}

      {!exchange && recent.length === 0 && aiConfigured && (
        <div className="animate-fade-slide-in mt-4 flex w-full flex-wrap items-center justify-center gap-1.5 text-xs" style={{ animationDelay: "80ms" }}>
          <span className="text-ink-muted">Try:</span>
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => ask(s)}
              className="rounded-full border border-border px-2.5 py-1 text-ink-secondary transition-colors hover:bg-surface-2 hover:text-ink-primary"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {exchange && (
        <div className="animate-fade-slide-in mt-6 w-full rounded-2xl border border-border bg-surface-1 p-5 text-left">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium text-ink-primary">{exchange.question}</p>
            <button
              type="button"
              onClick={() => setExchange(null)}
              aria-label="Clear"
              className="shrink-0 rounded-md p-1 text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink-primary"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M3 3L13 13M13 3L3 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <div className="mt-3 border-t border-border pt-3">
            {exchange.loading ? (
              <div className="space-y-2">
                <div className="skeleton h-3.5 w-full" />
                <div className="skeleton h-3.5 w-5/6" />
                <div className="skeleton h-3.5 w-2/3" />
              </div>
            ) : exchange.error ? (
              <p className="text-sm text-status-critical">{exchange.error}</p>
            ) : (
              <p className="whitespace-pre-line text-sm leading-relaxed text-ink-secondary">{exchange.answer}</p>
            )}
          </div>
          {!exchange.loading && (
            <button type="button" onClick={() => setExchange(null)} className="mt-3 text-xs text-ink-muted underline hover:text-ink-primary">
              Ask another question
            </button>
          )}
        </div>
      )}

      {showAllHistory && (
        <HistoryModal
          entries={history}
          onClose={() => setShowAllHistory(false)}
          onSelect={(q) => {
            setShowAllHistory(false);
            ask(q);
          }}
        />
      )}
    </div>
  );
}

function HistoryModal({ entries, onClose, onSelect }: { entries: AiQueryHistoryEntry[]; onClose: () => void; onSelect: (q: string) => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[10vh]">
      <button type="button" aria-label="Close" onClick={onClose} className="animate-fade-slide-in absolute inset-0 bg-black/60" />
      <div role="dialog" aria-label="Question history" className="glass animate-fade-slide-in relative w-full max-w-lg overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <span className="text-sm font-medium text-ink-primary">Question history</span>
          <span className="text-xs text-ink-muted">Last {entries.length}</span>
        </div>
        <div className="max-h-96 overflow-y-auto p-1.5">
          {entries.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-ink-muted">Nothing asked yet.</div>
          ) : (
            entries.map((h) => (
              <button
                key={h.id}
                type="button"
                onClick={() => onSelect(h.question)}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-ink-secondary transition-colors hover:bg-white/8 hover:text-ink-primary"
              >
                <span className="min-w-0 flex-1 truncate">{h.question}</span>
                <span className="shrink-0 text-xs text-ink-muted">{relativeTime(h.createdAt)}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
