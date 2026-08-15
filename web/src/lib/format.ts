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

const percent = new Intl.NumberFormat("en-IN", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 2,
});

/** "—" for null/undefined/NaN rather than a misleading 0 or "NaN" — matches
 * computeDerivedMetrics' null-on-zero-denominator contract. */
const EMPTY = "—";

export function formatCurrency(value: number | null | undefined, compact = false): string {
  if (value == null || Number.isNaN(value)) return EMPTY;
  return (compact ? currencyCompact : currencyFull).format(value);
}

export function formatNumber(value: number | null | undefined, compact = false): string {
  if (value == null || Number.isNaN(value)) return EMPTY;
  return (compact ? numberCompact : numberFull).format(value);
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return EMPTY;
  return percent.format(value);
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
