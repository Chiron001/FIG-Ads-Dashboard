import { roasColor } from "../lib/roasColor";

export interface RankedBarItem {
  key: string;
  label: string;
  sublabel?: string;
  value: number;
  roas: number | null;
}

interface Props {
  items: RankedBarItem[];
  targetRoas: number;
  valueFormatter: (v: number) => string;
  selectedKey?: string | null;
  onSelect?: (key: string) => void;
  emptyMessage?: string;
}

/** A ranked horizontal bar list -- bar length is the sizing metric (usually
 * spend), bar color is ROAS strength (red -> amber -> green vs. Target
 * ROAS), same convention as the Spend Flow band so color means the same
 * thing everywhere it appears. Reused across the SKU/creative/product
 * "top performers" charts rather than rebuilt per section. */
export function RankedBarChart({ items, targetRoas, valueFormatter, selectedKey, onSelect, emptyMessage }: Props) {
  if (items.length === 0) {
    return <div className="px-4 py-10 text-center text-sm text-ink-muted">{emptyMessage ?? "Nothing to show for this range."}</div>;
  }
  const max = Math.max(...items.map((i) => i.value), 1);

  return (
    <div className="space-y-2.5">
      {items.map((item) => {
        const pct = Math.max(2, (item.value / max) * 100);
        const color = roasColor(item.roas, targetRoas);
        const selected = selectedKey === item.key;
        const Tag = onSelect ? "button" : "div";
        return (
          <Tag
            key={item.key}
            type={onSelect ? "button" : undefined}
            onClick={onSelect ? () => onSelect(item.key) : undefined}
            className={`block w-full rounded-lg px-1.5 py-1 text-left transition-colors ${
              onSelect ? (selected ? "bg-white/[0.06]" : "hover:bg-white/[0.03]") : ""
            }`}
          >
            <div className="mb-1 flex items-center justify-between gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate font-medium text-ink-primary">{item.label}</span>
              {item.sublabel && <span className="shrink-0 font-mono text-[11px] text-ink-muted">{item.sublabel}</span>}
              <span className="font-hero-num shrink-0 tabular-nums text-ink-secondary">{valueFormatter(item.value)}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/5">
              <div
                className="h-full rounded-full transition-[width] duration-500 ease-[var(--ease-signature)]"
                style={{
                  width: `${pct}%`,
                  background: color,
                  boxShadow: selected ? `0 0 0 2px var(--color-accent)` : undefined,
                }}
              />
            </div>
          </Tag>
        );
      })}
    </div>
  );
}
