import { useState } from "react";
import type { Platform } from "@fig/shared";
import { ALL_PLATFORMS, PLATFORM_LABELS } from "@fig/shared";
import { PLATFORM_COLORS } from "../lib/platformColors";
import type { Theme } from "../lib/theme";
import { PlatformIcon } from "./icons/PlatformIcon";
import { ShopifyIcon } from "./icons/ShopifyIcon";

/** What can be selected in the sidebar -- "home" (the AI ask-anything
 * landing page, its own top-level entry, first in the nav and the app's
 * default view), the 4 ad platforms, plus Shopify (not an ad platform -- no
 * spend/campaigns, not in the shared Platform union), plus Meta's SKU
 * Attribution, Creative Performance, and Predictive Analysis sub-views and
 * Google's SKU Attribution and Predictive Analysis sub-views (nested under
 * their respective platforms in the nav, not platforms of their own), plus
 * Shopify's Product Quadrants, Projection Sheet, and Predictive Analysis
 * sub-views (nested under Shopify the same way), plus Settings (app-wide
 * config, its own top-level group -- not tied to any one platform or
 * Shopify). */
export type SidebarSelection =
  | "home"
  | Platform
  | "shopify"
  | "meta-sku-attribution"
  | "meta-creative-performance"
  | "meta-predictive-analysis"
  | "google-sku-attribution"
  | "google-predictive-analysis"
  | "shopify-product-quadrants"
  | "shopify-projection-sheet"
  | "shopify-predictive-analysis"
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

function HomeIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M2 7.2 8 2l6 5.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3.3 6.3V13a.8.8 0 0 0 .8.8h7.8a.8.8 0 0 0 .8-.8V6.3" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M6.3 13.8V10a.8.8 0 0 1 .8-.8h1.8a.8.8 0 0 1 .8.8v3.8" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

/** Disclosure chevron for a group with sub-items -- rotates to point down
 * when expanded. Replaces the old "↳" hook-arrow prefix on sub-item labels
 * entirely: that glyph read as ASCII-art, not a real UI affordance (nothing
 * to click, no expand/collapse state). This is the standard tree-disclosure
 * pattern instead -- a dedicated toggle control, sub-items hidden until the
 * group is opened, indicated by rotation + the connector rail below. */
function ChevronIcon({ size, expanded }: { size: number; expanded: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      className={`shrink-0 transition-transform duration-[var(--duration-micro)] ${expanded ? "rotate-90" : ""}`}
    >
      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
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

function TrendIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M2 12.5 6 8l3 2.5 5-6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11 4.5h3v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
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
// Which nav groups have sub-items at all -- Amazon/Myntra don't, so they
// never get a chevron.
type SubNavGroup = "meta" | "google" | "shopify";

export function PlatformSidebar({ active, onChange, connected, shopifyConnected, mobileOpen, onMobileClose, theme, onThemeChange }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  // Sub-items start collapsed (hidden) and only appear once their group is
  // opened -- previously every group's sub-items were always visible,
  // which crowded the nav. Toggled by the chevron, independent of the
  // group's own row (clicking the row still just navigates to that
  // platform's main page).
  const [expandedGroups, setExpandedGroups] = useState<Set<SubNavGroup>>(new Set());

  function toggleGroup(group: SubNavGroup) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }

  // A group whose sub-item is the CURRENT page auto-opens even if the user
  // never clicked its chevron -- e.g. arriving at "Google Ads — SKU
  // Attribution" via the command palette should still reveal it highlighted
  // in the tree, not leave it hidden with no visible indication of where
  // you are.
  const isGroupExpanded = (group: SubNavGroup): boolean => {
    if (expandedGroups.has(group)) return true;
    if (group === "meta") return active === "meta-sku-attribution" || active === "meta-creative-performance" || active === "meta-predictive-analysis";
    if (group === "google") return active === "google-sku-attribution" || active === "google-predictive-analysis";
    return active === "shopify-product-quadrants" || active === "shopify-projection-sheet" || active === "shopify-predictive-analysis";
  };

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
          <button
            type="button"
            title={collapsed ? "Home" : undefined}
            onClick={() => handleChange("home")}
            className={`relative flex w-full items-center rounded-md text-left text-sm font-medium transition-colors ${
              collapsed ? "justify-center px-2 py-2.5" : "gap-2.5 px-2.5 py-2.5"
            } ${active === "home" ? "bg-[var(--sidebar-active-bg)] text-[var(--sidebar-ink-primary)]" : "text-[var(--sidebar-ink-secondary)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--sidebar-ink-primary)]"}`}
          >
            {active === "home" && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent" />}
            <span className="relative shrink-0">
              <HomeIcon size={18} />
            </span>
            {!collapsed && <span className="flex-1 truncate">Home</span>}
          </button>

          {!collapsed && <div className="px-2 pb-1.5 pt-4 text-[10px] font-medium uppercase tracking-wide text-[var(--sidebar-ink-muted)]">Platforms</div>}
          {ALL_PLATFORMS.map((platform) => {
            const isActive = platform === active;
            const group: SubNavGroup | null = platform === "meta" ? "meta" : platform === "google" ? "google" : null;
            const expanded = group ? isGroupExpanded(group) : false;
            return (
              <div key={platform}>
                <div className={`flex items-center ${collapsed ? "" : "gap-0.5"}`}>
                  <button
                    type="button"
                    title={collapsed ? `${PLATFORM_LABELS[platform]}${connected[platform] ? "" : " (not connected)"}` : undefined}
                    onClick={() => handleChange(platform)}
                    className={`relative flex flex-1 items-center rounded-md text-left text-sm font-medium transition-colors ${
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
                  {/* Disclosure toggle -- separate control from the row above
                      (which still just navigates on click), so opening/
                      closing the sub-nav never fights with going to that
                      platform's own page. */}
                  {group && !collapsed && (
                    <button
                      type="button"
                      onClick={() => toggleGroup(group)}
                      aria-expanded={expanded}
                      aria-label={expanded ? `Collapse ${PLATFORM_LABELS[platform]} sections` : `Expand ${PLATFORM_LABELS[platform]} sections`}
                      className="shrink-0 rounded-md p-1.5 text-[var(--sidebar-ink-muted)] transition-colors hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--sidebar-ink-secondary)]"
                    >
                      <ChevronIcon size={12} expanded={expanded} />
                    </button>
                  )}
                </div>

                {/* Meta-only sub-views: each a lens on Meta's own ad-name-
                    tagging data, not a platform of their own. Collapsed
                    sidebar mode swaps the text row for small icon-only
                    buttons (title tooltip for identification), always
                    visible there regardless of expand state -- room is
                    already tight, so there's nothing to save by hiding them.
                    Expanded sidebar mode instead hides them behind the
                    chevron above, revealed via a connector rail once open. */}
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
                    <button
                      type="button"
                      title="Meta Ads — Predictive Analysis"
                      onClick={() => handleChange("meta-predictive-analysis")}
                      className={`rounded-md p-1.5 transition-colors ${
                        active === "meta-predictive-analysis" ? "bg-[var(--sidebar-active-bg)] text-[var(--sidebar-ink-primary)]" : "text-[var(--sidebar-ink-muted)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--sidebar-ink-secondary)]"
                      }`}
                    >
                      <TrendIcon size={13} />
                    </button>
                  </div>
                )}
                {platform === "meta" && !collapsed && expanded && (
                  <div className="relative ml-[19px] mt-0.5 space-y-0.5 border-l border-[var(--sidebar-border)] pl-3 animate-fade-slide-in">
                    <button
                      type="button"
                      onClick={() => handleChange("meta-sku-attribution")}
                      className={`flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition-colors ${
                        active === "meta-sku-attribution"
                          ? "bg-[var(--sidebar-active-bg)] text-[var(--sidebar-ink-primary)]"
                          : "text-[var(--sidebar-ink-muted)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--sidebar-ink-secondary)]"
                      }`}
                    >
                      <span className="truncate">SKU Attribution</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleChange("meta-creative-performance")}
                      className={`flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition-colors ${
                        active === "meta-creative-performance"
                          ? "bg-[var(--sidebar-active-bg)] text-[var(--sidebar-ink-primary)]"
                          : "text-[var(--sidebar-ink-muted)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--sidebar-ink-secondary)]"
                      }`}
                    >
                      <span className="truncate">Creative Performance</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleChange("meta-predictive-analysis")}
                      className={`flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition-colors ${
                        active === "meta-predictive-analysis"
                          ? "bg-[var(--sidebar-active-bg)] text-[var(--sidebar-ink-primary)]"
                          : "text-[var(--sidebar-ink-muted)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--sidebar-ink-secondary)]"
                      }`}
                    >
                      <span className="truncate">Predictive Analysis</span>
                    </button>
                  </div>
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
                    <button
                      type="button"
                      title="Google Ads — Predictive Analysis"
                      onClick={() => handleChange("google-predictive-analysis")}
                      className={`rounded-md p-1.5 transition-colors ${
                        active === "google-predictive-analysis" ? "bg-[var(--sidebar-active-bg)] text-[var(--sidebar-ink-primary)]" : "text-[var(--sidebar-ink-muted)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--sidebar-ink-secondary)]"
                      }`}
                    >
                      <TrendIcon size={13} />
                    </button>
                  </div>
                )}
                {platform === "google" && !collapsed && expanded && (
                  <div className="relative ml-[19px] mt-0.5 space-y-0.5 border-l border-[var(--sidebar-border)] pl-3 animate-fade-slide-in">
                    <button
                      type="button"
                      onClick={() => handleChange("google-sku-attribution")}
                      className={`flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition-colors ${
                        active === "google-sku-attribution"
                          ? "bg-[var(--sidebar-active-bg)] text-[var(--sidebar-ink-primary)]"
                          : "text-[var(--sidebar-ink-muted)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--sidebar-ink-secondary)]"
                      }`}
                    >
                      <span className="truncate">SKU Attribution</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleChange("google-predictive-analysis")}
                      className={`flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition-colors ${
                        active === "google-predictive-analysis"
                          ? "bg-[var(--sidebar-active-bg)] text-[var(--sidebar-ink-primary)]"
                          : "text-[var(--sidebar-ink-muted)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--sidebar-ink-secondary)]"
                      }`}
                    >
                      <span className="truncate">Predictive Analysis</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {/* Shopify isn't an ad platform -- ground-truth orders/products, own
              group so it doesn't read as "a 5th platform" it isn't. */}
          {!collapsed && <div className="px-2 pb-1.5 pt-4 text-[10px] font-medium uppercase tracking-wide text-[var(--sidebar-ink-muted)]">Store</div>}
          <div className={`flex items-center ${collapsed ? "" : "gap-0.5"}`}>
            <button
              type="button"
              title={collapsed ? `Shopify${shopifyConnected ? "" : " (not connected)"}` : undefined}
              onClick={() => handleChange("shopify")}
              className={`relative flex flex-1 items-center rounded-md text-left text-sm font-medium transition-colors ${
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
            {!collapsed && (
              <button
                type="button"
                onClick={() => toggleGroup("shopify")}
                aria-expanded={isGroupExpanded("shopify")}
                aria-label={isGroupExpanded("shopify") ? "Collapse Shopify sections" : "Expand Shopify sections"}
                className="mt-4 shrink-0 rounded-md p-1.5 text-[var(--sidebar-ink-muted)] transition-colors hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--sidebar-ink-secondary)]"
              >
                <ChevronIcon size={12} expanded={isGroupExpanded("shopify")} />
              </button>
            )}
          </div>

          {/* Shopify-only sub-views: a statistical lens on Shopify's own
              product/order data (matched to combined ad spend), not
              platforms of their own -- same nesting/disclosure pattern as
              Meta's and Google's sub-views above. */}
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
              <button
                type="button"
                title="Shopify — Predictive Analysis"
                onClick={() => handleChange("shopify-predictive-analysis")}
                className={`rounded-md p-1.5 transition-colors ${
                  active === "shopify-predictive-analysis" ? "bg-[var(--sidebar-active-bg)] text-[var(--sidebar-ink-primary)]" : "text-[var(--sidebar-ink-muted)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--sidebar-ink-secondary)]"
                }`}
              >
                <TrendIcon size={13} />
              </button>
            </div>
          ) : (
            isGroupExpanded("shopify") && (
              <div className="relative ml-[19px] mt-0.5 space-y-0.5 border-l border-[var(--sidebar-border)] pl-3 animate-fade-slide-in">
                <button
                  type="button"
                  onClick={() => handleChange("shopify-product-quadrants")}
                  className={`flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition-colors ${
                    active === "shopify-product-quadrants"
                      ? "bg-[var(--sidebar-active-bg)] text-[var(--sidebar-ink-primary)]"
                      : "text-[var(--sidebar-ink-muted)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--sidebar-ink-secondary)]"
                  }`}
                >
                  <span className="truncate">Product Quadrants</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleChange("shopify-projection-sheet")}
                  className={`flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition-colors ${
                    active === "shopify-projection-sheet"
                      ? "bg-[var(--sidebar-active-bg)] text-[var(--sidebar-ink-primary)]"
                      : "text-[var(--sidebar-ink-muted)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--sidebar-ink-secondary)]"
                  }`}
                >
                  <span className="truncate">Projection Sheet</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleChange("shopify-predictive-analysis")}
                  className={`flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition-colors ${
                    active === "shopify-predictive-analysis"
                      ? "bg-[var(--sidebar-active-bg)] text-[var(--sidebar-ink-primary)]"
                      : "text-[var(--sidebar-ink-muted)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--sidebar-ink-secondary)]"
                  }`}
                >
                  <span className="truncate">Predictive Analysis</span>
                </button>
              </div>
            )
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
