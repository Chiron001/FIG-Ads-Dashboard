import { getPool } from "./pool";

/** Cost of goods sold as a fraction of selling price -- editable from the
 * Settings page (db: app_settings.cogs_rate, db/migrations/0008). Falls
 * back to 0.35 (the original hardcoded assumption) if the singleton row is
 * somehow missing, e.g. the migration hasn't run yet -- never throws, since
 * Products/Product Quadrants should keep rendering either way. */
export async function getCogsRate(): Promise<number> {
  const pool = getPool();
  const { rows } = await pool.query(`select cogs_rate from app_settings where id = true`);
  return rows[0]?.cogs_rate ?? 0.35;
}
