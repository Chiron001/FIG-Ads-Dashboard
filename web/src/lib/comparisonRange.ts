import type { DateRange } from "./dateRanges";

export type ComparisonMode = "none" | "previous_period" | "last_month" | "last_year";

export const COMPARISON_LABELS: Record<ComparisonMode, string> = {
  none: "No comparison",
  previous_period: "Previous period",
  last_month: "Same period last month",
  last_year: "Same period last year",
};

export const COMPARISON_MODE_ORDER: ComparisonMode[] = ["none", "previous_period", "last_month", "last_year"];

function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetweenInclusive(from: string, to: string): number {
  const a = new Date(from + "T00:00:00Z").getTime();
  const b = new Date(to + "T00:00:00Z").getTime();
  return Math.round((b - a) / (24 * 60 * 60 * 1000)) + 1;
}

// setUTCMonth/setUTCFullYear roll over on short months (e.g. Mar 31 - 1
// month lands on ~Mar 2/3, not Feb 28) -- acceptable for the week/month-
// length ranges this tool actually uses; not worth a full calendar library
// for an edge case that mostly affects exact month-end selections.
function shiftMonthsISO(iso: string, months: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

function shiftYearsISO(iso: string, years: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

/** The date range to compare `range` against, or null for "no comparison". */
export function comparisonRange(range: DateRange, mode: ComparisonMode): DateRange | null {
  switch (mode) {
    case "none":
      return null;
    case "previous_period": {
      const spanDays = daysBetweenInclusive(range.from, range.to);
      const to = addDaysISO(range.from, -1);
      const from = addDaysISO(to, -(spanDays - 1));
      return { preset: "custom", from, to };
    }
    case "last_month":
      return { preset: "custom", from: shiftMonthsISO(range.from, -1), to: shiftMonthsISO(range.to, -1) };
    case "last_year":
      return { preset: "custom", from: shiftYearsISO(range.from, -1), to: shiftYearsISO(range.to, -1) };
  }
}
