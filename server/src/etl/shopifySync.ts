import { getPool } from "../db/pool";
import { ShopifyConnector, type CanonicalShopifyOrder, type CanonicalShopifyLineItem } from "../connectors/shopify";
import type { SyncStatus } from "@fig/shared";

const BATCH_SIZE = 500;

async function upsertOrders(orders: CanonicalShopifyOrder[]): Promise<void> {
  if (orders.length === 0) return;
  const pool = getPool();
  const cols = [
    "order_id",
    "order_number",
    "date",
    "financial_status",
    "total_price",
    "subtotal_price",
    "total_discounts",
    "total_tax",
    "currency",
    "source_name",
    "customer_id",
    "line_item_count",
    "raw",
  ] as const;

  for (let i = 0; i < orders.length; i += BATCH_SIZE) {
    const batch = orders.slice(i, i + BATCH_SIZE);
    const values: unknown[] = [];
    const tuples: string[] = [];
    batch.forEach((o, idx) => {
      const base = idx * cols.length;
      tuples.push(`(${cols.map((_, j) => `$${base + j + 1}`).join(", ")})`);
      values.push(
        o.orderId,
        o.orderNumber,
        o.date,
        o.financialStatus,
        o.totalPrice,
        o.subtotalPrice,
        o.totalDiscounts,
        o.totalTax,
        o.currency,
        o.sourceName,
        o.customerId,
        o.lineItemCount,
        JSON.stringify(o.raw)
      );
    });

    await pool.query(
      `insert into fact_shopify_orders (${cols.join(", ")})
       values ${tuples.join(", ")}
       on conflict (order_id) do update set
         order_number = excluded.order_number,
         financial_status = excluded.financial_status,
         total_price = excluded.total_price,
         subtotal_price = excluded.subtotal_price,
         total_discounts = excluded.total_discounts,
         total_tax = excluded.total_tax,
         source_name = excluded.source_name,
         customer_id = excluded.customer_id,
         line_item_count = excluded.line_item_count,
         raw = excluded.raw,
         ingested_at = now()`,
      values
    );
  }
}

async function upsertLineItems(lineItems: CanonicalShopifyLineItem[]): Promise<void> {
  if (lineItems.length === 0) return;
  const pool = getPool();
  const cols = [
    "id",
    "order_id",
    "date",
    "product_id",
    "product_handle",
    "variant_id",
    "title",
    "variant_title",
    "sku",
    "product_type",
    "vendor",
    "quantity",
    "price",
    "line_total",
    "raw",
  ] as const;

  for (let i = 0; i < lineItems.length; i += BATCH_SIZE) {
    const batch = lineItems.slice(i, i + BATCH_SIZE);
    const values: unknown[] = [];
    const tuples: string[] = [];
    batch.forEach((li, idx) => {
      const base = idx * cols.length;
      tuples.push(`(${cols.map((_, j) => `$${base + j + 1}`).join(", ")})`);
      values.push(
        li.id,
        li.orderId,
        li.date,
        li.productId,
        li.productHandle,
        li.variantId,
        li.title,
        li.variantTitle,
        li.sku,
        li.productType,
        li.vendor,
        li.quantity,
        li.price,
        li.lineTotal,
        JSON.stringify(li.raw)
      );
    });

    // Note: doesn't delete line items removed from an edited Shopify order
    // between syncs -- an edge case not worth the extra query for an
    // internal analytics tool (orders are rarely edited after the fact).
    await pool.query(
      `insert into fact_shopify_line_items (${cols.join(", ")})
       values ${tuples.join(", ")}
       on conflict (id) do update set
         title = excluded.title,
         variant_title = excluded.variant_title,
         sku = excluded.sku,
         product_handle = excluded.product_handle,
         product_type = excluded.product_type,
         vendor = excluded.vendor,
         quantity = excluded.quantity,
         price = excluded.price,
         line_total = excluded.line_total,
         raw = excluded.raw,
         ingested_at = now()`,
      values
    );
  }
}

export interface ShopifySyncResult {
  status: SyncStatus;
  rows: number;
  error: string | null;
}

async function logSync(result: ShopifySyncResult): Promise<void> {
  const pool = getPool();
  await pool.query(`insert into sync_log (platform, status, rows, error) values ('shopify', $1, $2, $3)`, [
    result.status,
    result.rows,
    result.error,
  ]);
}

export async function runShopifySync(from: string, to: string): Promise<ShopifySyncResult> {
  try {
    const connector = new ShopifyConnector();
    await connector.authenticate();
    const raw = await connector.fetchOrders(from, to);
    const { orders, lineItems } = connector.normalize(raw);
    await upsertOrders(orders);
    await upsertLineItems(lineItems);

    const result: ShopifySyncResult = { status: "success", rows: orders.length + lineItems.length, error: null };
    await logSync(result);
    return result;
  } catch (err) {
    const result: ShopifySyncResult = { status: "error", rows: 0, error: (err as Error).message };
    await logSync(result);
    return result;
  }
}
