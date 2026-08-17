// Per-product "Performance" analysis for the Shopify Products table --
// always compares the current row against the immediately-adjacent
// previous period (same length, right before the selected range; the
// "previous_period" comparisonRange helper), independent of whatever
// comparison the top bar's "Compare to" is set to. Rule-based, not an AI
// call -- same philosophy as the Projection Sheet's Insight column: a
// deterministic decision tree over real deltas, so the same inputs always
// produce the same read and every claim traces back to a formula shown in
// the drawer, never a black box.
import type { ShopifyProductRow } from "@fig/shared";
import { computeDelta } from "./delta";
import { formatCurrency, formatMultiplier, formatNumber, formatPercent } from "./format";

export type ProductInsightVerdict =
  | "no_prior_data"
  | "stable"
  | "growing_efficient"
  | "growing_less_efficient"
  | "declining_traffic"
  | "declining_conversion"
  | "declining_efficiency";

export interface ProductInsight {
  verdict: ProductInsightVerdict;
  label: string;
  tone: "good" | "warning" | "critical" | "neutral";
  /** One-sentence summary, shown at the top of the detail drawer. */
  headline: string;
  /** Supporting analytical findings, most significant first -- only
   * includes a bullet when the underlying signal clears a minimum
   * significance/volume bar, so a near-zero-traffic product doesn't get a
   * page of noise about "500% CVR swings" on 1 session. */
  bullets: string[];
  /** Every metric this insight drew from, current vs. previous + delta --
   * the "show your work" table the drawer renders below the bullets. */
  metrics: { label: string; current: string; previous: string; delta: number | null }[];
}

export const INSIGHT_META: Record<ProductInsightVerdict, { label: string; tone: ProductInsight["tone"]; color: string }> = {
  no_prior_data: { label: "No Prior Data", tone: "neutral", color: "#818794" },
  stable: { label: "Stable", tone: "neutral", color: "#818794" },
  growing_efficient: { label: "Growing — Efficient", tone: "good", color: "#4ade80" },
  growing_less_efficient: { label: "Growing — Costlier", tone: "warning", color: "#e5a94e" },
  declining_traffic: { label: "Declining — Traffic", tone: "critical", color: "#f26d6d" },
  declining_conversion: { label: "Declining — Conversion", tone: "warning", color: "#e5a94e" },
  declining_efficiency: { label: "Declining — Efficiency", tone: "critical", color: "#f26d6d" },
};

const REVENUE_FLAT_BAND = 0.05;
const DEFAULT_THRESHOLD = 0.1;

function classify(delta: number | null, threshold = DEFAULT_THRESHOLD): "up" | "down" | "flat" | "unknown" {
  if (delta == null) return "unknown";
  if (delta > threshold) return "up";
  if (delta < -threshold) return "down";
  return "flat";
}

function directionWord(delta: number | null): string {
  if (delta == null) return "is unreadable (no prior baseline)";
  if (delta > 0) return "grew";
  if (delta < 0) return "fell";
  return "held flat";
}

function pctText(delta: number | null): string {
  if (delta == null) return "";
  return formatPercent(Math.abs(delta), 1);
}

/** "{label} grew 12.3%" / "{label} held steady" / "{label} isn't
 * comparable (no prior baseline)" -- one safe phrase-builder for every
 * delta-based clause below, so a null delta (computeDelta's contract: no
 * prior value OR prior was exactly 0) never falls through into
 * directionWord's raw "is unreadable" text glued to a stray blank
 * percentage. */
function trendPhrase(delta: number | null, label: string, threshold = DEFAULT_THRESHOLD): string {
  if (delta == null) return `${label} isn't comparable (no prior baseline)`;
  if (classify(delta, threshold) === "flat") return `${label} held steady`;
  return `${label} ${directionWord(delta)} ${pctText(delta)}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function computeProductInsight(current: ShopifyProductRow, previous: ShopifyProductRow | null): ProductInsight {
  const metricsTable = [
    { label: "Revenue", current: formatCurrency(current.revenue), previous: previous ? formatCurrency(previous.revenue) : "N/A", delta: previous ? computeDelta(current.revenue, previous.revenue) : null },
    { label: "Units Sold", current: formatNumber(current.unitsSold), previous: previous ? formatNumber(previous.unitsSold) : "N/A", delta: previous ? computeDelta(current.unitsSold, previous.unitsSold) : null },
    { label: "Sessions", current: formatNumber(current.sessions), previous: previous ? formatNumber(previous.sessions) : "N/A", delta: previous ? computeDelta(current.sessions, previous.sessions) : null },
    { label: "CVR", current: formatPercent(current.cvr), previous: previous ? formatPercent(previous.cvr) : "N/A", delta: previous ? computeDelta(current.cvr, previous.cvr) : null },
    { label: "Ad Spend", current: formatCurrency(current.adSpend), previous: previous ? formatCurrency(previous.adSpend) : "N/A", delta: previous ? computeDelta(current.adSpend, previous.adSpend) : null },
    { label: "ROAS", current: formatMultiplier(current.roas), previous: previous ? formatMultiplier(previous.roas) : "N/A", delta: previous ? computeDelta(current.roas, previous.roas) : null },
    { label: "POAS", current: formatMultiplier(current.poas), previous: previous ? formatMultiplier(previous.poas) : "N/A", delta: previous ? computeDelta(current.poas, previous.poas) : null },
    { label: "ATC", current: formatNumber(current.atc), previous: previous ? formatNumber(previous.atc) : "N/A", delta: previous ? computeDelta(current.atc, previous.atc) : null },
    { label: "Bounce Rate", current: formatPercent(current.bounceRate), previous: previous ? formatPercent(previous.bounceRate) : "N/A", delta: previous ? computeDelta(current.bounceRate, previous.bounceRate) : null },
    { label: "Google Sessions", current: formatNumber(current.googleSessions), previous: previous ? formatNumber(previous.googleSessions) : "N/A", delta: previous ? computeDelta(current.googleSessions, previous.googleSessions) : null },
    { label: "Meta Sessions", current: formatNumber(current.metaSessions), previous: previous ? formatNumber(previous.metaSessions) : "N/A", delta: previous ? computeDelta(current.metaSessions, previous.metaSessions) : null },
  ];

  const hadPriorActivity = previous && ((previous.sessions ?? 0) > 0 || previous.revenue > 0 || previous.unitsSold > 0);
  if (!hadPriorActivity) {
    return {
      verdict: "no_prior_data",
      label: INSIGHT_META.no_prior_data.label,
      tone: "neutral",
      headline: "No comparable activity in the previous period -- can't establish a trend yet.",
      bullets:
        current.revenue > 0
          ? [`This period: ${formatCurrency(current.revenue)} revenue from ${formatNumber(current.unitsSold)} units and ${formatNumber(current.sessions)} sessions.`]
          : ["No sessions or sales recorded in either period."],
      metrics: metricsTable,
    };
  }

  const revenueDelta = computeDelta(current.revenue, previous!.revenue);
  const unitsDelta = computeDelta(current.unitsSold, previous!.unitsSold);
  const sessionsDelta = computeDelta(current.sessions, previous!.sessions);
  const cvrDelta = computeDelta(current.cvr, previous!.cvr);
  const adSpendDelta = computeDelta(current.adSpend, previous!.adSpend);
  // ROAS preferred (revenue-based, always computable when there's any
  // spend); falls back to POAS if ROAS itself is null for some reason --
  // the two move together since POAS is just ROAS x a fixed margin.
  const efficiencyDelta = current.roas != null || previous!.roas != null ? computeDelta(current.roas, previous!.roas) : computeDelta(current.poas, previous!.poas);
  const bounceDelta = computeDelta(current.bounceRate, previous!.bounceRate);
  const atcDelta = computeDelta(current.atc, previous!.atc);

  const revenueTrend = classify(revenueDelta, REVENUE_FLAT_BAND);
  const sessionsTrend = classify(sessionsDelta);
  const cvrTrend = classify(cvrDelta);
  const efficiencyTrend = classify(efficiencyDelta);
  const spendGrew = current.adSpend > (previous!.adSpend ?? 0) * 1.1;

  let verdict: ProductInsightVerdict;
  if (revenueTrend === "flat") {
    verdict = "stable";
  } else if (revenueTrend === "up") {
    verdict = efficiencyTrend === "down" ? "growing_less_efficient" : "growing_efficient";
  } else {
    // revenueTrend === "down"
    if (spendGrew && efficiencyTrend === "down") {
      verdict = "declining_efficiency"; // spent more, got less back -- the worst case
    } else if (sessionsTrend === "down" && Math.abs(sessionsDelta ?? 0) >= Math.abs(cvrDelta ?? 0)) {
      verdict = "declining_traffic";
    } else if (cvrTrend === "down") {
      verdict = "declining_conversion";
    } else {
      verdict = "declining_efficiency"; // catch-all -- e.g. a price/AOV shift with volume roughly flat
    }
  }

  const bullets: string[] = [];

  bullets.push(`${capitalize(trendPhrase(revenueDelta, "revenue"))} (${formatCurrency(previous!.revenue)} → ${formatCurrency(current.revenue)}).`);

  if (sessionsTrend !== "flat" || cvrTrend !== "flat") {
    bullets.push(`${capitalize(trendPhrase(unitsDelta, "units"))} -- ${trendPhrase(sessionsDelta, "sessions")}, ${trendPhrase(cvrDelta, "CVR")}.`);
  }

  // Channel driver -- compares the raw session-count swing (not %, which is
  // noisy on a small base) between Google and Meta to name whichever moved
  // more, only when that move is large enough to matter (>=3 sessions).
  if (sessionsTrend !== "flat") {
    const metaSwing = (current.metaSessions ?? 0) - (previous!.metaSessions ?? 0);
    const googleSwing = (current.googleSessions ?? 0) - (previous!.googleSessions ?? 0);
    if (Math.abs(metaSwing) >= 3 && Math.abs(metaSwing) >= Math.abs(googleSwing)) {
      bullets.push(`Meta sessions ${metaSwing >= 0 ? "grew" : "fell"} by ${formatNumber(Math.abs(metaSwing))} -- the main driver of the traffic change.`);
    } else if (Math.abs(googleSwing) >= 3) {
      bullets.push(`Google sessions ${googleSwing >= 0 ? "grew" : "fell"} by ${formatNumber(Math.abs(googleSwing))} -- the main driver of the traffic change.`);
    }
  }

  if (current.adSpend > 0 || (previous!.adSpend ?? 0) > 0) {
    let spendPart: string;
    if ((previous!.adSpend ?? 0) === 0 && current.adSpend > 0) {
      spendPart = `Ad spend is new this period (started at ${formatCurrency(current.adSpend)})`;
    } else if (previous!.adSpend > 0 && current.adSpend === 0) {
      spendPart = `Ad spend stopped this period (was ${formatCurrency(previous!.adSpend)})`;
    } else {
      spendPart = `${capitalize(trendPhrase(adSpendDelta, "ad spend"))} (${formatCurrency(previous!.adSpend)} → ${formatCurrency(current.adSpend)})`;
    }
    const roasPart = efficiencyDelta != null ? `, ROAS ${directionWord(efficiencyDelta)} ${pctText(efficiencyDelta)}` : "";
    bullets.push(`${spendPart}${roasPart}.`);
  }

  if (bounceDelta != null && classify(bounceDelta, 0.1) !== "flat" && (current.sessions ?? 0) >= 20 && (previous!.sessions ?? 0) >= 20) {
    bullets.push(`Bounce rate ${directionWord(bounceDelta)} ${pctText(bounceDelta)} -- ${bounceDelta > 0 ? "landing experience may be turning visitors away faster" : "landing engagement improved"}.`);
  }

  if (atcDelta != null && classify(atcDelta, 0.15) !== "flat" && (current.atc ?? 0) >= 3) {
    bullets.push(`Add-to-cart ${directionWord(atcDelta)} ${pctText(atcDelta)}.`);
  }

  const HEADLINES: Record<Exclude<ProductInsightVerdict, "no_prior_data">, string> = {
    stable: "Holding steady vs. the previous period -- no significant swing on revenue.",
    growing_efficient: "Growing, and efficiently -- revenue is up without a matching drop in ROAS.",
    growing_less_efficient: "Growing, but costlier -- revenue is up, though it's costing more per rupee of spend to get there.",
    declining_traffic: "Declining, driven by traffic -- fewer sessions is the main story here.",
    declining_conversion: "Declining, driven by conversion -- traffic held up but fewer visitors are buying.",
    declining_efficiency: "Declining on efficiency -- spend isn't converting to revenue the way it did last period.",
  };

  return {
    verdict,
    label: INSIGHT_META[verdict].label,
    tone: INSIGHT_META[verdict].tone,
    headline: HEADLINES[verdict],
    bullets,
    metrics: metricsTable,
  };
}
