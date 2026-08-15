import "../config/env"; // loads .env before anything else reads process.env
import { GoogleAdsConnector } from "../connectors/google";

// Manual smoke test — not part of the running app. Pulls the last 7 days
// from the live Google Ads account and prints a summary, per the spec's
// "smoke-test each connector before moving on" instruction.
//
// Run with: npm run google:test --workspace server

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const connector = new GoogleAdsConnector();

  console.log("Authenticating...");
  await connector.authenticate();
  console.log("  ok\n");

  const from = isoDaysAgo(7);
  const to = isoDaysAgo(0);
  console.log(`Fetching ${from} to ${to}...`);
  const raw = await connector.fetchRaw(from, to);
  console.log(`  ${raw.length} raw row(s)\n`);

  const rows = connector.normalize(raw);

  const totals = rows.reduce(
    (acc, r) => {
      acc.spend += r.spend;
      acc.impressions += r.impressions;
      acc.clicks += r.clicks;
      acc.conversions += r.conversions;
      acc.revenue += r.revenue;
      return acc;
    },
    { spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 }
  );

  console.log("Totals (normalized, INR):");
  console.log(`  spend:       ${totals.spend.toFixed(2)}`);
  console.log(`  impressions: ${totals.impressions}`);
  console.log(`  clicks:      ${totals.clicks}`);
  console.log(`  conversions: ${totals.conversions}`);
  console.log(`  revenue:     ${totals.revenue.toFixed(2)}`);

  if (rows.length > 0) {
    console.log("\nSample normalized row:");
    console.log(JSON.stringify(rows[0], null, 2));
  } else {
    console.log("\nNo rows in this date range (account may genuinely have no activity, or campaigns are paused).");
  }
}

main().catch((err) => {
  console.error("\nGoogle connector smoke test failed:");
  console.error(err);
  process.exit(1);
});
