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
  product: { id: string; productType: string | null; vendor: string | null } | null;
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
                product { id productType vendor }
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
