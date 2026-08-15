import "../config/env";
import { runShopifySync } from "../etl/shopifySync";

// One-off historical load, mirrors scripts/backfill.ts's shape but for
// Shopify's separate sync path (runShopifySync, not the AdsConnector-based
// runSync).
//
// Run with: npm run shopify:backfill --workspace server -- --days=30

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const days = Number(process.argv.find((a) => a.startsWith("--days="))?.split("=")[1] ?? "30");
  const from = isoDaysAgo(days);
  const to = isoDaysAgo(0);

  console.log(`Backfilling Shopify orders for ${from}..${to} (${days} days)\n`);
  const result = await runShopifySync(from, to);
  if (result.status === "success") {
    console.log(`ok — ${result.rows} row(s) written`);
  } else {
    console.error(`failed — ${result.error}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
