import { useEffect, useMemo, useRef, useState } from "react";
import type { Platform } from "@fig/shared";
import { ALL_PLATFORMS, PLATFORM_LABELS } from "@fig/shared";
import type { SidebarSelection } from "./PlatformSidebar";
import { PRESET_LABELS, PRESET_ORDER, presetRange, type DateRange } from "../lib/dateRanges";
import { PlatformIcon } from "./icons/PlatformIcon";
import { ShopifyIcon } from "./icons/ShopifyIcon";

interface Props {
  onNavigate: (selection: SidebarSelection) => void;
  onSetRange: (range: DateRange) => void;
  onClose: () => void;
}

interface CommandItem {
  key: string;
  label: string;
  hint: string;
  icon: React.ReactNode;
  run: () => void;
}

/** ⌘K / Ctrl+K glass overlay -- navigate to any platform/section, or jump to
 * a date-range preset by typing, without leaving the keyboard. Scoped to
 * navigation + date range (not a campaign-name search index): that would
 * mean fetching every campaign across every platform just to power a
 * search box, disproportionate for what's fundamentally a navigation
 * shortcut. */
export function CommandPalette({ onNavigate, onSetRange, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const items = useMemo((): CommandItem[] => {
    const nav: CommandItem[] = [
      ...ALL_PLATFORMS.map((p: Platform) => ({
        key: `nav-${p}`,
        label: PLATFORM_LABELS[p],
        hint: "Go to platform",
        icon: <PlatformIcon platform={p} size={16} />,
        run: () => onNavigate(p),
      })),
      {
        key: "nav-meta-sku",
        label: "Meta Ads — SKU Attribution",
        hint: "Go to section",
        icon: <PlatformIcon platform="meta" size={16} />,
        run: () => onNavigate("meta-sku-attribution"),
      },
      {
        key: "nav-meta-creative",
        label: "Meta Ads — Creative Performance",
        hint: "Go to section",
        icon: <PlatformIcon platform="meta" size={16} />,
        run: () => onNavigate("meta-creative-performance"),
      },
      {
        key: "nav-shopify",
        label: "Shopify",
        hint: "Go to section",
        icon: <ShopifyIcon size={16} />,
        run: () => onNavigate("shopify"),
      },
    ];
    const ranges: CommandItem[] = PRESET_ORDER.map((preset) => ({
      key: `range-${preset}`,
      label: PRESET_LABELS[preset],
      hint: "Set date range",
      icon: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
          <path d="M2 6.5h12" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      ),
      run: () => onSetRange(presetRange(preset)),
    }));
    const all = [...nav, ...ranges];
    const term = query.trim().toLowerCase();
    if (!term) return all;
    return all.filter((item) => item.label.toLowerCase().includes(term) || item.hint.toLowerCase().includes(term));
  }, [query, onNavigate, onSetRange]);

  useEffect(() => setHighlighted(0), [query]);

  function runItem(item: CommandItem) {
    item.run();
    onClose();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter" && items[highlighted]) {
      e.preventDefault();
      runItem(items[highlighted]);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/60 animate-fade-slide-in" />
      <div role="dialog" aria-label="Command palette" className="glass animate-fade-slide-in relative w-full max-w-lg overflow-hidden rounded-2xl">
        <div className="flex items-center gap-2.5 border-b border-white/10 px-4 py-3">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0 text-ink-muted">
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.4" />
            <path d="M11 11L14.5 14.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Go to a platform, section, or date range…"
            className="w-full bg-transparent text-sm text-ink-primary placeholder:text-ink-muted focus:outline-none"
          />
          <kbd className="shrink-0 rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-ink-muted">Esc</kbd>
        </div>
        <div className="max-h-80 overflow-y-auto p-1.5">
          {items.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-ink-muted">No matches.</div>
          ) : (
            items.map((item, i) => (
              <button
                key={item.key}
                type="button"
                onMouseEnter={() => setHighlighted(i)}
                onClick={() => runItem(item)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  i === highlighted ? "bg-white/8 text-ink-primary" : "text-ink-secondary"
                }`}
              >
                <span className="shrink-0 text-ink-muted">{item.icon}</span>
                <span className="flex-1 truncate">{item.label}</span>
                <span className="shrink-0 text-xs text-ink-muted">{item.hint}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
