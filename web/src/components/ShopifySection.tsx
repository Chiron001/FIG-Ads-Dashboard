import { useEffect, useState } from "react";
import type { ShopifyOrderSummary, ShopifyProductRow, SyncLogEntry } from "@fig/shared";
import type { DateRange } from "../lib/dateRanges";
import { fetchShopifySummary, fetchShopifyProducts, triggerShopifySync } from "../lib/api";
import { formatCurrency, formatNumber } from "../lib/format";
import { formatRelativeTime } from "../lib/relativeTime";
import { KpiTile } from "./KpiTile";
import { ShopifyProductTable } from "./ShopifyProductTable";

const SHOPIFY_COLOR = "#95BF47";

interface Props {
  range: DateRange;
  connected: boolean;
  lastSync: SyncLogEntry | null;
  onSyncComplete: () => void;
  refreshKey: number;
}

export function ShopifySection({ range, connected, lastSync, onSyncComplete, refreshKey }: Props) {
  const [summary, setSummary] = useState<ShopifyOrderSummary | null>(null);
  const [products, setProducts] = useState<ShopifyProductRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([fetchShopifySummary(range.from, range.to), fetchShopifyProducts(range.from, range.to)])
      .then(([summaryRes, productsRes]) => {
        if (cancelled) return;
        setSummary(summaryRes.summary);
        setProducts(productsRes.products);
      })
      .catch((err) => !cancelled && setError(String(err.message ?? err)))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [range.from, range.to, connected, refreshKey]);

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
              {lastSync.status !== "success" && <span className="text-status-critical"> — {lastSync.status}</span>}
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

      <div className="rounded-md border border-border bg-surface-1 px-3 py-2 text-xs text-ink-muted">
        Ground-truth order data from Shopify — cross-check against each ad platform's own attributed revenue above; never sum the two, they measure different things.
      </div>

      <div className={`grid grid-cols-2 gap-3 sm:grid-cols-4 ${loading ? "opacity-60" : ""}`}>
        <KpiTile label="Orders" value={formatNumber(summary?.orders)} accent={SHOPIFY_COLOR} />
        <KpiTile label="Revenue" value={formatCurrency(summary?.revenue)} accent={SHOPIFY_COLOR} />
        <KpiTile label="AOV" value={formatCurrency(summary?.aov)} accent={SHOPIFY_COLOR} />
        <KpiTile label="Discounts" value={formatCurrency(summary?.discounts)} accent={SHOPIFY_COLOR} />
      </div>

      <ShopifyProductTable products={products} />
    </div>
  );
}
