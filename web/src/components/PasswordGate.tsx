import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { checkSitePassword } from "../lib/api";
import { getStoredPassword, setStoredPassword, clearStoredPassword } from "../lib/sitePassword";

type Status = "checking" | "locked" | "unlocked";

/** Whole-site gate -- wraps <App/> in main.tsx. On mount, silently
 * revalidates a previously-stored password against the server (so a
 * rotated SITE_PASSWORD bounces stale browsers back to the form instead of
 * trusting a cached value forever); shows the form immediately if nothing's
 * stored. Deliberately simple, matching what was asked for: one shared
 * password, not real per-user accounts. */
export function PasswordGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("checking");
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const stored = getStoredPassword();
    if (!stored) {
      setStatus("locked");
      return;
    }
    checkSitePassword(stored)
      .then((ok) => setStatus(ok ? "unlocked" : "locked"))
      .catch(() => setStatus("locked"));
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!input) return;
    setSubmitting(true);
    setError(null);
    try {
      const ok = await checkSitePassword(input);
      if (ok) {
        setStoredPassword(input);
        setStatus("unlocked");
      } else {
        clearStoredPassword();
        setError("Incorrect password.");
      }
    } catch {
      setError("Couldn't reach the server -- try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (status === "checking") {
    return (
      <div className="flex h-screen items-center justify-center bg-surface-0">
        <div className="skeleton h-8 w-8 rounded-full" />
      </div>
    );
  }

  if (status === "unlocked") return <>{children}</>;

  return (
    <div className="flex h-screen items-center justify-center bg-surface-0 px-4">
      <form onSubmit={handleSubmit} className="glass animate-fade-slide-in w-full max-w-sm rounded-2xl p-6">
        <div className="flex items-center gap-2.5">
          <img src="/figliving-logo.png" alt="FIG Living" className="h-7 w-7 shrink-0 object-contain invert" />
          <div>
            <h1 className="font-display text-sm font-semibold text-ink-primary">FIG Living</h1>
            <p className="text-xs text-ink-muted">Ads Dashboard</p>
          </div>
        </div>
        <p className="mt-4 text-sm text-ink-secondary">This is a private internal tool. Enter the password to continue.</p>
        <input
          type="password"
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Password"
          className="mt-4 w-full rounded-md border border-border bg-surface-0 px-3 py-2 text-sm text-ink-primary placeholder:text-ink-muted"
        />
        {error && <p className="mt-2 text-xs text-status-critical">{error}</p>}
        <button
          type="submit"
          disabled={submitting || input.length === 0}
          className="mt-4 w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-surface-0 transition-[transform,opacity] duration-[var(--duration-micro)] hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? "Checking…" : "Enter"}
        </button>
      </form>
    </div>
  );
}
