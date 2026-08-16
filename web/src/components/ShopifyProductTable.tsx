import { useMemo, useState } from "react";
import type { ShopifyProductRow } from "@fig/shared";
import { formatCurrency, formatNumber, formatPercent } from "../lib/format";
import { computeDelta } from "../lib/delta";
import { DeltaBadge } from "./DeltaBadge";

interface Column {
  key: keyof ShopifyProductRow;
  label: string;
  align: "left" | "right";
  format: (r: ShopifyProductRow) => string;
}

const COLUMNS: Column[] = [
  { key: "title", label: "Product", align: "left", format: (r) => r.title ?? r.productId },
  { key: "sku", label: "SKU", align: "left", format: (r) => r.sku ?? "N/A" },
  { key: "productType", label: "Type", align: "left", format: (r) => r.productType ?? "N/A" },
  { key: "vendor", label: "Vendor", align: "left", format: (r) => r.vendor ?? "N/A" },
  { key: "unitsSold", label: "Units Sold", align: "right", format: (r) => formatNumber(r.unitsSold) },
  { key: "orders", label: "Orders", align: "right", format: (r) => formatNumber(r.orders) },
  { key: "revenue", label: "Revenue", align: "right", format: (r) => formatCurrency(r.revenue) },
  { key: "sessions", label: "Sessions", align: "right", format: (r) => formatNumber(r.sessions) },
  { key: "cvr", label: "CVR", align: "right", format: (r) => formatPercent(r.cvr) },
  { key: "googleSessions", label: "Google Sessions", align: "right", format: (r) => formatNumber(r.googleSessions) },
  { key: "metaSessions", label: "Meta Sessions", align: "right", format: (r) => formatNumber(r.metaSessions) },
];

interface Props {
  products: ShopifyProductRow[];
  /** Same product rows, fetched for the "Compare to" period -- null/absent
   * when no comparison is active. Matched by productId below, delta shown
   * on Revenue only (the one figure this table's sorting defaults to). */
  comparisonProducts?: ShopifyProductRow[] | null;
}

export function ShopifyProductTable({ products, comparisonProducts }: Props) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<keyof ShopifyProductRow>("revenue");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const comparisonByProductId = useMemo(() => {
    if (!comparisonProducts) return null;
    return new Map(comparisonProducts.map((p) => [p.productId, p]));
  }, [comparisonProducts]);

  const sorted = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = term
      ? products.filter((p) => (p.title ?? "").toLowerCase().includes(term) || (p.sku ?? "").toLowerCase().includes(term))
      : products;

    return [...filtered].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const aNull = av == null;
      const bNull = bv == null;
      if (aNull && bNull) return 0;
      if (aNull) return 1; // nulls always last, regardless of direction
      if (bNull) return -1;
      const cmp = typeof av === "string" || typeof bv === "string" ? String(av).localeCompare(String(bv)) : av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [products, search, sortKey, sortDir]);

  function toggleSort(key: keyof ShopifyProductRow) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-surface-1">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold text-ink-primary">
          Products <span className="font-normal text-ink-muted">({sorted.length})</span>
        </h3>
        <input
          type="text"
          placeholder="Search products or SKU…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-56 rounded-md border border-border bg-surface-0 px-3 py-1.5 text-sm text-ink-primary placeholder:text-ink-muted"
        />
      </div>

      {sorted.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-ink-muted">No product sales in this date range.</div>
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
              {sorted.map((row) => {
                const comp = comparisonByProductId?.get(row.productId) ?? null;
                return (
                  <tr key={row.productId} className="border-b border-border last:border-0 transition-colors hover:bg-accent-soft">
                    {COLUMNS.map((col) => (
                      <td
                        key={col.key}
                        className={`whitespace-nowrap px-4 py-2 tabular-nums ${
                          col.align === "right" ? "text-right text-ink-secondary" : "text-left text-ink-primary"
                        } ${col.key === "title" ? "max-w-xs truncate font-medium" : ""}`}
                      >
                        {col.format(row)}
                        {col.key === "revenue" && comparisonByProductId && <DeltaBadge value={computeDelta(row.revenue, comp?.revenue)} />}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
