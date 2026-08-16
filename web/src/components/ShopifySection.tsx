import { useEffect, useMemo, useState } from "react";
import type { ShopifyOrderSummary, ShopifyProductRow, SyncLogEntry, MetricsSummaryResponse } from "@fig/shared";
import type { DateRange } from "../lib/dateRanges";
import { fetchShopifySummary, fetchShopifyProducts, triggerShopifySync, fetchSummary } from "../lib/api";
import { formatCurrency, formatNumber, formatPercent, formatMultiplier } from "../lib/format";
import { formatRelativeTime } from "../lib/relativeTime";
import { KpiTile } from "./KpiTile";
import { ShopifyProductTable } from "./ShopifyProductTable";
import { InfoNote } from "./InfoNote";
import { ParetoChart } from "./ParetoChart";

const SHOPIFY_COLOR = "#95BF47";

interface Props {
  range: DateRange;
  connected: boolean;
  lastSync: SyncLogEntry | null;
  onSyncComplete: () => void;
  refreshKey: number;
  targetRoas: number;
}

function safeDivide(n: number, d: number): number | null {
  return d > 0 ? n / d : null;
}

export function ShopifySection({ range, connected, lastSync, onSyncComplete, refreshKey, targetRoas }: Props) {
  const [summary, setSummary] = useState<ShopifyOrderSummary | null>(null);
  const [products, setProducts] = useState<ShopifyProductRow[]>([]);
  const [adSpend, setAdSpend] = useState<MetricsSummaryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      fetchShopifySummary(range.from, range.to),
      fetchShopifyProducts(range.from, range.to),
      // Combined Google + Meta spend for the same range -- the denominator
      // for this page's own ROAS/ACOS, blended on purpose (this is the
      // one place "how much did all ad spend return on the store" is the
      // actual question, unlike everywhere else in the app where blending
      // platforms would hide which one is driving the number).
      fetchSummary(range.from, range.to, ["google", "meta"]),
    ])
      .then(([summaryRes, productsRes, adSpendRes]) => {
        if (cancelled) return;
        setSummary(summaryRes.summary);
        setProducts(productsRes.products);
        setAdSpend(adSpendRes);
      })
      .catch((err) => !cancelled && setError(String(err.message ?? err)))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [range.from, range.to, connected, refreshKey]);

  const blendedSpend = adSpend?.blended.spend ?? null;
  const blendedRoas = summary && blendedSpend != null ? safeDivide(summary.revenue, blendedSpend) : null;
  const blendedAcos = summary && blendedSpend != null && summary.revenue > 0 ? safeDivide(blendedSpend, summary.revenue) : null;

  const paretoItems = useMemo(() => products.filter((p) => p.revenue > 0).map((p) => ({ key: p.productId, label: p.title ?? p.productId, value: p.revenue })), [products]);

  async function handleSync() {
    setSyncing(true);
    try {
      await triggerShopifySync(range.from, range.to);
      onSyncComplete();
    } finally {
      setSyncing(false);
    }
  }

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
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
        <span>
          {lastSync ? (
            <>
              Last synced {formatRelativeTime(lastSync.runAt)}
              {lastSync.status !== "success" && <span className="text-status-critical"> -- {lastSync.status}</span>}
            </>
          ) : (
            "Never synced"
          )}
        </span>
        <button
          type="button"
          onClick={handleSync}
          disabled={syncing}
          className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-ink-secondary hover:bg-surface-2 disabled:opacity-50 transition-colors"
        >
          {syncing ? "Syncing…" : "Sync now"}
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-status-critical/30 bg-status-critical/10 px-3 py-2 text-xs text-status-critical">{error}</div>
      )}

      <div className="flex items-center gap-1.5 text-xs text-ink-muted">
        <InfoNote label="About this data">
          Ground-truth order data from Shopify -- cross-check against each ad platform's own attributed revenue on
          its own page, never sum the two, they measure different things. ROAS/ACOS below are the one deliberate
          exception: Google + Meta spend blended against this page's real website revenue, since "what did all ad
          spend return on the store" is genuinely the question here.
        </InfoNote>
        Ground-truth order data from Shopify
      </div>

      <div className={`grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 ${loading ? "opacity-60" : ""}`}>
        <KpiTile label="Orders" value={formatNumber(summary?.orders)} numeric={summary?.orders} numericFormat="number" accent={SHOPIFY_COLOR} staggerIndex={0} />
        <KpiTile label="Revenue" value={formatCurrency(summary?.revenue)} numeric={summary?.revenue} numericFormat="currency" accent={SHOPIFY_COLOR} staggerIndex={1} />
        <KpiTile label="AOV" value={formatCurrency(summary?.aov)} numeric={summary?.aov} numericFormat="currency" accent={SHOPIFY_COLOR} staggerIndex={2} />
        <KpiTile label="Discounts" value={formatCurrency(summary?.discounts)} numeric={summary?.discounts} numericFormat="currency" accent={SHOPIFY_COLOR} staggerIndex={3} />
        <KpiTile
          label="ROAS"
          value={formatMultiplier(blendedRoas)}
          accent={SHOPIFY_COLOR}
          sublabel={`Google + Meta spend, target ${formatMultiplier(targetRoas)}`}
          staggerIndex={4}
        />
        <KpiTile label="ACOS" value={formatPercent(blendedAcos)} accent={SHOPIFY_COLOR} sublabel="Google + Meta spend" staggerIndex={5} />
        <KpiTile label="Sessions" value={formatNumber(summary?.sessions)} numeric={summary?.sessions} numericFormat="number" accent={SHOPIFY_COLOR} sublabel="site-wide, all pages" staggerIndex={6} />
        <KpiTile label="CVR" value={formatPercent(summary?.cvr)} numeric={summary?.cvr} numericFormat="percent" accent={SHOPIFY_COLOR} sublabel="units sold / sessions" staggerIndex={7} />
        <KpiTile label="Google Sessions" value={formatNumber(summary?.googleSessions)} accent={SHOPIFY_COLOR} sublabel="by utm_source, site-wide" staggerIndex={8} />
        <KpiTile label="Meta Sessions" value={formatNumber(summary?.metaSessions)} accent={SHOPIFY_COLOR} sublabel="by utm_source, site-wide" staggerIndex={9} />
      </div>

      <div className="flex items-center gap-1.5 text-xs text-ink-muted">
        <InfoNote label="How Google/Meta Sessions are classified">
          Classified from each session's utm_source tag (Shopify Analytics) -- directional, not a platform-verified
          attribution. Real-world utm_source values are messy (placements, influencer tools, etc.); unrecognized
          values fall into neither bucket rather than being guessed.
        </InfoNote>
        How the session splits above are classified
      </div>

      <div className="rounded-2xl border border-border bg-surface-1 p-4">
        <h3 className="mb-1 text-sm font-semibold text-ink-primary">Revenue concentration (Pareto)</h3>
        <ParetoChart items={paretoItems} color={SHOPIFY_COLOR} unitLabel="products" valueFormatter={(v) => formatCurrency(v, true)} />
      </div>

      <ShopifyProductTable products={products} />
    </div>
  );
}
