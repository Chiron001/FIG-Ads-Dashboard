import { useState } from "react";
import type { Platform } from "@fig/shared";
import { ALL_PLATFORMS, PLATFORM_LABELS } from "@fig/shared";
import { PLATFORM_COLORS } from "../lib/platformColors";
import type { Theme } from "../lib/theme";
import { PlatformIcon } from "./icons/PlatformIcon";
import { ShopifyIcon } from "./icons/ShopifyIcon";

/** What can be selected in the sidebar -- the 4 ad platforms, plus Shopify
 * (not an ad platform -- no spend/campaigns, not in the shared Platform
 * union), plus Meta's SKU Attribution and Creative Performance sub-views
 * and Google's SKU Attribution sub-view (nested under their respective
 * platforms in the nav, not platforms of their own), plus Shopify's
 * Product Quadrants and Projection Sheet sub-views (nested under Shopify
 * the same way), plus Settings (app-wide config, its own top-level
 * group -- not tied to any one platform or Shopify). */
export type SidebarSelection =
  | Platform
  | "shopify"
  | "meta-sku-attribution"
  | "meta-creative-performance"
  | "google-sku-attribution"
  | "shopify-product-quadrants"
  | "shopify-projection-sheet"
  | "settings";

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
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
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

function QuadrantIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <rect x="2" y="2" width="12" height="12" rx="1.3" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}

function TargetIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.1" />
      <circle cx="8" cy="8" r="0.9" fill="currentColor" />
    </svg>
  );
}

function GearIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="2.3" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M8 1.6v1.5M8 12.9v1.5M14.4 8h-1.5M3.1 8H1.6M12.3 3.7l-1.06 1.06M4.76 11.24l-1.06 1.06M12.3 12.3l-1.06-1.06M4.76 4.76 3.7 3.7"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SunIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M8 1.3v1.5M8 13.2v1.5M14.7 8h-1.5M2.8 8H1.3M12.6 3.4l-1.06 1.06M4.46 11.54l-1.06 1.06M12.6 12.6l-1.06-1.06M4.46 4.46 3.4 3.4"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M13.5 9.3A5.6 5.6 0 1 1 6.7 2.5a4.4 4.4 0 0 0 6.8 6.8Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

// No localStorage per spec (React state only) -- collapse state is a
// per-session UI preference, not data, so resetting on reload is fine.
export function PlatformSidebar({ active, onChange, connected, shopifyConnected, mobileOpen, onMobileClose, theme, onThemeChange }: Props) {
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
        className={`fixed inset-y-0 left-0 z-40 flex shrink-0 flex-col border-r border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] transition-[transform,width] duration-200 sm:static sm:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        } ${collapsed ? "w-16" : "w-60"}`}
      >
        <div className={`flex items-center border-b border-[var(--sidebar-border)] ${collapsed ? "flex-col gap-2 px-2 py-3" : "gap-2.5 px-4 py-4"}`}>
          <div className={`flex min-w-0 flex-1 items-center ${collapsed ? "justify-center" : "gap-2.5"}`}>
            <img src="/figliving-logo.png" alt="FIG Living" className="h-6 w-6 shrink-0 object-contain invert" />
            {!collapsed && (
              <div className="min-w-0">
                <h1 className="font-display truncate text-sm font-semibold leading-tight text-[var(--sidebar-ink-primary)]">FIG Living</h1>
                <p className="truncate text-xs text-[var(--sidebar-ink-muted)]">Ads Dashboard</p>
              </div>
            )}
          </div>
          {/* Collapse toggle -- top of the sidebar, next to the logo, not
              buried at the bottom where it's easy to miss on first use. */}
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="shrink-0 rounded-md p-1.5 text-[var(--sidebar-ink-muted)] transition-colors hover:bg-[var(--sidebar-active-bg)] hover:text-[var(--sidebar-ink-secondary)]"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className={`transition-transform ${collapsed ? "rotate-180" : ""}`}>
              <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M14 3L9 8l5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        <nav className="flex flex-1 flex-col space-y-0.5 overflow-y-auto p-2">
          {!collapsed && <div className="px-2 pb-1.5 pt-2 text-[10px] font-medium uppercase tracking-wide text-[var(--sidebar-ink-muted)]">Platforms</div>}
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
                  } ${isActive ? "bg-[var(--sidebar-active-bg)] text-[var(--sidebar-ink-primary)]" : "text-[var(--sidebar-ink-secondary)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--sidebar-ink-primary)]"}`}
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
                      {!connected[platform] && <span className="shrink-0 text-[10px] text-[var(--sidebar-ink-muted)]">not connected</span>}
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
                        active === "meta-sku-attribution" ? "bg-[var(--sidebar-active-bg)] text-[var(--sidebar-ink-primary)]" : "text-[var(--sidebar-ink-muted)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--sidebar-ink-secondary)]"
                      }`}
                    >
                      <TagIcon size={13} />
                    </button>
                    <button
                      type="button"
                      title="Meta Ads — Creative Performance"
                      onClick={() => handleChange("meta-creative-performance")}
                      className={`rounded-md p-1.5 transition-colors ${
                        active === "meta-creative-performance" ? "bg-[var(--sidebar-active-bg)] text-[var(--sidebar-ink-primary)]" : "text-[var(--sidebar-ink-muted)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--sidebar-ink-secondary)]"
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
                          ? "bg-[var(--sidebar-active-bg)] text-[var(--sidebar-ink-primary)]"
                          : "text-[var(--sidebar-ink-muted)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--sidebar-ink-secondary)]"
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
                          ? "bg-[var(--sidebar-active-bg)] text-[var(--sidebar-ink-primary)]"
                          : "text-[var(--sidebar-ink-muted)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--sidebar-ink-secondary)]"
                      }`}
                    >
                      {active === "meta-creative-performance" && (
                        <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full" style={{ background: PLATFORM_COLORS.meta }} />
                      )}
                      <span className="truncate">↳ Creative Performance</span>
                    </button>
                  </>
                )}

                {/* Google-only sub-view: same idea as Meta's SKU Attribution
                    above, but exact rather than a name-tag guess -- see
                    GoogleSkuAttributionSection's header comment. */}
                {platform === "google" && collapsed && (
                  <div className="mt-0.5 flex flex-col items-center gap-0.5">
                    <button
                      type="button"
                      title="Google Ads — SKU Attribution"
                      onClick={() => handleChange("google-sku-attribution")}
                      className={`rounded-md p-1.5 transition-colors ${
                        active === "google-sku-attribution" ? "bg-[var(--sidebar-active-bg)] text-[var(--sidebar-ink-primary)]" : "text-[var(--sidebar-ink-muted)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--sidebar-ink-secondary)]"
                      }`}
                    >
                      <TagIcon size={13} />
                    </button>
                  </div>
                )}
                {platform === "google" && !collapsed && (
                  <button
                    type="button"
                    onClick={() => handleChange("google-sku-attribution")}
                    className={`relative mt-0.5 flex w-full items-center gap-2 rounded-md py-2 pl-8 pr-2.5 text-left text-xs font-medium transition-colors ${
                      active === "google-sku-attribution"
                        ? "bg-[var(--sidebar-active-bg)] text-[var(--sidebar-ink-primary)]"
                        : "text-[var(--sidebar-ink-muted)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--sidebar-ink-secondary)]"
                    }`}
                  >
                    {active === "google-sku-attribution" && (
                      <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full" style={{ background: PLATFORM_COLORS.google }} />
                    )}
                    <span className="truncate">↳ SKU Attribution</span>
                  </button>
                )}
              </div>
            );
          })}

          {/* Shopify isn't an ad platform -- ground-truth orders/products, own
              group so it doesn't read as "a 5th platform" it isn't. */}
          {!collapsed && <div className="px-2 pb-1.5 pt-4 text-[10px] font-medium uppercase tracking-wide text-[var(--sidebar-ink-muted)]">Store</div>}
          <button
            type="button"
            title={collapsed ? `Shopify${shopifyConnected ? "" : " (not connected)"}` : undefined}
            onClick={() => handleChange("shopify")}
            className={`relative flex w-full items-center rounded-md text-left text-sm font-medium transition-colors ${
              collapsed ? "mt-4 justify-center px-2 py-2.5" : "gap-2.5 px-2.5 py-2.5"
            } ${active === "shopify" ? "bg-[var(--sidebar-active-bg)] text-[var(--sidebar-ink-primary)]" : "text-[var(--sidebar-ink-secondary)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--sidebar-ink-primary)]"}`}
          >
            {active === "shopify" && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full" style={{ background: SHOPIFY_COLOR }} />}
            <span className="relative shrink-0" style={{ opacity: shopifyConnected ? 1 : 0.4 }}>
              <ShopifyIcon size={18} />
            </span>
            {!collapsed && (
              <>
                <span className="flex-1 truncate">Shopify</span>
                {!shopifyConnected && <span className="shrink-0 text-[10px] text-[var(--sidebar-ink-muted)]">not connected</span>}
              </>
            )}
          </button>

          {/* Shopify-only sub-view: a statistical lens on Shopify's own
              product/order data (matched to combined ad spend), not a
              platform of its own -- same nesting pattern as Meta's two
              sub-views above. */}
          {collapsed ? (
            <div className="mt-0.5 flex flex-col items-center gap-0.5">
              <button
                type="button"
                title="Shopify — Product Quadrants"
                onClick={() => handleChange("shopify-product-quadrants")}
                className={`rounded-md p-1.5 transition-colors ${
                  active === "shopify-product-quadrants" ? "bg-[var(--sidebar-active-bg)] text-[var(--sidebar-ink-primary)]" : "text-[var(--sidebar-ink-muted)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--sidebar-ink-secondary)]"
                }`}
              >
                <QuadrantIcon size={13} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => handleChange("shopify-product-quadrants")}
              className={`relative mt-0.5 flex w-full items-center gap-2 rounded-md py-2 pl-8 pr-2.5 text-left text-xs font-medium transition-colors ${
                active === "shopify-product-quadrants"
                  ? "bg-[var(--sidebar-active-bg)] text-[var(--sidebar-ink-primary)]"
                  : "text-[var(--sidebar-ink-muted)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--sidebar-ink-secondary)]"
              }`}
            >
              {active === "shopify-product-quadrants" && (
                <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full" style={{ background: SHOPIFY_COLOR }} />
              )}
              <span className="truncate">↳ Product Quadrants</span>
            </button>
          )}

          {/* Monthly unit-target planning against live Shopify catalog +
              session/CVR pace -- same nesting as Product Quadrants above. */}
          {collapsed ? (
            <div className="mt-0.5 flex flex-col items-center gap-0.5">
              <button
                type="button"
                title="Shopify — Projection Sheet"
                onClick={() => handleChange("shopify-projection-sheet")}
                className={`rounded-md p-1.5 transition-colors ${
                  active === "shopify-projection-sheet" ? "bg-[var(--sidebar-active-bg)] text-[var(--sidebar-ink-primary)]" : "text-[var(--sidebar-ink-muted)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--sidebar-ink-secondary)]"
                }`}
              >
                <TargetIcon size={13} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => handleChange("shopify-projection-sheet")}
              className={`relative mt-0.5 flex w-full items-center gap-2 rounded-md py-2 pl-8 pr-2.5 text-left text-xs font-medium transition-colors ${
                active === "shopify-projection-sheet"
                  ? "bg-[var(--sidebar-active-bg)] text-[var(--sidebar-ink-primary)]"
                  : "text-[var(--sidebar-ink-muted)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--sidebar-ink-secondary)]"
              }`}
            >
              {active === "shopify-projection-sheet" && (
                <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full" style={{ background: SHOPIFY_COLOR }} />
              )}
              <span className="truncate">↳ Projection Sheet</span>
            </button>
          )}

          {/* App-wide config (API integration status, COGS %, EBITDA cost
              inputs) -- its own group, not nested under a platform or
              Shopify, since it isn't a lens on either. Pinned to the bottom
              of the nav (mt-auto, nav is now a flex column) so it sits
              directly above the Appearance toggle instead of stranded mid-
              list with a long stretch of empty sidebar below it. */}
          <div className="mt-auto">
            {!collapsed && <div className="px-2 pb-1.5 pt-4 text-[10px] font-medium uppercase tracking-wide text-[var(--sidebar-ink-muted)]">Admin</div>}
            <button
              type="button"
              title={collapsed ? "Settings" : undefined}
              onClick={() => handleChange("settings")}
              className={`relative flex w-full items-center rounded-md text-left text-sm font-medium transition-colors ${
                collapsed ? "mt-4 justify-center px-2 py-2.5" : "gap-2.5 px-2.5 py-2.5"
              } ${active === "settings" ? "bg-[var(--sidebar-active-bg)] text-[var(--sidebar-ink-primary)]" : "text-[var(--sidebar-ink-secondary)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--sidebar-ink-primary)]"}`}
            >
              {active === "settings" && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent" />}
              <span className="relative shrink-0">
                <GearIcon size={18} />
              </span>
              {!collapsed && <span className="flex-1 truncate">Settings</span>}
            </button>
          </div>
        </nav>

        <div className={`border-t border-[var(--sidebar-border)] ${collapsed ? "flex flex-col items-center gap-2 px-2 py-3" : "px-4 py-3"}`}>
          {collapsed ? (
            <button
              type="button"
              onClick={() => onThemeChange(theme === "dark" ? "light" : "dark")}
              title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              className="rounded-md p-1.5 text-[var(--sidebar-ink-muted)] transition-colors hover:bg-[var(--sidebar-active-bg)] hover:text-[var(--sidebar-ink-secondary)]"
            >
              {theme === "dark" ? <MoonIcon size={15} /> : <SunIcon size={15} />}
            </button>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--sidebar-ink-muted)]">Appearance</span>
                <div className="flex rounded-md border border-[var(--sidebar-border)] p-0.5">
                  <button
                    type="button"
                    onClick={() => onThemeChange("light")}
                    title="Light theme"
                    aria-pressed={theme === "light"}
                    className={`rounded px-2 py-1 transition-colors ${
                      theme === "light" ? "bg-[var(--sidebar-active-bg)] text-[var(--sidebar-ink-primary)]" : "text-[var(--sidebar-ink-muted)] hover:text-[var(--sidebar-ink-secondary)]"
                    }`}
                  >
                    <SunIcon size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onThemeChange("dark")}
                    title="Dark theme"
                    aria-pressed={theme === "dark"}
                    className={`rounded px-2 py-1 transition-colors ${
                      theme === "dark" ? "bg-[var(--sidebar-active-bg)] text-[var(--sidebar-ink-primary)]" : "text-[var(--sidebar-ink-muted)] hover:text-[var(--sidebar-ink-secondary)]"
                    }`}
                  >
                    <MoonIcon size={13} />
                  </button>
                </div>
              </div>
              <p className="mt-2 text-[11px] text-[var(--sidebar-ink-muted)]">Internal tool, password-protected</p>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
