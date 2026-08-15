import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { CampaignRow } from "@fig/shared";
import { formatCurrency, formatNumber, formatPercent, formatMultiplier } from "../lib/format";
import { normalizeStatus } from "../lib/campaignStatus";

interface Column {
  key: keyof CampaignRow;
  label: string;
  align: "left" | "right";
  format: (row: CampaignRow) => string;
  render?: (row: CampaignRow) => ReactNode;
}

// Status color follows the dataviz skill's fixed status palette (good/
// warning/critical), never the categorical platform colors -- a status
// tone must never be confused with a series identity. Dot + label always
// paired, never color alone.
const STATUS_DOT_CLASS: Record<string, string> = {
  good: "bg-status-good",
  warning: "bg-status-warning",
  critical: "bg-status-critical",
  muted: "bg-ink-muted",
};

function StatusBadge({ status }: { status: string | null }) {
  const { label, tone } = normalizeStatus(status);
  return (
    <span className="inline-flex items-center gap-1.5 text-ink-secondary">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT_CLASS[tone]}`} />
      {label}
    </span>
  );
}

const COLUMNS: Column[] = [
  { key: "campaignName", label: "Campaign", align: "left", format: (r) => r.campaignName ?? r.campaignId },
  { key: "status", label: "Status", align: "left", format: (r) => normalizeStatus(r.status).label, render: (r) => <StatusBadge status={r.status} /> },
  { key: "spend", label: "Spend", align: "right", format: (r) => formatCurrency(r.spend) },
  { key: "impressions", label: "Impressions", align: "right", format: (r) => formatNumber(r.impressions) },
  { key: "clicks", label: "Clicks", align: "right", format: (r) => formatNumber(r.clicks) },
  { key: "ctr", label: "CTR", align: "right", format: (r) => formatPercent(r.ctr) },
  { key: "cpc", label: "CPC", align: "right", format: (r) => formatCurrency(r.cpc) },
  { key: "conversions", label: "Orders", align: "right", format: (r) => formatNumber(r.conversions) },
  { key: "revenue", label: "Revenue", align: "right", format: (r) => formatCurrency(r.revenue) },
  { key: "roas", label: "ROAS", align: "right", format: (r) => formatMultiplier(r.roas) },
  { key: "acos", label: "ACOS", align: "right", format: (r) => formatPercent(r.acos) },
];

interface Props {
  campaigns: CampaignRow[];
}

export function CampaignTable({ campaigns }: Props) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<keyof CampaignRow>("spend");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const base = term
      ? campaigns.filter((c) => (c.campaignName ?? c.campaignId).toLowerCase().includes(term))
      : campaigns;

    return [...base].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp =
        typeof av === "string" || typeof bv === "string"
          ? String(av ?? "").localeCompare(String(bv ?? ""))
          : (av ?? -Infinity) < (bv ?? -Infinity)
            ? -1
            : (av ?? -Infinity) > (bv ?? -Infinity)
              ? 1
              : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [campaigns, search, sortKey, sortDir]);

  function toggleSort(key: keyof CampaignRow) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface-1">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold text-ink-primary">
          Campaigns <span className="font-normal text-ink-muted">({campaigns.length})</span>
        </h3>
        <input
          type="text"
          placeholder="Search campaigns…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-56 rounded-md border border-border bg-surface-0 px-3 py-1.5 text-sm text-ink-primary placeholder:text-ink-muted"
        />
      </div>

      {campaigns.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-ink-muted">No campaigns found for this platform.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    onClick={() => toggleSort(col.key)}
                    className={`cursor-pointer select-none whitespace-nowrap px-4 py-2 text-xs font-medium uppercase tracking-wide text-ink-muted hover:text-ink-secondary ${
                      col.align === "right" ? "text-right" : "text-left"
                    }`}
                  >
                    {col.label}
                    {sortKey === col.key && <span className="ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.campaignId} className="border-b border-border last:border-0 hover:bg-surface-2 transition-colors">
                  {COLUMNS.map((col) => (
                    <td
                      key={col.key}
                      className={`whitespace-nowrap px-4 py-2 tabular-nums ${
                        col.align === "right" ? "text-right text-ink-secondary" : "text-left text-ink-primary"
                      } ${col.key === "campaignName" ? "max-w-xs truncate font-medium" : ""}`}
                    >
                      {col.render ? col.render(row) : col.format(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
