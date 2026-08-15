import { Pool } from "pg";
import { env } from "../config/env";

// Shared connection pool for all app read/write queries (API routes, ETL
// upserts). Separate from db/supabase.ts, which stays as the lightweight
// PostgREST client used only for the /health/db check — writes here go
// through raw pg because the upsert conflict target
// (platform, campaign_id, coalesce(ad_group_id, ''), date, attribution_window)
// is an expression-based unique index, and Supabase-js's upsert() only
// accepts a plain column list, not an arbitrary SQL expression, as its
// on_conflict target.
let pool: Pool | null = null;

export function getPool(): Pool {
  if (pool) return pool;
  if (!env.supabase.databaseUrl) {
    throw new Error("Missing DATABASE_URL in .env — cannot query Postgres.");
  }
  pool = new Pool({ connectionString: env.supabase.databaseUrl });
  return pool;
}
