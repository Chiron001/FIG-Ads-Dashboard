import { useState } from "react";
import type { Platform } from "@fig/shared";
import { ALL_PLATFORMS, PLATFORM_LABELS } from "@fig/shared";
import { PLATFORM_COLORS } from "../lib/platformColors";
import { PlatformIcon } from "./icons/PlatformIcon";
import { ShopifyIcon } from "./icons/ShopifyIcon";

/** What can be selected in the sidebar -- the 4 ad platforms, plus Shopify,
 * which isn't an ad platform (no spend/campaigns) and so isn't in the
 * shared Platform union; it's a separate section entirely. */
export type SidebarSelection = Platform | "shopify";

const SHOPIFY_COLOR = "#95BF47";

interface Props {
  active: SidebarSelection;
  onChange: (selection: SidebarSelection) => void;
  connected: Record<Platform, boolean>;
  shopifyConnected: boolean;
}

// No localStorage per spec (React state only) -- collapse state is a
// per-session UI preference, not data, so resetting on reload is fine.
export function PlatformSidebar({ active, onChange, connected, shopifyConnected }: Props) {
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

      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
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

        {/* Shopify isn't an ad platform -- ground-truth orders/products, own
            group so it doesn't read as "a 5th platform" it isn't. */}
        {!collapsed && <div className="px-2 pb-1.5 pt-4 text-[10px] font-medium uppercase tracking-wide text-ink-muted">Store</div>}
        <button
          type="button"
          title={collapsed ? `Shopify${shopifyConnected ? "" : " (not connected)"}` : undefined}
          onClick={() => onChange("shopify")}
          className={`relative flex w-full items-center rounded-md text-left text-sm font-medium transition-colors ${
            collapsed ? "mt-4 justify-center px-2 py-2.5" : "gap-2.5 px-2.5 py-2.5"
          } ${active === "shopify" ? "bg-surface-2 text-ink-primary" : "text-ink-secondary hover:bg-surface-2/60 hover:text-ink-primary"}`}
        >
          {active === "shopify" && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full" style={{ background: SHOPIFY_COLOR }} />}
          <span className="relative shrink-0" style={{ opacity: shopifyConnected ? 1 : 0.4 }}>
            <ShopifyIcon size={18} />
          </span>
          {!collapsed && (
            <>
              <span className="flex-1 truncate">Shopify</span>
              {!shopifyConnected && <span className="shrink-0 text-[10px] text-ink-muted">not connected</span>}
            </>
          )}
        </button>
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
