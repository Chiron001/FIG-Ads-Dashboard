// en-IN gives Indian digit grouping (12,34,567) and, in compact mode,
// Lakh/Crore units (12.3L, 1.2Cr) — the right convention for an Indian
// internal tool, not a Western "1.2M".

const currencyFull = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const currencyCompact = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  notation: "compact",
  maximumFractionDigits: 1,
});

const numberFull = new Intl.NumberFormat("en-IN");

const numberCompact = new Intl.NumberFormat("en-IN", {
  notation: "compact",
  maximumFractionDigits: 1,
});

// CPM/unit-economics figures (Projection Sheet) need real precision --
// formatCurrency's 0dp rounds a ₹56.17 CPM down to "₹56", which is
// misleading at that scale. Same en-IN grouping, just 2dp kept.
const currencyPrecise = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// Fractional units (DRR, e.g. "4.8 units/day") -- a plain number formatter
// with a fixed 1dp, unlike formatNumber's 0dp default.
const numberOneDecimal = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** "N/A" for null/undefined/NaN rather than a misleading 0 or "NaN" -- matches
 * computeDerivedMetrics' null-on-zero-denominator contract. Deliberately not
 * an em dash: reads as a written report, not a generated table. */
const EMPTY = "N/A";

export function formatCurrency(value: number | null | undefined, compact = false): string {
  if (value == null || Number.isNaN(value)) return EMPTY;
  return (compact ? currencyCompact : currencyFull).format(value);
}

export function formatNumber(value: number | null | undefined, compact = false): string {
  if (value == null || Number.isNaN(value)) return EMPTY;
  return (compact ? numberCompact : numberFull).format(value);
}

export function formatCurrencyPrecise(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return EMPTY;
  return currencyPrecise.format(value);
}

export function formatNumberOneDecimal(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return EMPTY;
  return numberOneDecimal.format(value);
}

/** decimals: CTR/CVR/ACOS use 2dp; % of Spend/Revenue use 1dp per the
 * campaign-table column spec. */
export function formatPercent(value: number | null | undefined, decimals = 2): string {
  if (value == null || Number.isNaN(value)) return EMPTY;
  return new Intl.NumberFormat("en-IN", {
    style: "percent",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/** Spend–Rev Delta: a *difference between two percentages*, in percentage
 * points, not a percentage itself -- "pp" suffix disambiguates from "%",
 * signed so + / - reads at a glance. */
export function formatPercentagePoints(value: number | null | undefined, decimals = 1): string {
  if (value == null || Number.isNaN(value)) return EMPTY;
  const pct = value * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(decimals)}pp`;
}

/** ROAS Δ WoW: signed % with a direction arrow. */
export function formatSignedPercentWithArrow(value: number | null | undefined, decimals = 1): string {
  if (value == null || Number.isNaN(value)) return EMPTY;
  const pct = value * 100;
  const arrow = pct > 0 ? "▲" : pct < 0 ? "▼" : "";
  const sign = pct > 0 ? "+" : "";
  return `${arrow} ${sign}${pct.toFixed(decimals)}%`.trim();
}

/** ROAS reads better as "4.2x" than "420%". */
export function formatMultiplier(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return EMPTY;
  return `${value.toFixed(2)}x`;
}

export function formatDateLabel(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
