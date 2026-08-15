import type { StatsConfidence } from "@fig/shared";
import { formatPercent } from "./format";

export const CONFIDENCE_LABELS: Record<StatsConfidence, string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
  insufficient: "Not enough data",
};

export const CONFIDENCE_TONE: Record<StatsConfidence, "good" | "warning" | "critical" | "muted"> = {
  high: "good",
  medium: "warning",
  low: "warning",
  insufficient: "muted",
};

/** CI on CVR rendered as "p% [low–high]" (spec §3a) -- "—" when confidence
 * is insufficient, per the global rule (spec §0/§8): never show an
 * inferential number the sample size can't support. */
export function formatCVRWithCI(cvr: number | null | undefined, ci: { low: number; high: number; confidence: StatsConfidence } | null): string {
  if (ci == null || ci.confidence === "insufficient") return "—";
  return `${formatPercent(cvr)} [${formatPercent(ci.low)}–${formatPercent(ci.high)}]`;
}

export function formatBudgetCeiling(value: number | null | undefined): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);
}
