import { env } from "../config/env";

// Ground-truth orders/products from Shopify's Admin GraphQL API. Not an
// AdsConnector (different shape entirely -- no campaigns/spend/clicks), so
// this doesn't implement that shared interface; it's its own thing with a
// parallel authenticate/fetch/normalize shape.

const API_VERSION = "2026-04";

function graphqlUrl(): string {
  return `https://${env.shopify.storeDomain}/admin/api/${API_VERSION}/graphql.json`;
}

interface ShopifyMoneySet {
  shopMoney: { amount: string; currencyCode: string };
}

interface ShopifyRawLineItem {
  id: string;
  title: string;
  variantTitle: string | null;
  sku: string | null;
  quantity: number;
  product: { id: string; productType: string | null; vendor: string | null; handle: string | null } | null;
  variant: { id: string } | null;
  originalUnitPriceSet: ShopifyMoneySet;
  discountedTotalSet: ShopifyMoneySet;
}

interface ShopifyRawOrder {
  id: string;
  name: string;
  createdAt: string;
  displayFinancialStatus: string | null;
  currentTotalPriceSet: ShopifyMoneySet;
  currentSubtotalPriceSet: ShopifyMoneySet;
  currentTotalDiscountsSet: ShopifyMoneySet;
  currentTotalTaxSet: ShopifyMoneySet;
  sourceName: string | null;
  lineItems: { edges: { node: ShopifyRawLineItem }[] };
}

export interface CanonicalShopifyOrder {
  orderId: string;
  orderNumber: string;
  date: string; // IST
  financialStatus: string | null;
  totalPrice: number;
  subtotalPrice: number;
  totalDiscounts: number;
  totalTax: number;
  currency: string | null;
  sourceName: string | null;
  lineItemCount: number;
  raw: Record<string, unknown>;
}

export interface CanonicalShopifyLineItem {
  id: string;
  orderId: string;
  date: string; // IST, denormalized from the order
  productId: string | null;
  productHandle: string | null;
  variantId: string | null;
  title: string | null;
  variantTitle: string | null;
  sku: string | null;
  productType: string | null;
  vendor: string | null;
  quantity: number;
  price: number;
  lineTotal: number;
  raw: Record<string, unknown>;
}

const ORDERS_QUERY = `
  query Orders($cursor: String, $searchQuery: String!) {
    orders(first: 100, after: $cursor, query: $searchQuery, sortKey: CREATED_AT) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          name
          createdAt
          displayFinancialStatus
          currentTotalPriceSet { shopMoney { amount currencyCode } }
          currentSubtotalPriceSet { shopMoney { amount currencyCode } }
          currentTotalDiscountsSet { shopMoney { amount currencyCode } }
          currentTotalTaxSet { shopMoney { amount currencyCode } }
          sourceName
          lineItems(first: 100) {
            edges {
              node {
                id
                title
                variantTitle
                sku
                quantity
                product { id productType vendor handle }
                variant { id }
                originalUnitPriceSet { shopMoney { amount currencyCode } }
                discountedTotalSet { shopMoney { amount currencyCode } }
              }
            }
          }
        }
      }
    }
  }
`;

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string; extensions?: { code?: string } }[];
}

interface OrdersQueryResult {
  orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; edges: { node: ShopifyRawOrder }[] };
}

// --- sessions (Shopify Analytics, via ShopifyQL) ----------------------------
//
// Not part of the Orders/Products Admin API at all -- session/traffic data
// lives in Shopify's separate analytics engine, queried via the
// shopifyqlQuery field (confirmed live against this account's schema:
// ShopifyqlQueryResponse { parseErrors: [String!]!, tableData: { columns, rows } }).
// Deliberately NOT stored (see db/migrations/0007's header) -- fetched live
// per request instead.
const SHOPIFYQL_QUERY = `
  query ShopifyQL($ql: String!) {
    shopifyqlQuery(query: $ql) {
      parseErrors
      tableData {
        columns { name }
        rows
      }
    }
  }
`;

interface ShopifyqlResult {
  shopifyqlQuery: {
    parseErrors: string[];
    tableData: { columns: { name: string }[]; rows: Record<string, string>[] } | null;
  };
}

async function shopifyQL(ql: string): Promise<Record<string, string>[]> {
  const data = await shopifyGraphQL<ShopifyqlResult>(SHOPIFYQL_QUERY, { ql });
  const { parseErrors, tableData } = data.shopifyqlQuery;
  if (parseErrors.length > 0) {
    throw new Error(`ShopifyQL parse error: ${parseErrors.join("; ")}`);
  }
  return tableData?.rows ?? [];
}

/** Extracts the product handle from a session's landing_page_path --
 * "/products/wavy-floor-lamp-red" or a nested
 * "/collections/x/products/wavy-floor-lamp-red" both -> "wavy-floor-lamp-red".
 * Query strings/fragments are stripped, not part of the handle. */
function extractProductHandle(landingPagePath: string): string | null {
  const match = landingPagePath.match(/\/products\/([^/?#]+)/);
  return match ? match[1] : null;
}

/** Classifies a raw ShopifyQL utm_source value into an ad platform bucket.
 * Real observed values on this store are messy -- Meta's dynamic/multi-
 * placement campaigns auto-tag utm_source with the placement itself
 * ("MetaAds", "facebook", "Instagram_Reels", "Facebook_Mobile_Feed", "ig",
 * "Threads_Feed", ...) rather than a single constant, and Google shows up as
 * either "google" or the shorthand "g". Everything else (kwikengage,
 * chatgpt.com, wishlink, null/direct, ...) is a different channel entirely,
 * not "unclassified Meta/Google" -- bucketed as "other" rather than guessed.
 * This is the single source of truth for the bucketing; the WHERE-clause
 * fragments below must stay in sync with it (kept adjacent on purpose). */
export type UtmPlatformBucket = "google" | "meta" | "other";

export function classifyUtmSource(raw: string | null): UtmPlatformBucket | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (s === "g" || s.includes("google")) return "google";
  if (s === "ig" || s === "fb" || s.includes("facebook") || s.includes("instagram") || s.includes("meta") || s.includes("threads")) {
    return "meta";
  }
  return "other";
}

// Deliberately over-inclusive ShopifyQL WHERE fragments mirroring
// classifyUtmSource above -- pre-filtering server-side keeps each platform's
// query well under ShopifyQL's 1000-row cap (a combined GROUP BY
// landing_page_path, utm_source query blows past that cap even over a
// 7-day window, since the long tail of one-off utm_source values multiplies
// row count; filtering to one platform first collapses that back down to
// the size of the product catalog, confirmed live).
const GOOGLE_UTM_WHERE = "(utm_source = 'g' OR utm_source CONTAINS 'google')";
const META_UTM_WHERE =
  "(utm_source CONTAINS 'facebook' OR utm_source CONTAINS 'instagram' OR utm_source CONTAINS 'meta' OR utm_source CONTAINS 'threads' OR utm_source = 'ig' OR utm_source = 'fb')";

const MAX_RETRIES = 5;
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function shopifyGraphQL<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(graphqlUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": env.shopify.adminAccessToken!,
      },
      body: JSON.stringify({ query, variables }),
    });

    const body = (await res.json()) as GraphQLResponse<T>;
    const throttled = body.errors?.some((e) => e.extensions?.code === "THROTTLED") || res.status === 429;

    if (throttled && attempt < MAX_RETRIES) {
      const backoffMs = 2 ** attempt * 1000;
      console.warn(`[shopify connector] throttled, retrying in ${backoffMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
      await sleep(backoffMs);
      continue;
    }

    if (body.errors && body.errors.length > 0) {
      throw new Error(`Shopify GraphQL error: ${body.errors.map((e) => e.message).join("; ")}`);
    }
    if (!res.ok) {
      throw new Error(`Shopify API error: ${res.status} ${res.statusText}`);
    }
    return body.data as T;
  }
  throw new Error("Shopify API: exhausted retries without a non-throttled response.");
}

function toISTDate(isoInstant: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(isoInstant));
}

export class ShopifyConnector {
  async authenticate(): Promise<void> {
    const { storeDomain, adminAccessToken } = env.shopify;
    const missing = Object.entries({ storeDomain, adminAccessToken })
      .filter(([, v]) => !v)
      .map(([k]) => k);
    if (missing.length > 0) {
      throw new Error(`Shopify connector: missing env var(s): ${missing.join(", ")}. See .env.example.`);
    }

    // Real connectivity check, same pattern as the ads connectors: fails
    // loudly here with a clear reason rather than deep inside fetchOrders().
    await shopifyGraphQL<{ shop: { name: string } }>("{ shop { name } }", {});
  }

  async fetchOrders(from: string, to: string): Promise<ShopifyRawOrder[]> {
    const searchQuery = `created_at:>='${from}T00:00:00Z' created_at:<='${to}T23:59:59Z'`;
    const orders: ShopifyRawOrder[] = [];
    let cursor: string | null = null;

    do {
      const data: OrdersQueryResult = await shopifyGraphQL<OrdersQueryResult>(ORDERS_QUERY, { cursor, searchQuery });

      orders.push(...data.orders.edges.map((e) => e.node));
      cursor = data.orders.pageInfo.hasNextPage ? data.orders.pageInfo.endCursor : null;
    } while (cursor);

    return orders;
  }

  /** True site-wide session total for the range (ungrouped ShopifyQL query
   * -> a single row, no truncation risk regardless of landing-page
   * cardinality) -- this is the number the "Sessions" KPI and the overall
   * CVR denominator use. */
  async fetchTotalSessions(from: string, to: string): Promise<number> {
    const rows = await shopifyQL(`FROM sessions SHOW sessions SINCE ${from} UNTIL ${to}`);
    return Number(rows[0]?.sessions ?? 0);
  }

  /** Per-product session counts for the range, keyed by product handle.
   * ShopifyQL caps any single query at 1000 result rows -- this store's
   * landing-page long tail (query-string/UTM variants of the same product
   * URL) blows past that even after filtering to /products/ paths, so
   * ORDER BY sessions DESC ensures truncation only drops low-traffic
   * variants, not real products. Aggregated by extracted handle here since
   * multiple raw paths (direct + via a collection) can point at the same
   * product. */
  async fetchProductSessions(from: string, to: string): Promise<Map<string, number>> {
    const rows = await shopifyQL(
      `FROM sessions SHOW sessions, landing_page_path WHERE landing_page_path CONTAINS '/products/' ` +
        `GROUP BY landing_page_path SINCE ${from} UNTIL ${to} ORDER BY sessions DESC LIMIT 1000`
    );

    const byHandle = new Map<string, number>();
    for (const row of rows) {
      const handle = extractProductHandle(row.landing_page_path ?? "");
      if (!handle) continue;
      byHandle.set(handle, (byHandle.get(handle) ?? 0) + Number(row.sessions ?? 0));
    }
    return byHandle;
  }

  /** Site-wide session totals for the range, split into Google-attributed
   * and Meta-attributed via utm_source (see classifyUtmSource). Two
   * ungrouped queries -> one row each, no truncation risk. */
  async fetchTotalSessionsByPlatform(from: string, to: string): Promise<{ google: number; meta: number }> {
    const [googleRows, metaRows] = await Promise.all([
      shopifyQL(`FROM sessions SHOW sessions WHERE ${GOOGLE_UTM_WHERE} SINCE ${from} UNTIL ${to}`),
      shopifyQL(`FROM sessions SHOW sessions WHERE ${META_UTM_WHERE} SINCE ${from} UNTIL ${to}`),
    ]);
    return {
      google: Number(googleRows[0]?.sessions ?? 0),
      meta: Number(metaRows[0]?.sessions ?? 0),
    };
  }

  /** Per-product session counts for the range, split by ad platform via
   * utm_source (see classifyUtmSource), keyed by product handle. Filtering
   * to one platform before GROUP BY landing_page_path keeps each query's
   * row count bounded by the product catalog rather than the utm_source
   * long tail -- see the WHERE-fragment comment above. */
  async fetchProductSessionsByPlatform(from: string, to: string): Promise<{ google: Map<string, number>; meta: Map<string, number> }> {
    const buildMap = (rows: Record<string, string>[]) => {
      const byHandle = new Map<string, number>();
      for (const row of rows) {
        const handle = extractProductHandle(row.landing_page_path ?? "");
        if (!handle) continue;
        byHandle.set(handle, (byHandle.get(handle) ?? 0) + Number(row.sessions ?? 0));
      }
      return byHandle;
    };

    const [googleRows, metaRows] = await Promise.all([
      shopifyQL(
        `FROM sessions SHOW sessions, landing_page_path WHERE landing_page_path CONTAINS '/products/' AND ${GOOGLE_UTM_WHERE} ` +
          `GROUP BY landing_page_path SINCE ${from} UNTIL ${to} ORDER BY sessions DESC LIMIT 1000`
      ),
      shopifyQL(
        `FROM sessions SHOW sessions, landing_page_path WHERE landing_page_path CONTAINS '/products/' AND ${META_UTM_WHERE} ` +
          `GROUP BY landing_page_path SINCE ${from} UNTIL ${to} ORDER BY sessions DESC LIMIT 1000`
      ),
    ]);

    return { google: buildMap(googleRows), meta: buildMap(metaRows) };
  }

  normalize(orders: ShopifyRawOrder[]): { orders: CanonicalShopifyOrder[]; lineItems: CanonicalShopifyLineItem[] } {
    const canonicalOrders: CanonicalShopifyOrder[] = [];
    const canonicalLineItems: CanonicalShopifyLineItem[] = [];

    for (const order of orders) {
      const date = toISTDate(order.createdAt);
      const lineItemNodes = order.lineItems.edges.map((e) => e.node);

      canonicalOrders.push({
        orderId: order.id,
        orderNumber: order.name,
        date,
        financialStatus: order.displayFinancialStatus,
        totalPrice: Number(order.currentTotalPriceSet.shopMoney.amount),
        subtotalPrice: Number(order.currentSubtotalPriceSet.shopMoney.amount),
        totalDiscounts: Number(order.currentTotalDiscountsSet.shopMoney.amount),
        totalTax: Number(order.currentTotalTaxSet.shopMoney.amount),
        currency: order.currentTotalPriceSet.shopMoney.currencyCode,
        sourceName: order.sourceName,
        lineItemCount: lineItemNodes.length,
        raw: order as unknown as Record<string, unknown>,
      });

      for (const li of lineItemNodes) {
        canonicalLineItems.push({
          id: li.id,
          orderId: order.id,
          date,
          productId: li.product?.id ?? null,
          productHandle: li.product?.handle ?? null,
          variantId: li.variant?.id ?? null,
          title: li.title,
          variantTitle: li.variantTitle,
          sku: li.sku,
          productType: li.product?.productType ?? null,
          vendor: li.product?.vendor ?? null,
          quantity: li.quantity,
          price: Number(li.originalUnitPriceSet.shopMoney.amount),
          lineTotal: Number(li.discountedTotalSet.shopMoney.amount),
          raw: li as unknown as Record<string, unknown>,
        });
      }
    }

    return { orders: canonicalOrders, lineItems: canonicalLineItems };
  }
}
