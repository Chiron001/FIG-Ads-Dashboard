import { test } from "node:test";
import assert from "node:assert/strict";
import { computeReconciliation } from "./reconciliation";

test("computeReconciliation: exact match -> zero deviation, within tolerance", () => {
  const r = computeReconciliation(10000, 10000, 0.05);
  assert.equal(r.deviationPct, 0);
  assert.equal(r.withinTolerance, true);
});

test("computeReconciliation: small deviation within the 5% product tolerance", () => {
  const r = computeReconciliation(9600, 10000, 0.05); // 4% under (unattributed item-level spend)
  assert.ok(r.deviationPct != null && Math.abs(r.deviationPct - 0.04) < 1e-9);
  assert.equal(r.withinTolerance, true);
});

test("computeReconciliation: deviation just outside tolerance is flagged", () => {
  const r = computeReconciliation(9000, 10000, 0.05); // 10% under
  assert.equal(r.withinTolerance, false);
});

test("computeReconciliation: campaignSpend=0 -> deviationPct null, not divide-by-zero, and not flagged", () => {
  const r = computeReconciliation(500, 0, 0.05);
  assert.equal(r.deviationPct, null);
  assert.equal(r.withinTolerance, true);
});

// The core guardrail from spec §6: "a unit test that would FAIL if
// product+ad+campaign spend were ever added together." Simulate exactly
// that bug -- comparing a grain sum that has been double-counted (grain +
// campaign, as if summed across grains) against the true campaign total --
// and assert the reconciliation check catches it as wildly out of
// tolerance rather than passing it through.
test("computeReconciliation: cross-grain double-count (grain summed with campaign) is caught, not silently accepted", () => {
  const campaignSpend = 10000;
  const grainSpend = 10000; // a correct, un-double-counted product-grain total
  const buggyDoubleCountedSpend = grainSpend + campaignSpend; // the bug this guards against

  const correct = computeReconciliation(grainSpend, campaignSpend, 0.05);
  assert.equal(correct.withinTolerance, true);

  const buggy = computeReconciliation(buggyDoubleCountedSpend, campaignSpend, 0.05);
  assert.ok(buggy.deviationPct != null && buggy.deviationPct >= 0.99); // ~100% over
  assert.equal(buggy.withinTolerance, false);
});
