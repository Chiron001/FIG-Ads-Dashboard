import type { Platform } from "@fig/shared";
import { ALL_PLATFORMS, PLATFORM_LABELS } from "@fig/shared";
import { PLATFORM_COLORS } from "../lib/platformColors";

interface Props {
  active: Platform;
  onChange: (p: Platform) => void;
  connected: Record<Platform, boolean>;
}

export function PlatformSidebar({ active, onChange, connected }: Props) {
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-surface-1">
      <div className="border-b border-border px-4 py-4">
        <h1 className="text-sm font-semibold leading-tight text-ink-primary">FIG Living</h1>
        <p className="text-xs text-ink-muted">Ads Dashboard</p>
      </div>

      <nav className="flex-1 space-y-0.5 p-2">
        <div className="px-2 pb-1.5 pt-2 text-[10px] font-medium uppercase tracking-wide text-ink-muted">Platforms</div>
        {ALL_PLATFORMS.map((platform) => {
          const isActive = platform === active;
          return (
            <button
              key={platform}
              type="button"
              onClick={() => onChange(platform)}
              className={`relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-2.5 text-left text-sm font-medium transition-colors ${
                isActive ? "bg-surface-2 text-ink-primary" : "text-ink-secondary hover:bg-surface-2/60 hover:text-ink-primary"
              }`}
            >
              {isActive && (
                <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full" style={{ background: PLATFORM_COLORS[platform] }} />
              )}
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: PLATFORM_COLORS[platform], opacity: connected[platform] ? 1 : 0.35 }}
              />
              <span className="flex-1 truncate">{PLATFORM_LABELS[platform]}</span>
              {!connected[platform] && <span className="shrink-0 text-[10px] text-ink-muted">not connected</span>}
            </button>
          );
        })}
      </nav>

      <div className="border-t border-border px-4 py-3 text-[11px] text-ink-muted">Internal tool — no login required</div>
    </aside>
  );
}
