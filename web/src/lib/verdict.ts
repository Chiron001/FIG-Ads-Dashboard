import type { CampaignRow } from "@fig/shared";
import { normalizeStatus } from "./campaignStatus";

export type VerdictTag = "Fix Tracking" | "Paused" | "No Data" | "Cut" | "Scale" | "Maintain" | "Optimize CVR" | "Review";

export interface Verdict {
  tag: VerdictTag;
  tone: "critical" | "good" | "warning" | "muted" | "neutral";
  /** Scale gets a solid/filled badge ("bright green") vs Maintain's tinted one -- same tone, different weight, per spec §3. */
  emphasis?: boolean;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Medians of CTR/CVR computed once over the current visible/filtered row
 * set (§2/§3: "compute medians over filtered set") -- call once per
 * render with the filtered array, reuse the result across verdictFor()
 * calls for that same array rather than recomputing per row. */
export function computeMedians(rows: CampaignRow[]) {
  return {
    medianCtr: median(rows.map((r) => r.ctr).filter((v): v is number => v != null)),
    medianCvr: median(rows.map((r) => r.cvr).filter((v): v is number => v != null)),
  };
}

/** Rules evaluated top-down; first match wins -- see spec §3. */
export function verdictFor(
  row: CampaignRow,
  targetRoas: number,
  breakEvenRoas: number,
  medians: { medianCtr: number | null; medianCvr: number | null }
): Verdict {
  if (row.spend > 0 && row.conversions === 0) {
    return { tag: "Fix Tracking", tone: "muted" };
  }
  if (normalizeStatus(row.status).label === "Paused") {
    return { tag: "Paused", tone: "muted" };
  }
  if (row.roas == null || row.spend === 0) {
    return { tag: "No Data", tone: "muted" };
  }
  if (row.roas < breakEvenRoas) {
    return { tag: "Cut", tone: "critical" };
  }

  const lostBudgetIS = row.searchBudgetLostImpressionShare;
  if (row.roas >= targetRoas && lostBudgetIS != null && lostBudgetIS > 0.1) {
    return { tag: "Scale", tone: "good", emphasis: true };
  }
  if (row.roas >= targetRoas) {
    return { tag: "Maintain", tone: "good" };
  }

  const ctrHealthy = row.ctr != null && medians.medianCtr != null && row.ctr >= medians.medianCtr;
  const cvrLow = row.cvr != null && medians.medianCvr != null && row.cvr < medians.medianCvr;
  if (ctrHealthy && cvrLow) {
    return { tag: "Optimize CVR", tone: "warning" };
  }

  return { tag: "Review", tone: "neutral" };
}
