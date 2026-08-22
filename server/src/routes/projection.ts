import { Router } from "express";
import { getPool } from "../db/pool";
import { asyncHandler } from "../util/asyncHandler";
import { ShopifyConnector, type CanonicalShopifyProduct } from "../connectors/shopify";
import { fetchGA4ProductSessionsByPlatform } from "../connectors/ga4";
import { fetchAdMetricsByProductKeys } from "./shopify";
import type { ProjectionRow, ProjectionResponse, ProjectionUpdateEntry, ProjectionInsight } from "@fig/shared";

export const projectionRouter = Router();

function todayIST(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function daysInMonth(year: number, month1Indexed: number): number {
  return new Date(Date.UTC(year, month1Indexed, 0)).getUTCDate();
}

interface MonthRange {
  monthKey: string; // "YYYY-MM"
  start: string; // "YYYY-MM-01"
  end: string; // last day of the month, "YYYY-MM-DD"
  daysInMonth: number;
}

interface MonthInfo {
  current: MonthRange;
  previous: MonthRange;
  dayOfMonth: number;
  mtdEnd: string;
}

/** Always "this month" (server's current IST date) -- no month picker yet.
 * DB schema is already keyed by month (product_targets.month) so adding one
 * later doesn't need a migration, just this function taking a param. */
function currentMonthInfo(today: string): MonthInfo {
  const [y, m, d] = today.split("-").map(Number);
  const curDays = daysInMonth(y, m);
  const current: MonthRange = { monthKey: `${y}-${pad2(m)}`, start: `${y}-${pad2(m)}-01`, end: `${y}-${pad2(m)}-${pad2(curDays)}`, daysInMonth: curDays };

  let py = y;
  let pm = m - 1;
  if (pm === 0) {
    pm = 12;
    py = y - 1;
  }
  const prevDays = daysInMonth(py, pm);
  const previous: MonthRange = { monthKey: `${py}-${pad2(pm)}`, start: `${py}-${pad2(pm)}-01`, end: `${py}-${pad2(pm)}-${pad2(prevDays)}`, daysInMonth: prevDays };

  return { current, previous, dayOfMonth: d, mtdEnd: today };
}

function safeDivide(n: number | null | undefined, d: number | null | undefined): number | null {
  if (n == null || d == null || d === 0) return null;
  return n / d;
}

// --- Live Shopify data, safe wrappers -- same "don't take the whole sheet
// down over one ShopifyQL/catalog hiccup" convention as routes/shopify.ts. ---

async function fetchCatalogSafe(): Promise<CanonicalShopifyProduct[]> {
  try {
    return await new ShopifyConnector().fetchAllActiveProducts();
  } catch (err) {
    console.warn("[projection] fetchAllActiveProducts failed, returning empty catalog:", err);
    return [];
  }
}

async function fetchSessionsSafe(from: string, to: string): Promise<Map<string, number>> {
  try {
    return await new ShopifyConnector().fetchProductSessions(from, to);
  } catch (err) {
    console.warn("[projection] fetchProductSessions failed, returning empty map:", err);
    return new Map();
  }
}

// GA4's real channel classification, not the old utm_source regex guess --
// see connectors/ga4.ts's fetchGA4ProductSessionsByPlatform header comment.
async function fetchSessionsByPlatformSafe(from: string, to: string): Promise<{ google: Map<string, number>; meta: Map<string, number> }> {
  try {
    return await fetchGA4ProductSessionsByPlatform(from, to);
  } catch (err) {
    console.warn("[projection] fetchGA4ProductSessionsByPlatform failed, returning empty maps:", err);
    return { google: new Map(), meta: new Map() };
  }
}

/** The described logic, formalized:
 * - No target set -> nothing to judge pace against.
 * - Traffic requirement not computable (no previous-month CVR to base it
 *   on) -> fall back to a units-only verdict rather than guessing a traffic
 *   comparison from nothing.
 * - On pace on units: traffic pace also healthy -> "on track"; traffic
 *   falling short -> "increase sessions" (the DRR is fine FOR NOW, but
 *   won't be sustained without more traffic).
 * - Behind pace on units: traffic also short -> "increase sessions"; traffic
 *   on track despite units lagging -> "review ads" (volume isn't the
 *   problem, conversion/targeting likely is). */
function computeInsight(currentDrr: number | null, plannedDrr: number | null, projectedSessions: number | null, requiredTraffic: number | null): ProjectionInsight {
  if (currentDrr == null || plannedDrr == null) {
    return { verdict: "no_target", message: "Set a Unit Target to see pace and traffic insight." };
  }
  const onPaceUnits = currentDrr >= plannedDrr;

  if (requiredTraffic == null || projectedSessions == null) {
    return onPaceUnits
      ? { verdict: "on_track", message: "Units on pace for target. Traffic requirement isn't computable yet (no previous-month CVR/sessions to base it on)." }
      : { verdict: "review_ads", message: "Behind pace on units. Traffic requirement isn't computable yet -- review ad performance directly." };
  }

  const trafficOnPace = projectedSessions >= requiredTraffic;

  if (onPaceUnits) {
    return trafficOnPace
      ? { verdict: "on_track", message: "On track -- DRR and traffic pace both healthy, expect to hit target." }
      : { verdict: "increase_sessions", message: "Units are on pace, but projected traffic falls short of what's required to sustain this DRR -- increase sessions." };
  }
  return trafficOnPace
    ? { verdict: "review_ads", message: "Behind pace on units despite traffic being on track -- review ad creative/targeting, not just spend/volume." }
    : { verdict: "behind_and_low_traffic", message: "Behind pace on units, and traffic is also short of what's required this month -- increase sessions." };
}

// GET /projection
projectionRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const { current, previous, dayOfMonth, mtdEnd } = currentMonthInfo(todayIST());
    const pool = getPool();

    const [catalog, prevSessionsByHandle, mtdSessionsByHandle, mtdSessionsByPlatform, adMetricsPrevMonth, { rows: lineItemRows }, { rows: targetRows }] =
      await Promise.all([
        fetchCatalogSafe(),
        fetchSessionsSafe(previous.start, previous.end),
        fetchSessionsSafe(current.start, mtdEnd),
        fetchSessionsByPlatformSafe(current.start, mtdEnd),
        fetchAdMetricsByProductKeys(previous.start, previous.end),
        pool.query(
          `select product_id,
                  coalesce(sum(quantity) filter (where date between $1 and $2), 0)::float8 as prev_month_units,
                  coalesce(sum(quantity) filter (where date between $3 and $4), 0)::float8 as mtd_units
           from fact_shopify_line_items
           where date between $1 and $4
           group by product_id`,
          [previous.start, previous.end, current.start, mtdEnd]
        ),
        pool.query(`select product_id, unit_target, price from product_targets where month = $1`, [current.monthKey]),
      ]);

    const lineItemByProduct = new Map(lineItemRows.map((r) => [r.product_id as string, { prevMonthUnits: r.prev_month_units as number, mtdUnits: r.mtd_units as number }]));
    const targetsByProduct = new Map(targetRows.map((r) => [r.product_id as string, { unitTarget: r.unit_target as number | null, price: r.price as number | null }]));

    const rows: ProjectionRow[] = catalog.map((p) => {
      const target = targetsByProduct.get(p.productId);
      const unitTarget = target?.unitTarget ?? null;
      const price = target?.price ?? null;
      const targetRevenue = unitTarget != null && price != null ? unitTarget * price : null;

      const li = lineItemByProduct.get(p.productId) ?? { prevMonthUnits: 0, mtdUnits: 0 };
      const prevMonthSessions = prevSessionsByHandle.get(p.handle) ?? null;
      const mtdSessions = mtdSessionsByHandle.get(p.handle) ?? null;
      const mtdMeta = mtdSessionsByPlatform.meta.get(p.handle) ?? null;
      const mtdGoogle = mtdSessionsByPlatform.google.get(p.handle) ?? null;

      // Conventional CVR (units / sessions) -- confirmed against the
      // attached spreadsheet's own numbers, which used this direction; the
      // request text literally said "sessions / units", but that inverse
      // doesn't reproduce the spreadsheet's own Traffic Required figures.
      const previousMonthCvr = safeDivide(li.prevMonthUnits, prevMonthSessions);
      const currentMonthCvr = safeDivide(li.mtdUnits, mtdSessions);

      const requiredTraffic = unitTarget != null && previousMonthCvr != null && previousMonthCvr > 0 ? unitTarget / previousMonthCvr : null;

      const meta = adMetricsPrevMonth.metaByHandle.get(p.handle);
      const cpm = meta && meta.impressions > 0 ? (meta.spend / meta.impressions) * 1000 : null;
      const minAdSpendRequired = cpm != null && cpm > 0 && requiredTraffic != null ? (1000 / cpm) * requiredTraffic * 0.8 : null;

      const plannedDrr = unitTarget != null ? unitTarget / current.daysInMonth : null;
      const currentDrr = dayOfMonth > 0 ? li.mtdUnits / dayOfMonth : null;
      const projectedUnitsMonthEnd = currentDrr != null ? currentDrr * current.daysInMonth : null;

      const mtdTotalSessions = mtdSessions;
      const mtdRestSessions = mtdTotalSessions != null ? Math.max(0, mtdTotalSessions - (mtdMeta ?? 0) - (mtdGoogle ?? 0)) : null;
      const mtdMetaSessionsSharePct = mtdTotalSessions != null && mtdTotalSessions > 0 ? (mtdMeta ?? 0) / mtdTotalSessions : null;
      const projectedSessionsMonthEnd = mtdTotalSessions != null && dayOfMonth > 0 ? (mtdTotalSessions / dayOfMonth) * current.daysInMonth : null;

      const insight = computeInsight(currentDrr, plannedDrr, projectedSessionsMonthEnd, requiredTraffic);

      return {
        productId: p.productId,
        productHandle: p.handle,
        title: p.title,
        unitTarget,
        price,
        previousMonthUnitsSold: li.prevMonthUnits,
        shopifyPrice: p.price,
        targetRevenue,
        requiredTraffic,
        cpm,
        minAdSpendRequired,
        plannedDrr,
        currentDrr,
        projectedUnitsMonthEnd,
        mtdUnitsSold: li.mtdUnits,
        mtdTotalSessionsEarly: mtdTotalSessions,
        previousMonthCvr,
        currentMonthCvr,
        mtdMetaSessions: mtdMeta,
        mtdGoogleSessions: mtdGoogle,
        mtdRestSessions,
        mtdTotalSessions,
        mtdMetaSessionsSharePct,
        projectedSessionsMonthEnd,
        insight,
      };
    });

    const response: ProjectionResponse = { month: current.monthKey, daysInMonth: current.daysInMonth, dayOfMonth, rows };
    res.json(response);
  })
);

function isValidUpdate(u: unknown): u is ProjectionUpdateEntry {
  if (!u || typeof u !== "object") return false;
  const r = u as Record<string, unknown>;
  return typeof r.productId === "string" && (r.unitTarget === null || typeof r.unitTarget === "number") && (r.price === null || typeof r.price === "number");
}

// PATCH /projection -- body: { updates: [{productId, unitTarget, price}] },
// upserted into this month's product_targets rows. Caller (the frontend)
// re-fetches GET /projection afterward for the recomputed sheet, rather
// than this endpoint re-deriving the whole response itself.
projectionRouter.patch(
  "/",
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as { updates?: unknown };
    if (!Array.isArray(body.updates) || !body.updates.every(isValidUpdate)) {
      return res.status(400).json({ error: "updates must be an array of {productId, unitTarget: number|null, price: number|null}" });
    }

    const { current } = currentMonthInfo(todayIST());
    const pool = getPool();
    for (const u of body.updates as ProjectionUpdateEntry[]) {
      await pool.query(
        `insert into product_targets (product_id, month, unit_target, price, updated_at)
         values ($1, $2, $3, $4, now())
         on conflict (product_id, month) do update set unit_target = excluded.unit_target, price = excluded.price, updated_at = now()`,
        [u.productId, current.monthKey, u.unitTarget, u.price]
      );
    }
    res.json({ ok: true });
  })
);
