import { Router } from "express";
import { getPool } from "../db/pool";
import { asyncHandler } from "../util/asyncHandler";
import { runShopifySync } from "../etl/shopifySync";
import { env } from "../config/env";
import type {
  ShopifyOrderSummary,
  ShopifySummaryResponse,
  ShopifyProductRow,
  ShopifyProductsResponse,
  ShopifyStatus,
  SyncLogEntry,
} from "@fig/shared";

export const shopifyRouter = Router();

function parseDateRange(query: Record<string, unknown>): { from: string; to: string } | null {
  const from = typeof query.from === "string" ? query.from : null;
  const to = typeof query.to === "string" ? query.to : null;
  if (!from || !to) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  if (from > to) return null;
  return { from, to };
}

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// GET /shopify/status
shopifyRouter.get(
  "/status",
  asyncHandler(async (_req, res) => {
    const pool = getPool();
    const { rows } = await pool.query(
      `select id::text as id, status, rows, error, run_at as "runAt"
       from sync_log
       where platform = 'shopify'
       order by run_at desc
       limit 1`
    );
    const row = rows[0];
    const lastSync: SyncLogEntry | null = row
      ? {
          id: row.id,
          platform: "shopify",
          runAt: row.runAt instanceof Date ? row.runAt.toISOString() : row.runAt,
          status: row.status,
          rows: row.rows,
          error: row.error,
        }
      : null;

    const body: ShopifyStatus = {
      connected: Boolean(env.shopify.storeDomain && env.shopify.adminAccessToken),
      lastSync,
    };
    res.json(body);
  })
);

// POST /shopify/sync -- body: { from?, to? } (YYYY-MM-DD), defaults to last 7 days.
shopifyRouter.post(
  "/sync",
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as { from?: unknown; to?: unknown };
    const from = typeof body.from === "string" ? body.from : isoDaysAgo(7);
    const to = typeof body.to === "string" ? body.to : isoDaysAgo(0);
    const result = await runShopifySync(from, to);
    res.status(result.status === "success" ? 200 : 502).json(result);
  })
);

// GET /shopify/summary?from&to
shopifyRouter.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const range = parseDateRange(req.query as Record<string, unknown>);
    if (!range) return res.status(400).json({ error: "from/to required, format YYYY-MM-DD, from <= to" });

    const pool = getPool();
    const { rows } = await pool.query(
      `select count(*)::float8 as orders,
              coalesce(sum(total_price), 0)::float8 as revenue,
              coalesce(sum(total_discounts), 0)::float8 as discounts
       from fact_shopify_orders
       where date between $1 and $2`,
      [range.from, range.to]
    );
    const row = rows[0];
    const summary: ShopifyOrderSummary = {
      orders: row.orders,
      revenue: row.revenue,
      aov: row.orders > 0 ? row.revenue / row.orders : null,
      discounts: row.discounts,
    };

    const response: ShopifySummaryResponse = { from: range.from, to: range.to, summary };
    res.json(response);
  })
);

// GET /shopify/products?from&to
shopifyRouter.get(
  "/products",
  asyncHandler(async (req, res) => {
    const range = parseDateRange(req.query as Record<string, unknown>);
    if (!range) return res.status(400).json({ error: "from/to required, format YYYY-MM-DD, from <= to" });

    const pool = getPool();
    const { rows } = await pool.query(
      `select
         product_id,
         max(sku) as sku,
         max(title) as title,
         max(product_type) as product_type,
         max(vendor) as vendor,
         sum(quantity)::float8 as units_sold,
         sum(line_total)::float8 as revenue,
         count(distinct order_id)::float8 as orders
       from fact_shopify_line_items
       where date between $1 and $2
       group by product_id
       order by revenue desc`,
      [range.from, range.to]
    );

    const products: ShopifyProductRow[] = rows.map((r) => ({
      productId: r.product_id ?? "unknown",
      sku: r.sku,
      title: r.title,
      productType: r.product_type,
      vendor: r.vendor,
      unitsSold: r.units_sold,
      revenue: r.revenue,
      orders: r.orders,
    }));

    const response: ShopifyProductsResponse = { from: range.from, to: range.to, products };
    res.json(response);
  })
);
