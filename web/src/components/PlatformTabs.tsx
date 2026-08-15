import type { Platform } from "@fig/shared";
import { ALL_PLATFORMS, PLATFORM_LABELS } from "@fig/shared";
import { PLATFORM_COLORS } from "../lib/platformColors";

interface Props {
  active: Platform;
  onChange: (p: Platform) => void;
  connected: Record<Platform, boolean>;
}

export function PlatformTabs({ active, onChange, connected }: Props) {
  return (
    <div className="flex gap-1 border-b border-border">
      {ALL_PLATFORMS.map((platform) => {
        const isActive = platform === active;
        return (
          <button
            key={platform}
            type="button"
            onClick={() => onChange(platform)}
            className={`relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              isActive ? "text-ink-primary" : "text-ink-muted hover:text-ink-secondary"
            }`}
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: PLATFORM_COLORS[platform], opacity: connected[platform] ? 1 : 0.35 }}
            />
            {PLATFORM_LABELS[platform]}
            {!connected[platform] && <span className="text-[10px] text-ink-muted">(not connected)</span>}
            {isActive && (
              <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full" style={{ background: PLATFORM_COLORS[platform] }} />
            )}
          </button>
        );
      })}
    </div>
  );
}
