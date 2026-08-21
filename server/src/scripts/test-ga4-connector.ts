import "../config/env"; // loads .env before anything else reads process.env
import { fetchGA4DailyChannelData } from "../connectors/ga4";

// Manual smoke test + exploration -- not part of the running app. Confirms
// auth works against the live GA4 property and reports what's actually in
// there (channel groups seen, whether purchase/revenue data exists at all,
// earliest date with data) before any schema/pipeline gets built on top of
// assumptions about what GA4 has.
//
// Run with: npm run ga4:test --workspace server

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

async function main() {
  // Wide window -- GA4's raw retention is commonly 2-14 months, but this
  // property may be much younger than that. Asking for a year and letting
  // the response tell us the real earliest date is more honest than
  // guessing a window.
  const from = isoDaysAgo(365);
  const to = isoDaysAgo(0);
  console.log(`Querying GA4 property, ${from} to ${to}...\n`);

  const rows = await fetchGA4DailyChannelData(from, to);
  console.log(`${rows.length} (date, channel) row(s) returned.\n`);

  if (rows.length === 0) {
    console.log("No rows at all -- either the property has no traffic in this window, or the service account");
    console.log("doesn't have Viewer access granted yet (GA4 Admin -> Property Access Management).");
    return;
  }

  const dates = rows.map((r) => r.date).sort();
  console.log(`Earliest date with data: ${dates[0]}`);
  console.log(`Latest date with data:   ${dates[dates.length - 1]}`);

  const channelGroups = new Set(rows.map((r) => r.channelGroup));
  console.log(`\nChannel groups seen (${channelGroups.size}):`);
  for (const cg of [...channelGroups].sort()) {
    const forChannel = rows.filter((r) => r.channelGroup === cg);
    const sessions = forChannel.reduce((s, r) => s + r.sessions, 0);
    const revenue = forChannel.reduce((s, r) => s + r.totalRevenue, 0);
    const transactions = forChannel.reduce((s, r) => s + r.transactions, 0);
    console.log(`  ${cg.padEnd(20)} sessions=${sessions}  transactions=${transactions}  revenue=${revenue.toFixed(2)}`);
  }

  const totalRevenue = rows.reduce((s, r) => s + r.totalRevenue, 0);
  const totalTransactions = rows.reduce((s, r) => s + r.transactions, 0);
  console.log(`\n=== Ecommerce tracking check ===`);
  if (totalRevenue === 0 && totalTransactions === 0) {
    console.log("totalRevenue and transactions are BOTH zero across the whole window.");
    console.log("This means GA4 ecommerce/purchase-event tracking is not sending revenue data --");
    console.log("GA4 can still report sessions/channel data, but not transaction revenue, until that's fixed.");
  } else {
    console.log(`Total revenue reported: ${totalRevenue.toFixed(2)}`);
    console.log(`Total transactions reported: ${totalTransactions}`);
    console.log("Ecommerce tracking looks active.");
  }

  console.log("\nSample rows:");
  console.log(JSON.stringify(rows.slice(0, 5), null, 2));
}

main().catch((err) => {
  console.error("\nGA4 connector smoke test failed:");
  console.error(err);
  process.exit(1);
});
