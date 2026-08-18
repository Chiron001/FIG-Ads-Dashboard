import test from "node:test";
import assert from "node:assert/strict";
import { paretoAnalysis, contributionRanking, marginalRoas } from "./concentration";

test("paretoAnalysis: known-answer fixture", () => {
  const campaigns = [
    { campaignId: "a", campaignName: "A", revenue: 50, spend: 10 },
    { campaignId: "b", campaignName: "B", revenue: 20, spend: 5 },
    { campaignId: "c", campaignName: "C", revenue: 15, spend: 5 },
    { campaignId: "d", campaignName: "D", revenue: 10, spend: 2 },
    { campaignId: "e", campaignName: "E", revenue: 5, spend: 1 },
  ];
  // cumulative %: 50, 70, 85, 95, 100 -- crosses 80% at the 3rd campaign
  const result = paretoAnalysis(campaigns);
  assert.equal(result.campaignsToEightyPercent, 3);
  assert.equal(result.totalCampaigns, 5);
  assert.ok(Math.abs(result.points[0].cumulativePct - 0.5) < 1e-9);
  assert.ok(Math.abs(result.points[2].cumulativePct - 0.85) < 1e-9);
});

test("paretoAnalysis: zero total revenue -> 0% throughout, not NaN", () => {
  const campaigns = [
    { campaignId: "a", campaignName: "A", revenue: 0, spend: 0 },
    { campaignId: "b", campaignName: "B", revenue: 0, spend: 0 },
  ];
  const result = paretoAnalysis(campaigns);
  assert.ok(result.points.every((p) => p.cumulativePct === 0));
});

test("contributionRanking: ranks by absolute profit, not ROAS", () => {
  const campaigns = [
    { campaignId: "a", campaignName: "A", revenue: 1000, spend: 300 }, // contribution = 500-300=200
    { campaignId: "b", campaignName: "B", revenue: 500, spend: 100 }, // 250-100=150
    { campaignId: "c", campaignName: "C", revenue: 2000, spend: 1900 }, // 1000-1900=-900
  ];
  const ranked = contributionRanking(campaigns, 0.5);
  assert.deepEqual(
    ranked.map((r) => r.campaignId),
    ["a", "b", "c"]
  );
  assert.equal(ranked[0].contribution, 200);
  assert.equal(ranked[2].contribution, -900);
});

test("contributionRanking: zero-total portfolio -> pctOfTotal null, not divide-by-zero", () => {
  const campaigns = [
    { campaignId: "a", campaignName: "A", revenue: 300, spend: 50 }, // 150-50=100
    { campaignId: "b", campaignName: "B", revenue: 100, spend: 150 }, // 50-150=-100
  ];
  const ranked = contributionRanking(campaigns, 0.5);
  assert.equal(
    ranked.reduce((s, r) => s + r.contribution, 0),
    0
  );
  assert.ok(ranked.every((r) => r.pctOfTotal === null));
});

test("marginalRoas: spend fell -> null (marginal analysis assumes added spend)", () => {
  assert.equal(marginalRoas(1000, 100, 800, 150), null);
});

test("marginalRoas: spend unchanged -> null", () => {
  assert.equal(marginalRoas(1000, 100, 800, 100), null);
});

test("marginalRoas: known-answer fixture", () => {
  // deltaRevenue=200, deltaSpend=50 -> 4.0
  assert.equal(marginalRoas(1000, 200, 800, 150), 4);
});
