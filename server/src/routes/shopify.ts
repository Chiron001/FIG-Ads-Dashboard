import { Router } from "express";
import { getPool } from "../db/pool";
import { asyncHandler } from "../util/asyncHandler";
import { runShopifySync } from "../etl/shopifySync";
import { ShopifyConnector } from "../connectors/shopify";
import { env } from "../config/env";
import type {
  ShopifyOrderSummary,
  ShopifySummaryResponse,
  ShopifyProductRow,
  ShopifyProductsResponse,
  ShopifyStatus,
  SyncLogEntry,
} from "@fig/shared";

function safeDivide(n: number, d: number | null): number | null {
  return d != null && d > 0 ? n / d : null;
}

/** Live session totals (Shopify Analytics, via ShopifyQL) are a nice-to-have
 * on top of the ground-truth order data this route otherwise serves entirely
 * from Postgres -- if the ShopifyQL call fails for any reason (a plan/
 * permission restriction, a transient API issue), the rest of the response
 * still renders; sessions/cvr alone drop to null ("—" in the UI). */
async function fetchTotalSessionsSafe(from: string, to: string): Promise<number | null> {
  try {
    const connector = new ShopifyConnector();
    return await connector.fetchTotalSessions(from, to);
  } catch (err) {
    console.warn("[shopify] fetchTotalSessions failed, returning null:", err);
    return null;
  }
}

async function fetchProductSessionsSafe(from: string, to: string): Promise<Map<string, number>> {
  try {
    const connector = new ShopifyConnector();
    return await connector.fetchProductSessions(from, to);
  } catch (err) {
    console.warn("[shopify] fetchProductSessions failed, returning empty map:", err);
    return new Map();
  }
}

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
    const [{ rows: orderRows }, { rows: lineItemRows }, sessions] = await Promise.all([
      pool.query(
        `select count(*)::float8 as orders,
                coalesce(sum(total_price), 0)::float8 as revenue,
                coalesce(sum(total_discounts), 0)::float8 as discounts
         from fact_shopify_orders
         where date between $1 and $2`,
        [range.from, range.to]
      ),
      pool.query(
        `select coalesce(sum(quantity), 0)::float8 as units_sold
         from fact_shopify_line_items
         where date between $1 and $2`,
        [range.from, range.to]
      ),
      fetchTotalSessionsSafe(range.from, range.to),
    ]);
    const orderRow = orderRows[0];
    const unitsSold = lineItemRows[0].units_sold;

    const summary: ShopifyOrderSummary = {
      orders: orderRow.orders,
      revenue: orderRow.revenue,
      aov: orderRow.orders > 0 ? orderRow.revenue / orderRow.orders : null,
      discounts: orderRow.discounts,
      unitsSold,
      sessions,
      cvr: safeDivide(unitsSold, sessions),
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
    const [{ rows }, sessionsByHandle] = await Promise.all([
      pool.query(
        `select
           product_id,
           max(product_handle) as product_handle,
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
      ),
      fetchProductSessionsSafe(range.from, range.to),
    ]);

    const products: ShopifyProductRow[] = rows.map((r) => {
      const sessions = r.product_handle ? (sessionsByHandle.get(r.product_handle) ?? null) : null;
      return {
        productId: r.product_id ?? "unknown",
        productHandle: r.product_handle,
        sku: r.sku,
        title: r.title,
        productType: r.product_type,
        vendor: r.vendor,
        unitsSold: r.units_sold,
        revenue: r.revenue,
        orders: r.orders,
        sessions,
        cvr: safeDivide(r.units_sold, sessions),
      };
    });

    const response: ShopifyProductsResponse = { from: range.from, to: range.to, products };
    res.json(response);
  })
);
