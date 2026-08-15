import "../config/env";
import { runSync } from "../etl/sync";
import type { Platform } from "@fig/shared";

// One-off historical load so the dashboard has real data to show. This is
// intentionally simple (single fetch per platform, no date-chunking) --
// fine for the 30/60/90-day windows used here; Phase 8's production
// backfill (configurable window, chunked for rate limits) is a separate,
// later concern for multi-year historical loads.
//
// Run with: npm run backfill --workspace server -- --days=30
//       or: npm run backfill --workspace server -- --days=30 --platforms=google,meta

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const days = Number(args.find((a) => a.startsWith("--days="))?.split("=")[1] ?? "30");
  const platformsArg = args.find((a) => a.startsWith("--platforms="))?.split("=")[1];
  const platforms = (platformsArg ? platformsArg.split(",") : ["google", "meta"]) as Platform[];
  return { days, platforms };
}

async function main() {
  const { days, platforms } = parseArgs();
  const from = isoDaysAgo(days);
  const to = isoDaysAgo(0);

  console.log(`Backfilling ${platforms.join(", ")} for ${from}..${to} (${days} days)\n`);

  for (const platform of platforms) {
    console.log(`[${platform}] syncing...`);
    const result = await runSync(platform, from, to);
    if (result.status === "success") {
      console.log(`[${platform}] ok — ${result.rows} rows written\n`);
    } else {
      console.error(`[${platform}] failed — ${result.error}\n`);
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
