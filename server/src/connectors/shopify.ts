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
  // Opaque Shopify customer id (gid://shopify/Customer/...), null for guest
  // checkouts -- NOT name/email/phone, see db/migrations/0011's comment.
  // Used only to compute new-vs-returning for the Predictive Analysis
  // forecast (Nth order for a given id).
  customer: { id: string } | null;
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
  customerId: string | null;
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
          customer { id }
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

// --- live catalog (Projection Sheet's product list) -------------------------
//
// Unlike orders/line-items, the catalog isn't synced into Postgres at all --
// fetched live per request instead, same "not worth a storage layer" call as
// sessions above. Needed so the Projection Sheet can list every ACTIVE
// product to plan against, not just ones that happen to already have sales
// history in fact_shopify_line_items (a brand-new or slow-moving product
// still needs a row to set a target on).
const PRODUCTS_QUERY = `
  query Products($cursor: String) {
    products(first: 100, after: $cursor, query: "status:active", sortKey: TITLE) {
      pageInfo { hasNextPage endCursor }
      edges { node { id title handle priceRangeV2 { minVariantPrice { amount } } } }
    }
  }
`;

export interface CanonicalShopifyProduct {
  productId: string; // gid://shopify/Product/{id} -- same shape fact_shopify_line_items.product_id stores
  title: string;
  handle: string;
  /** Live selling price, min-variant (a product with multiple variants at
   * different prices has no single "the" price -- this is the starting/
   * lowest one, same convention Shopify's own storefront uses for "from
   * ₹X" display). Null if the product somehow has no priced variant. */
  price: number | null;
}

interface ProductsQueryResult {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: { node: { id: string; title: string; handle: string; priceRangeV2: { minVariantPrice: { amount: string } } } }[];
  };
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string; extensions?: { code?: string } }[];
}

interface OrdersQueryResult {
  orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; edges: { node: ShopifyRawOrder }[] };
}

// --- URL redirects (handle-rename tracking for session attribution) --------

const REDIRECTS_QUERY = `
  query Redirects($cursor: String) {
    urlRedirects(first: 250, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      edges { node { path target } }
    }
  }
`;

interface RedirectsQueryResult {
  urlRedirects: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: { node: { path: string; target: string } }[];
  };
}

/** Shopify auto-creates a redirect every time a product's handle changes
 * (and merchants can layer more manually) -- this store has at least one
 * product with 4 renames on record, chained. ShopifyQL's session data is
 * keyed by whatever landing_page_path a visitor ACTUALLY hit at the time,
 * which for a renamed product means most of its historical traffic sits
 * under a handle no longer in the live catalog. Naively joining sessions to
 * the live catalog by CURRENT handle (what fetchAllActiveProducts returns)
 * silently drops all of that -- confirmed live: "Petal Bloom Table Lamp"
 * (current handle petal-bloom-table-lamp) had 216 sessions under its
 * current handle vs. 7,321 under its immediately-prior one alone
 * (petal-bloom-origami-floral-table-lamp), a >30x undercount that inflated
 * its measured Previous Month CVR to 25% against every other product's
 * 1-5% range, and downstream made Required Traffic read as an implausibly
 * low 280. Fetched fresh per call (not cached across ShopifyConnector
 * instances -- callers like routes/projection.ts construct a new one per
 * request) -- cheap, a couple of paginated pages at most. */
async function fetchHandleRedirectMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let cursor: string | null = null;
  do {
    const data: RedirectsQueryResult = await shopifyGraphQL<RedirectsQueryResult>(REDIRECTS_QUERY, { cursor });
    for (const edge of data.urlRedirects.edges) {
      const from = extractProductHandle(edge.node.path);
      const to = extractProductHandle(edge.node.target);
      if (from && to && from !== to) map.set(from, to);
    }
    cursor = data.urlRedirects.pageInfo.hasNextPage ? data.urlRedirects.pageInfo.endCursor : null;
  } while (cursor);
  return map;
}

/** Follows a chain of handle renames (see fetchHandleRedirectMap) to the
 * current live handle -- depth-capped AND cycle-guarded, not just one or
 * the other, since a redirect loop is a real possibility in merchant-
 * managed data and this must never hang a request. */
function resolveCanonicalHandle(handle: string, redirects: Map<string, string>): string {
  let current = handle;
  const seen = new Set<string>([current]);
  for (let i = 0; i < 20; i++) {
    const next = redirects.get(current);
    if (!next || seen.has(next)) return current;
    seen.add(next);
    current = next;
  }
  return current;
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

  /** Every ACTIVE product in the catalog, live -- not filtered to ones with
   * sales history, since the Projection Sheet needs to offer a target on a
   * brand-new or slow-moving product too. */
  async fetchAllActiveProducts(): Promise<CanonicalShopifyProduct[]> {
    const products: CanonicalShopifyProduct[] = [];
    let cursor: string | null = null;

    do {
      const data: ProductsQueryResult = await shopifyGraphQL<ProductsQueryResult>(PRODUCTS_QUERY, { cursor });
      products.push(
        ...data.products.edges.map((e) => {
          const amount = e.node.priceRangeV2?.minVariantPrice?.amount;
          return { productId: e.node.id, title: e.node.title, handle: e.node.handle, price: amount != null ? Number(amount) : null };
        })
      );
      cursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
    } while (cursor);

    return products;
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
    const [rows, redirects] = await Promise.all([
      shopifyQL(
        `FROM sessions SHOW sessions, landing_page_path WHERE landing_page_path CONTAINS '/products/' ` +
          `GROUP BY landing_page_path SINCE ${from} UNTIL ${to} ORDER BY sessions DESC LIMIT 1000`
      ),
      fetchHandleRedirectMap(),
    ]);

    const byHandle = new Map<string, number>();
    for (const row of rows) {
      const rawHandle = extractProductHandle(row.landing_page_path ?? "");
      if (!rawHandle) continue;
      const handle = resolveCanonicalHandle(rawHandle, redirects);
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
    const buildMap = (rows: Record<string, string>[], redirects: Map<string, string>) => {
      const byHandle = new Map<string, number>();
      for (const row of rows) {
        const rawHandle = extractProductHandle(row.landing_page_path ?? "");
        if (!rawHandle) continue;
        const handle = resolveCanonicalHandle(rawHandle, redirects);
        byHandle.set(handle, (byHandle.get(handle) ?? 0) + Number(row.sessions ?? 0));
      }
      return byHandle;
    };

    const [googleRows, metaRows, redirects] = await Promise.all([
      shopifyQL(
        `FROM sessions SHOW sessions, landing_page_path WHERE landing_page_path CONTAINS '/products/' AND ${GOOGLE_UTM_WHERE} ` +
          `GROUP BY landing_page_path SINCE ${from} UNTIL ${to} ORDER BY sessions DESC LIMIT 1000`
      ),
      shopifyQL(
        `FROM sessions SHOW sessions, landing_page_path WHERE landing_page_path CONTAINS '/products/' AND ${META_UTM_WHERE} ` +
          `GROUP BY landing_page_path SINCE ${from} UNTIL ${to} ORDER BY sessions DESC LIMIT 1000`
      ),
      fetchHandleRedirectMap(),
    ]);

    return { google: buildMap(googleRows, redirects), meta: buildMap(metaRows, redirects) };
  }

  /** Per-product ATC (sessions that added it to cart) + bounce rate, keyed
   * by product handle. Both confirmed live against this account's ShopifyQL
   * schema -- "sessions_with_cart_additions" (a session count, additive
   * across the raw landing-page-path rows that collapse into one handle)
   * and "bounce_rate" (a rate Shopify itself computes per group, so
   * combining multiple raw paths for the same handle needs a
   * sessions-weighted average here, never a flat mean of two rates). Same
   * 1000-row cap and /products/-path filter as fetchProductSessions. */
  async fetchProductEngagement(from: string, to: string): Promise<Map<string, { atc: number; bounceRate: number | null }>> {
    const [rows, redirects] = await Promise.all([
      shopifyQL(
        `FROM sessions SHOW sessions, sessions_with_cart_additions, bounce_rate, landing_page_path ` +
          `WHERE landing_page_path CONTAINS '/products/' GROUP BY landing_page_path ` +
          `SINCE ${from} UNTIL ${to} ORDER BY sessions DESC LIMIT 1000`
      ),
      fetchHandleRedirectMap(),
    ]);

    const byHandle = new Map<string, { sessions: number; atc: number; bounceRateWeightedSum: number }>();
    for (const row of rows) {
      const rawHandle = extractProductHandle(row.landing_page_path ?? "");
      if (!rawHandle) continue;
      const handle = resolveCanonicalHandle(rawHandle, redirects);
      const sessions = Number(row.sessions ?? 0);
      const atc = Number(row.sessions_with_cart_additions ?? 0);
      const bounceRate = Number(row.bounce_rate ?? 0);
      const cur = byHandle.get(handle) ?? { sessions: 0, atc: 0, bounceRateWeightedSum: 0 };
      byHandle.set(handle, {
        sessions: cur.sessions + sessions,
        atc: cur.atc + atc,
        bounceRateWeightedSum: cur.bounceRateWeightedSum + bounceRate * sessions,
      });
    }

    const result = new Map<string, { atc: number; bounceRate: number | null }>();
    for (const [handle, v] of byHandle) {
      result.set(handle, { atc: v.atc, bounceRate: v.sessions > 0 ? v.bounceRateWeightedSum / v.sessions : null });
    }
    return result;
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
        customerId: order.customer?.id ?? null,
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
