import { getPool } from "../db/pool";
import { fetchGA4DailyChannelData } from "../connectors/ga4";
import type { SyncStatus } from "@fig/shared";

const BATCH_SIZE = 500;

async function upsertChannelDaily(rows: Awaited<ReturnType<typeof fetchGA4DailyChannelData>>): Promise<void> {
  if (rows.length === 0) return;
  const pool = getPool();
  const cols = ["date", "channel_group", "sessions", "conversions", "transactions", "revenue"] as const;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const values: unknown[] = [];
    const tuples: string[] = [];
    batch.forEach((r, idx) => {
      const base = idx * cols.length;
      tuples.push(`(${cols.map((_, j) => `$${base + j + 1}`).join(", ")})`);
      values.push(r.date, r.channelGroup, r.sessions, r.conversions, r.transactions, r.totalRevenue);
    });

    await pool.query(
      `insert into fact_ga4_channel_daily (${cols.join(", ")})
       values ${tuples.join(", ")}
       on conflict (date, channel_group) do update set
         sessions = excluded.sessions,
         conversions = excluded.conversions,
         transactions = excluded.transactions,
         revenue = excluded.revenue,
         ingested_at = now()`,
      values
    );
  }
}

export interface GA4SyncResult {
  status: SyncStatus;
  rows: number;
  error: string | null;
}

async function logSync(result: GA4SyncResult): Promise<void> {
  const pool = getPool();
  await pool.query(`insert into sync_log (platform, status, rows, error) values ('ga4', $1, $2, $3)`, [
    result.status,
    result.rows,
    result.error,
  ]);
}

export async function runGA4Sync(from: string, to: string): Promise<GA4SyncResult> {
  try {
    const rows = await fetchGA4DailyChannelData(from, to);
    await upsertChannelDaily(rows);
    const result: GA4SyncResult = { status: "success", rows: rows.length, error: null };
    await logSync(result);
    return result;
  } catch (err) {
    const result: GA4SyncResult = { status: "error", rows: 0, error: (err as Error).message };
    await logSync(result);
    return result;
  }
}
