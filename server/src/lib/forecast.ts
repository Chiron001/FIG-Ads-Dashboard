import { movingAverage, linearRegression } from "../stats";
import type { ForecastModel } from "@fig/shared";

export interface DailyPoint {
  date: string; // YYYY-MM-DD, ascending, no gaps -- caller fills zero-days
  value: number;
}

export interface ForecastPoint {
  forecastDate: string;
  predictedValue: number;
  ciLow: number | null;
  ciHigh: number | null;
  modelUsed: ForecastModel;
  r2: number | null;
  isReliable: boolean;
}

const RELIABILITY_R2_FLOOR = 0.3; // same floor as the ads diminishing-returns model (server/src/stats/regression.ts)
const MA_WINDOW = 7;

/**
 * Forward daily forecast, `horizonDays` points, from a real daily history
 * series. Baseline is always the 7-day moving average (a flat forecast) --
 * upgraded to a linear-regression trend line ONLY when r2 >= 0.3 on the
 * full history. Confirmed against 97 days of real Shopify order history
 * before this was written: the naive trend line lost the backtest to the
 * flat baseline (r2=0.036, 19.4% MAPE vs. the flat baseline's 16.9%) -- this
 * function is what enforces that lesson for every series it's given, not
 * just a one-off finding (see PredictiveAnalysisResponse's header comment
 * in shared/src/index.ts for the full validation).
 *
 * Confidence interval is the point estimate +/- 1 historical std-dev -- a
 * simple, honest band communicating "how noisy has this series actually
 * been", not a formal statistical prediction interval (this codebase's
 * other confidence figures, e.g. wilsonInterval, are similarly simple by
 * design rather than black-box).
 *
 * `startDate` is the first forecast date, passed in by the caller (a
 * shared "tomorrow" for every series in a given forecast run) rather than
 * derived from this series' own last history date -- ad spend and Shopify
 * order data don't always sync through the exact same calendar day, and
 * anchoring each series independently would misalign their forecast dates
 * by however many days their histories happen to differ, breaking the
 * combined chart/table's date join. The regression's own extrapolation
 * math (`lastIndex + h`) still counts forward from THIS series' real point
 * count -- only the calendar label is shared, not the fit.
 */
export function forecastDailySeries(history: DailyPoint[], horizonDays: number, startDate: string): ForecastPoint[] {
  if (history.length === 0) return [];
  const values = history.map((h) => h.value);

  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const std = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);

  const maSeries = movingAverage(values, Math.min(MA_WINDOW, values.length));
  const maValue = maSeries[maSeries.length - 1] ?? mean;

  const xs = values.map((_, i) => i);
  const fit = values.length >= 2 ? linearRegression(xs, values) : null;
  const isReliable = fit != null && fit.r2 >= RELIABILITY_R2_FLOOR;
  const modelUsed: ForecastModel = isReliable ? "linear_regression" : "moving_average_7d";

  // Days between this series' own last history point and the shared start
  // date -- usually 1 (history ends "yesterday", forecast starts
  // "tomorrow" relative to today), but can differ if this series' sync is
  // stale relative to the others.
  const lastHistoryDate = new Date(history[history.length - 1].date + "T00:00:00Z");
  const sharedStart = new Date(startDate + "T00:00:00Z");
  const dayOffset = Math.round((sharedStart.getTime() - lastHistoryDate.getTime()) / 86400000);

  const lastIndex = values.length - 1;
  const points: ForecastPoint[] = [];

  for (let h = 0; h < horizonDays; h++) {
    const stepsFromHistory = dayOffset + h;
    const predicted = isReliable && fit ? Math.max(0, fit.beta0 + fit.beta1 * (lastIndex + stepsFromHistory)) : maValue;
    const d = new Date(sharedStart);
    d.setUTCDate(d.getUTCDate() + h);
    points.push({
      forecastDate: d.toISOString().slice(0, 10),
      predictedValue: predicted,
      ciLow: Math.max(0, predicted - std),
      ciHigh: predicted + std,
      modelUsed,
      r2: fit?.r2 ?? null,
      isReliable,
    });
  }
  return points;
}

/** Fills any missing calendar dates in a (date, value) series with 0 -- a
 * real gap (no orders/spend that day) must count as 0, not be silently
 * skipped, or trend/regression math is quietly biased toward whatever days
 * happen to have rows. No-op on an empty input. */
export function fillDailyGaps(rows: { date: string; value: number }[]): DailyPoint[] {
  if (rows.length === 0) return [];
  const byDate = new Map(rows.map((r) => [r.date, r.value]));
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const start = new Date(sorted[0].date + "T00:00:00Z");
  const end = new Date(sorted[sorted.length - 1].date + "T00:00:00Z");
  const filled: DailyPoint[] = [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    filled.push({ date: iso, value: byDate.get(iso) ?? 0 });
  }
  return filled;
}
