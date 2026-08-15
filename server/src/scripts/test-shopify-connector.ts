import "../config/env";
import { ShopifyConnector } from "../connectors/shopify";

// Manual smoke test -- not part of the running app. Pulls the last 30 days
// of orders and prints a summary.
//
// Run with: npm run shopify:test --workspace server

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const connector = new ShopifyConnector();

  console.log("Authenticating...");
  await connector.authenticate();
  console.log("  ok\n");

  const from = isoDaysAgo(30);
  const to = isoDaysAgo(0);
  console.log(`Fetching orders ${from} to ${to}...`);
  const raw = await connector.fetchOrders(from, to);
  console.log(`  ${raw.length} raw order(s)\n`);

  const { orders, lineItems } = connector.normalize(raw);
  const totalRevenue = orders.reduce((s, o) => s + o.totalPrice, 0);
  const totalDiscounts = orders.reduce((s, o) => s + o.totalDiscounts, 0);

  console.log("Totals:");
  console.log(`  orders:     ${orders.length}`);
  console.log(`  revenue:    ${totalRevenue.toFixed(2)}`);
  console.log(`  discounts:  ${totalDiscounts.toFixed(2)}`);
  console.log(`  line items: ${lineItems.length}`);

  if (orders.length > 0) {
    console.log("\nSample order:");
    console.log(JSON.stringify({ ...orders[0], raw: undefined }, null, 2));
  }
  if (lineItems.length > 0) {
    console.log("\nSample line item:");
    console.log(JSON.stringify({ ...lineItems[0], raw: undefined }, null, 2));
  }
}

main().catch((err) => {
  console.error("\nShopify connector smoke test failed:");
  console.error(err);
  process.exit(1);
});
