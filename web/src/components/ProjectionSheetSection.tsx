import { useEffect, useMemo, useState } from "react";
import type { ProjectionInsightVerdict, ProjectionResponse, ProjectionRow, ProjectionUpdateEntry } from "@fig/shared";
import { fetchProjection, updateProjection } from "../lib/api";
import { formatCurrency, formatCurrencyPrecise, formatNumber, formatNumberOneDecimal, formatPercent } from "../lib/format";
import { KpiTile } from "./KpiTile";
import { InfoNote } from "./InfoNote";

const INSIGHT_META: Record<ProjectionInsightVerdict, { label: string; color: string }> = {
  on_track: { label: "On Track", color: "#4ade80" },
  increase_sessions: { label: "Increase Sessions", color: "#e5a94e" },
  review_ads: { label: "Review Ads", color: "#6ba5e5" },
  behind_and_low_traffic: { label: "Behind + Low Traffic", color: "#f26d6d" },
  no_target: { label: "No Target Set", color: "#818794" },
};

type ColumnGroup = "target" | "pace" | "actuals" | "sessions" | "projection";

const GROUP_BG: Record<ColumnGroup, string> = {
  target: "rgba(229,169,78,0.07)",
  pace: "rgba(107,165,229,0.07)",
  actuals: "transparent",
  sessions: "rgba(74,222,128,0.06)",
  projection: "rgba(242,109,109,0.05)",
};

interface DerivedColumn {
  key: keyof ProjectionRow;
  label: string;
  group: ColumnGroup;
  format: (v: number | null) => string;
}

// Order matches the requested 18-item list (Product/Unit Target/Price are
// separate, editable columns rendered before this array; Insight is
// rendered after it) -- "MTD Total Sessions" deliberately appears twice
// (mtdTotalSessionsEarly, then again as mtdTotalSessions right after the
// Meta/Google/Rest breakdown), matching the request's own list, which named
// it in both places.
const DERIVED_COLUMNS: DerivedColumn[] = [
  { key: "targetRevenue", label: "Target Revenue", group: "target", format: (v) => formatCurrency(v) },
  { key: "requiredTraffic", label: "Required Traffic", group: "target", format: (v) => formatNumber(v) },
  { key: "cpm", label: "CPM (Meta, prev. month)", group: "target", format: (v) => formatCurrencyPrecise(v) },
  { key: "minAdSpendRequired", label: "Min. Ad Spend Required", group: "target", format: (v) => formatCurrency(v) },
  { key: "plannedDrr", label: "Planned DRR", group: "pace", format: (v) => formatNumberOneDecimal(v) },
  { key: "currentDrr", label: "Current DRR", group: "pace", format: (v) => formatNumberOneDecimal(v) },
  { key: "projectedUnitsMonthEnd", label: "Projected Units (Month End)", group: "pace", format: (v) => formatNumberOneDecimal(v) },
  { key: "mtdUnitsSold", label: "MTD Units Sold", group: "actuals", format: (v) => formatNumber(v) },
  { key: "mtdTotalSessionsEarly", label: "MTD Total Sessions", group: "actuals", format: (v) => formatNumber(v) },
  { key: "previousMonthCvr", label: "Previous Month CVR", group: "actuals", format: (v) => formatPercent(v) },
  { key: "currentMonthCvr", label: "Current Month CVR", group: "actuals", format: (v) => formatPercent(v) },
  { key: "mtdMetaSessions", label: "MTD Meta Sessions (Paid)", group: "sessions", format: (v) => formatNumber(v) },
  { key: "mtdGoogleSessions", label: "MTD Google Sessions (Paid)", group: "sessions", format: (v) => formatNumber(v) },
  { key: "mtdRestSessions", label: "MTD Rest Sessions", group: "sessions", format: (v) => formatNumber(v) },
  { key: "mtdTotalSessions", label: "MTD Total Sessions", group: "sessions", format: (v) => formatNumber(v) },
  { key: "mtdMetaSessionsSharePct", label: "MTD Meta Sessions Share", group: "sessions", format: (v) => formatPercent(v, 0) },
  { key: "projectedSessionsMonthEnd", label: "Projected Sessions (Month End)", group: "projection", format: (v) => formatNumberOneDecimal(v) },
];

interface Draft {
  unitTarget: number | null;
  price: number | null;
}

function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}

interface Props {
  connected: boolean;
}

export function ProjectionSheetSection({ connected }: Props) {
  const [data, setData] = useState<ProjectionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<keyof ProjectionRow>("title");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [filterMode, setFilterMode] = useState<"all" | "complete" | "incomplete">("all");

  function load() {
    setLoading(true);
    setError(null);
    fetchProjection()
      .then((res) => {
        setData(res);
        setDrafts({});
      })
      .catch((err) => setError(String(err.message ?? err)))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (connected) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  const rows = data?.rows ?? [];

  function draftFor(row: ProjectionRow): Draft {
    return drafts[row.productId] ?? { unitTarget: row.unitTarget, price: row.price };
  }

  function setDraft(productId: string, patch: Partial<Draft>) {
    setDrafts((d) => ({ ...d, [productId]: { ...(d[productId] ?? { unitTarget: null, price: null }), ...patch } }));
  }

  const dirtyIds = useMemo(
    () =>
      Object.keys(drafts).filter((id) => {
        const row = rows.find((r) => r.productId === id);
        if (!row) return false;
        const d = drafts[id];
        return d.unitTarget !== row.unitTarget || d.price !== row.price;
      }),
    [drafts, rows]
  );

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaveMessage(null);
    try {
      const updates: ProjectionUpdateEntry[] = dirtyIds.map((id) => ({ productId: id, unitTarget: drafts[id].unitTarget, price: drafts[id].price }));
      await updateProjection(updates);
      setSaveMessage(`Saved ${updates.length} product${updates.length === 1 ? "" : "s"}.`);
      load();
    } catch (err) {
      setError(String((err as Error).message ?? err));
    } finally {
      setSaving(false);
    }
  }

  function discardChanges() {
    setDrafts({});
    setError(null);
    setSaveMessage(null);
  }

  // Effective rows -- draft unitTarget/price merged in, so sort/search/save
  // all see the same live picture, not last-saved values.
  const effectiveRows = useMemo(
    () =>
      rows.map((r) => {
        const d = draftFor(r);
        if (d.unitTarget === r.unitTarget && d.price === r.price) return r;
        const targetRevenue = d.unitTarget != null && d.price != null ? d.unitTarget * d.price : null;
        const plannedDrr = d.unitTarget != null && data ? d.unitTarget / data.daysInMonth : null;
        const requiredTraffic = d.unitTarget != null && r.previousMonthCvr != null && r.previousMonthCvr > 0 ? d.unitTarget / r.previousMonthCvr : null;
        return { ...r, unitTarget: d.unitTarget, price: d.price, targetRevenue, plannedDrr, requiredTraffic };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, drafts, data]
  );

  const completeCount = useMemo(() => effectiveRows.filter((r) => r.unitTarget != null && r.price != null).length, [effectiveRows]);
  const incompleteCount = effectiveRows.length - completeCount;

  const filteredSorted = useMemo(() => {
    const term = search.trim().toLowerCase();
    let filtered = term ? effectiveRows.filter((r) => r.title.toLowerCase().includes(term)) : effectiveRows;
    if (filterMode === "complete") filtered = filtered.filter((r) => r.unitTarget != null && r.price != null);
    else if (filterMode === "incomplete") filtered = filtered.filter((r) => r.unitTarget == null || r.price == null);
    return [...filtered].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const aNull = av == null;
      const bNull = bv == null;
      if (aNull && bNull) return 0;
      if (aNull) return 1;
      if (bNull) return -1;
      const cmp = typeof av === "string" || typeof bv === "string" ? String(av).localeCompare(String(bv)) : (av as number) < (bv as number) ? -1 : (av as number) > (bv as number) ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [effectiveRows, search, sortKey, sortDir, filterMode]);

  function toggleSort(key: keyof ProjectionRow) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "title" ? "asc" : "desc");
    }
  }

  const withTarget = effectiveRows.filter((r) => r.unitTarget != null);
  const totalTargetUnits = withTarget.reduce((s, r) => s + (r.unitTarget ?? 0), 0);
  const totalTargetRevenue = withTarget.reduce((s, r) => s + (r.targetRevenue ?? 0), 0);
  const totalMtdUnits = effectiveRows.reduce((s, r) => s + r.mtdUnitsSold, 0);
  const insightCounts = effectiveRows.reduce(
    (acc, r) => {
      acc[r.insight.verdict] = (acc[r.insight.verdict] ?? 0) + 1;
      return acc;
    },
    {} as Record<ProjectionInsightVerdict, number>
  );

  if (!connected) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface-1 px-6 py-12 text-center">
        <div className="text-sm font-medium text-ink-primary">Shopify isn't connected yet</div>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">
          Shopify credentials aren't configured (SHOPIFY_STORE_DOMAIN / SHOPIFY_ADMIN_ACCESS_TOKEN).
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && <div className="rounded-md border border-status-critical/30 bg-status-critical/10 px-3 py-2 text-xs text-status-critical">{error}</div>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs text-ink-muted">
          <InfoNote label="How this sheet works">
            Every active Shopify product, live -- Unit Target and Price are the only fields you set. Type a value
            directly, or click the small hint underneath each input to fill it from last month's actual units sold
            (Unit Target) or Shopify's live selling price (Price). Required Traffic = Unit Target ÷ Previous Month
            CVR (units ÷ sessions). Minimum Ad Spend Required = (1000 ÷ CPM) × Required Traffic × 0.8. Planned DRR =
            Unit Target ÷ days in this month. Current DRR = MTD Units Sold ÷ today's day-of-month. Projected (Month
            End) columns extrapolate the current daily pace across the full month. CPM is Meta's product-catalog CPM
            for the previous full month -- shows N/A for products with no matched catalog spend that month.
          </InfoNote>
          {data && (
            <>
              {monthLabel(data.month)} -- day {data.dayOfMonth} of {data.daysInMonth}
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {dirtyIds.length > 0 && (
            <span className="text-xs text-ink-muted">
              {dirtyIds.length} unsaved change{dirtyIds.length === 1 ? "" : "s"}
            </span>
          )}
          {dirtyIds.length > 0 && !saving && (
            <button type="button" onClick={discardChanges} className="text-xs text-ink-muted underline hover:text-ink-secondary">
              Discard
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || dirtyIds.length === 0}
            className="rounded-md bg-accent px-3.5 py-1.5 text-xs font-medium text-surface-0 transition-[transform,opacity] duration-[var(--duration-micro)] hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
          {saveMessage && dirtyIds.length === 0 && <span className="text-xs text-status-good">{saveMessage}</span>}
        </div>
      </div>

      <div className={`grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 ${loading ? "opacity-60" : ""}`}>
        <KpiTile label="Products with Target" value={formatNumber(withTarget.length)} numeric={withTarget.length} numericFormat="number" staggerIndex={0} sublabel={`of ${formatNumber(effectiveRows.length)} active`} />
        <KpiTile label="Total Target Units" value={formatNumber(totalTargetUnits)} numeric={totalTargetUnits} numericFormat="number" staggerIndex={1} />
        <KpiTile label="Total Target Revenue" value={formatCurrency(totalTargetRevenue)} numeric={totalTargetRevenue} numericFormat="currency" staggerIndex={2} />
        <KpiTile label="Total MTD Units Sold" value={formatNumber(totalMtdUnits)} numeric={totalMtdUnits} numericFormat="number" staggerIndex={3} />
        <KpiTile label="On Track" value={formatNumber(insightCounts.on_track ?? 0)} accent={INSIGHT_META.on_track.color} staggerIndex={4} />
        <KpiTile
          label="Needs Attention"
          value={formatNumber((insightCounts.increase_sessions ?? 0) + (insightCounts.review_ads ?? 0) + (insightCounts.behind_and_low_traffic ?? 0))}
          accent={INSIGHT_META.behind_and_low_traffic.color}
          staggerIndex={5}
        />
      </div>

      <div className="rounded-2xl border border-border bg-surface-1">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-ink-primary">
            Products <span className="font-normal text-ink-muted">({filteredSorted.length})</span>
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-md border border-border p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setFilterMode("all")}
                className={`rounded px-2.5 py-1 transition-colors ${filterMode === "all" ? "bg-surface-2 text-ink-primary" : "text-ink-muted hover:text-ink-secondary"}`}
              >
                All ({effectiveRows.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterMode("complete")}
                title="Only products with both Unit Target and Price set"
                className={`rounded px-2.5 py-1 transition-colors ${filterMode === "complete" ? "bg-surface-2 text-ink-primary" : "text-ink-muted hover:text-ink-secondary"}`}
              >
                Complete ({completeCount})
              </button>
              <button
                type="button"
                onClick={() => setFilterMode("incomplete")}
                title="Products missing Unit Target and/or Price"
                className={`rounded px-2.5 py-1 transition-colors ${filterMode === "incomplete" ? "bg-surface-2 text-ink-primary" : "text-ink-muted hover:text-ink-secondary"}`}
              >
                Missing Target/Price ({incompleteCount})
              </button>
            </div>
            <input
              type="text"
              placeholder="Search products…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-56 rounded-md border border-border bg-surface-0 px-3 py-1.5 text-sm text-ink-primary placeholder:text-ink-muted"
            />
          </div>
        </div>

        {filteredSorted.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-ink-muted">{data ? "Nothing matches the current search." : "Loading…"}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th
                    onClick={() => toggleSort("title")}
                    className="sticky left-0 z-10 cursor-pointer select-none whitespace-nowrap bg-surface-1 px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-ink-muted hover:text-ink-secondary"
                  >
                    Product {sortKey === "title" && (sortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th onClick={() => toggleSort("unitTarget")} className="cursor-pointer select-none whitespace-nowrap px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted hover:text-ink-secondary">
                    Unit Target {sortKey === "unitTarget" && (sortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th onClick={() => toggleSort("price")} className="cursor-pointer select-none whitespace-nowrap px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted hover:text-ink-secondary">
                    Price {sortKey === "price" && (sortDir === "asc" ? "↑" : "↓")}
                  </th>
                  {DERIVED_COLUMNS.map((col) => (
                    <th
                      key={col.key}
                      onClick={() => toggleSort(col.key)}
                      style={{ background: GROUP_BG[col.group] }}
                      className="cursor-pointer select-none whitespace-nowrap px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted hover:text-ink-secondary"
                    >
                      {col.label} {sortKey === col.key && (sortDir === "asc" ? "↑" : "↓")}
                    </th>
                  ))}
                  <th className="whitespace-nowrap px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-ink-muted">Insight</th>
                </tr>
              </thead>
              <tbody>
                {filteredSorted.map((row) => {
                  const draft = draftFor(row);
                  const isDirty = dirtyIds.includes(row.productId);
                  const insight = INSIGHT_META[row.insight.verdict];
                  return (
                    <tr key={row.productId} className={`border-b border-border last:border-0 transition-colors hover:bg-accent-soft ${isDirty ? "bg-accent-soft/40" : ""}`}>
                      <td className="sticky left-0 z-10 max-w-[220px] truncate bg-surface-1 px-4 py-2 font-medium text-ink-primary">{row.title}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right">
                        <div className="flex flex-col items-end gap-0.5">
                          <input
                            type="number"
                            min={0}
                            value={draft.unitTarget ?? ""}
                            onChange={(e) => setDraft(row.productId, { unitTarget: e.target.value === "" ? null : Number(e.target.value) })}
                            placeholder="—"
                            className="w-20 rounded-md border border-border bg-surface-0 px-2 py-1 text-right tabular-nums text-ink-primary placeholder:text-ink-muted"
                          />
                          <button
                            type="button"
                            onClick={() => setDraft(row.productId, { unitTarget: row.previousMonthUnitsSold })}
                            title="Use previous month's units sold"
                            className="text-[10px] tabular-nums text-ink-muted underline decoration-dotted hover:text-accent"
                          >
                            prev: {formatNumber(row.previousMonthUnitsSold)}
                          </button>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right">
                        <div className="flex flex-col items-end gap-0.5">
                          <input
                            type="number"
                            min={0}
                            value={draft.price ?? ""}
                            onChange={(e) => setDraft(row.productId, { price: e.target.value === "" ? null : Number(e.target.value) })}
                            placeholder="—"
                            className="w-20 rounded-md border border-border bg-surface-0 px-2 py-1 text-right tabular-nums text-ink-primary placeholder:text-ink-muted"
                          />
                          {row.shopifyPrice != null ? (
                            <button
                              type="button"
                              onClick={() => setDraft(row.productId, { price: row.shopifyPrice })}
                              title="Use the live Shopify selling price"
                              className="text-[10px] tabular-nums text-ink-muted underline decoration-dotted hover:text-accent"
                            >
                              shop: {formatNumber(row.shopifyPrice)}
                            </button>
                          ) : (
                            <span className="text-[10px] text-ink-muted">shop: N/A</span>
                          )}
                        </div>
                      </td>
                      {DERIVED_COLUMNS.map((col) => (
                        <td key={col.key} style={{ background: GROUP_BG[col.group] }} className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-ink-secondary">
                          {col.format(row[col.key] as number | null)}
                        </td>
                      ))}
                      <td className="whitespace-nowrap px-3 py-2">
                        <span
                          className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
                          style={{ background: `color-mix(in oklab, ${insight.color} 16%, transparent)`, color: insight.color }}
                          title={row.insight.message}
                        >
                          {insight.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
