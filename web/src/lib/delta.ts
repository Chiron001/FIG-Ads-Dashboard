/** % change vs a comparison value; null (not undefined) when the
 * comparison itself is undefined/zero, which callers render as "—"/"N/A"
 * rather than a misleading 0%. Shared by every section comparison mode
 * now touches (KPI tiles, campaign/product tables, Pareto summaries). */
export function computeDelta(current: number | null | undefined, prior: number | null | undefined): number | null {
  if (current == null || prior == null || prior === 0) return null;
  return (current - prior) / prior;
}
