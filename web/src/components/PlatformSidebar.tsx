import { useState } from "react";
import type { Platform } from "@fig/shared";
import { ALL_PLATFORMS, PLATFORM_LABELS } from "@fig/shared";
import { PLATFORM_COLORS } from "../lib/platformColors";
import { PlatformIcon } from "./icons/PlatformIcon";
import { ShopifyIcon } from "./icons/ShopifyIcon";

/** What can be selected in the sidebar -- the 4 ad platforms, plus Shopify
 * (not an ad platform -- no spend/campaigns, not in the shared Platform
 * union), plus Meta's SKU Attribution and Creative Performance sub-views
 * (nested under Meta Ads in the nav, not platforms of their own). */
export type SidebarSelection = Platform | "shopify" | "meta-sku-attribution" | "meta-creative-performance";

const SHOPIFY_COLOR = "#95BF47";

interface Props {
  active: SidebarSelection;
  onChange: (selection: SidebarSelection) => void;
  connected: Record<Platform, boolean>;
  shopifyConnected: boolean;
  /** Mobile-only: whether the sidebar is showing as an overlay drawer.
   * Ignored at sm: and above, where the sidebar is always part of the
   * static layout (collapsed/expanded via its own button instead). */
  mobileOpen: boolean;
  onMobileClose: () => void;
}

function TagIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M2 2h5.5L14 8.5 8.5 14 2 7.5V2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <circle cx="5" cy="5" r="1" fill="currentColor" />
    </svg>
  );
}

function FilmIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <rect x="2" y="3" width="12" height="10" rx="1.3" stroke="currentColor" strokeWidth="1.3" />
      <path d="M2 6.2h12M5.5 3v3.2M10.5 3v3.2" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}

// No localStorage per spec (React state only) -- collapse state is a
// per-session UI preference, not data, so resetting on reload is fine.
export function PlatformSidebar({ active, onChange, connected, shopifyConnected, mobileOpen, onMobileClose }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  // Picking a destination on mobile should also close the drawer -- it's
  // an overlay there, not part of the static layout.
  function handleChange(selection: SidebarSelection) {
    onChange(selection);
    onMobileClose();
  }

  return (
    <>
      {/* Backdrop -- mobile only, dismisses the drawer on tap outside it. */}
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={onMobileClose}
          className="animate-fade-slide-in fixed inset-0 z-30 bg-black/60 sm:hidden"
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex shrink-0 flex-col border-r border-border bg-surface-1 transition-[transform,width] duration-200 sm:static sm:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        } ${collapsed ? "w-16" : "w-60"}`}
      >
        <div className={`flex items-center border-b border-border ${collapsed ? "flex-col gap-2 px-2 py-3" : "gap-2.5 px-4 py-4"}`}>
          <div className={`flex min-w-0 flex-1 items-center ${collapsed ? "justify-center" : "gap-2.5"}`}>
            <img src="/figliving-logo.png" alt="FIG Living" className="h-6 w-6 shrink-0 object-contain invert" />
            {!collapsed && (
              <div className="min-w-0">
                <h1 className="font-display truncate text-sm font-semibold leading-tight text-ink-primary">FIG Living</h1>
                <p className="truncate text-xs text-ink-muted">Ads Dashboard</p>
              </div>
            )}
          </div>
          {/* Collapse toggle -- top of the sidebar, next to the logo, not
              buried at the bottom where it's easy to miss on first use. */}
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="shrink-0 rounded-md p-1.5 text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink-secondary"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className={`transition-transform ${collapsed ? "rotate-180" : ""}`}>
              <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M14 3L9 8l5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
          {!collapsed && <div className="px-2 pb-1.5 pt-2 text-[10px] font-medium uppercase tracking-wide text-ink-muted">Platforms</div>}
          {ALL_PLATFORMS.map((platform) => {
            const isActive = platform === active;
            return (
              <div key={platform}>
                <button
                  type="button"
                  title={collapsed ? `${PLATFORM_LABELS[platform]}${connected[platform] ? "" : " (not connected)"}` : undefined}
                  onClick={() => handleChange(platform)}
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

                {/* Meta-only sub-views: each a lens on Meta's own ad-name-
                    tagging data, not a platform of their own. Collapsed
                    mode swaps the text row for a small icon-only button
                    (title tooltip for identification) instead of hiding
                    them outright -- they stayed reachable at every
                    sidebar width, not just when expanded. */}
                {platform === "meta" && collapsed && (
                  <div className="mt-0.5 flex flex-col items-center gap-0.5">
                    <button
                      type="button"
                      title="Meta Ads — SKU Attribution"
                      onClick={() => handleChange("meta-sku-attribution")}
                      className={`rounded-md p-1.5 transition-colors ${
                        active === "meta-sku-attribution" ? "bg-surface-2 text-ink-primary" : "text-ink-muted hover:bg-surface-2/60 hover:text-ink-secondary"
                      }`}
                    >
                      <TagIcon size={13} />
                    </button>
                    <button
                      type="button"
                      title="Meta Ads — Creative Performance"
                      onClick={() => handleChange("meta-creative-performance")}
                      className={`rounded-md p-1.5 transition-colors ${
                        active === "meta-creative-performance" ? "bg-surface-2 text-ink-primary" : "text-ink-muted hover:bg-surface-2/60 hover:text-ink-secondary"
                      }`}
                    >
                      <FilmIcon size={13} />
                    </button>
                  </div>
                )}
                {platform === "meta" && !collapsed && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleChange("meta-sku-attribution")}
                      className={`relative mt-0.5 flex w-full items-center gap-2 rounded-md py-2 pl-8 pr-2.5 text-left text-xs font-medium transition-colors ${
                        active === "meta-sku-attribution"
                          ? "bg-surface-2 text-ink-primary"
                          : "text-ink-muted hover:bg-surface-2/60 hover:text-ink-secondary"
                      }`}
                    >
                      {active === "meta-sku-attribution" && (
                        <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full" style={{ background: PLATFORM_COLORS.meta }} />
                      )}
                      <span className="truncate">↳ SKU Attribution</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleChange("meta-creative-performance")}
                      className={`relative mt-0.5 flex w-full items-center gap-2 rounded-md py-2 pl-8 pr-2.5 text-left text-xs font-medium transition-colors ${
                        active === "meta-creative-performance"
                          ? "bg-surface-2 text-ink-primary"
                          : "text-ink-muted hover:bg-surface-2/60 hover:text-ink-secondary"
                      }`}
                    >
                      {active === "meta-creative-performance" && (
                        <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full" style={{ background: PLATFORM_COLORS.meta }} />
                      )}
                      <span className="truncate">↳ Creative Performance</span>
                    </button>
                  </>
                )}
              </div>
            );
          })}

          {/* Shopify isn't an ad platform -- ground-truth orders/products, own
              group so it doesn't read as "a 5th platform" it isn't. */}
          {!collapsed && <div className="px-2 pb-1.5 pt-4 text-[10px] font-medium uppercase tracking-wide text-ink-muted">Store</div>}
          <button
            type="button"
            title={collapsed ? `Shopify${shopifyConnected ? "" : " (not connected)"}` : undefined}
            onClick={() => handleChange("shopify")}
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

        {!collapsed && (
          <div className="border-t border-border px-4 py-3 text-[11px] text-ink-muted">Internal tool, no login required</div>
        )}
      </aside>
    </>
  );
}
