import { useState } from "react";
import type { Platform } from "@fig/shared";
import { ALL_PLATFORMS, PLATFORM_LABELS } from "@fig/shared";
import { PLATFORM_COLORS } from "../lib/platformColors";
import { PlatformIcon } from "./icons/PlatformIcon";

interface Props {
  active: Platform;
  onChange: (p: Platform) => void;
  connected: Record<Platform, boolean>;
}

// No localStorage per spec (React state only) -- collapse state is a
// per-session UI preference, not data, so resetting on reload is fine.
export function PlatformSidebar({ active, onChange, connected }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={`flex shrink-0 flex-col border-r border-border bg-surface-1 transition-[width] duration-200 ${
        collapsed ? "w-16" : "w-60"
      }`}
    >
      <div className={`flex items-center border-b border-border ${collapsed ? "justify-center px-2 py-4" : "gap-2.5 px-4 py-4"}`}>
        <img src="/figliving-logo.png" alt="FIG Living" className="h-6 w-6 shrink-0 object-contain invert" />
        {!collapsed && (
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold leading-tight text-ink-primary">FIG Living</h1>
            <p className="truncate text-xs text-ink-muted">Ads Dashboard</p>
          </div>
        )}
      </div>

      <nav className="flex-1 space-y-0.5 p-2">
        {!collapsed && <div className="px-2 pb-1.5 pt-2 text-[10px] font-medium uppercase tracking-wide text-ink-muted">Platforms</div>}
        {ALL_PLATFORMS.map((platform) => {
          const isActive = platform === active;
          return (
            <button
              key={platform}
              type="button"
              title={collapsed ? `${PLATFORM_LABELS[platform]}${connected[platform] ? "" : " (not connected)"}` : undefined}
              onClick={() => onChange(platform)}
              className={`relative flex w-full items-center rounded-md text-left text-sm font-medium transition-colors ${
                collapsed ? "justify-center px-2 py-2.5" : "gap-2.5 px-2.5 py-2.5"
              } ${isActive ? "bg-surface-2 text-ink-primary" : "text-ink-secondary hover:bg-surface-2/60 hover:text-ink-primary"}`}
            >
              {isActive && (
                <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full" style={{ background: PLATFORM_COLORS[platform] }} />
              )}
              <span className="relative shrink-0" style={{ opacity: connected[platform] ? 1 : 0.4 }}>
                <PlatformIcon platform={platform} size={18} />
              </span>
              {!collapsed && (
                <>
                  <span className="flex-1 truncate">{PLATFORM_LABELS[platform]}</span>
                  {!connected[platform] && <span className="shrink-0 text-[10px] text-ink-muted">not connected</span>}
                </>
              )}
            </button>
          );
        })}
      </nav>

      <div className={`border-t border-border ${collapsed ? "flex justify-center py-2" : "px-4 py-3"}`}>
        {!collapsed && <div className="mb-2 text-[11px] text-ink-muted">Internal tool — no login required</div>}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={`flex items-center gap-2 rounded-md text-ink-muted hover:bg-surface-2 hover:text-ink-secondary transition-colors ${
            collapsed ? "p-2" : "w-full px-2 py-1.5 text-xs"
          }`}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            className={`shrink-0 transition-transform ${collapsed ? "rotate-180" : ""}`}
          >
            <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M14 3L9 8l5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {!collapsed && "Collapse"}
        </button>
      </div>
    </aside>
  );
}
