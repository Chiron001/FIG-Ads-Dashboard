import test from "node:test";
import assert from "node:assert/strict";
import { mean, median, sampleStdDev, coefficientOfVariation, reliabilityLabel, iqr, isRightSkewed } from "./descriptive";

test("mean: empty -> null", () => assert.equal(mean([]), null));
test("mean: known values", () => assert.equal(mean([2, 4, 6]), 4));

test("median: odd length", () => assert.equal(median([1, 3, 2]), 2));
test("median: even length averages the two middles", () => assert.equal(median([1, 2, 3, 4]), 2.5));
test("median: empty -> null", () => assert.equal(median([]), null));

test("sampleStdDev: n=1 -> null (no spread to measure)", () => assert.equal(sampleStdDev([5]), null));
test("sampleStdDev: n=0 -> null", () => assert.equal(sampleStdDev([]), null));
test("sampleStdDev: all-equal values -> 0", () => assert.equal(sampleStdDev([7, 7, 7, 7]), 0));
test("sampleStdDev: known-answer fixture", () => {
  // hand-calculated: mean=5, deviations [-2,-1,0,1,2], sq sum=10, /(5-1)=2.5, sqrt=1.5811...
  const sd = sampleStdDev([3, 4, 5, 6, 7]);
  assert.ok(sd !== null);
  assert.ok(Math.abs(sd! - 1.5811388) < 1e-5);
});

test("coefficientOfVariation: zero mean -> null", () => assert.equal(coefficientOfVariation([-2, 0, 2]), null));
test("coefficientOfVariation: n<2 -> null", () => assert.equal(coefficientOfVariation([5]), null));
test("coefficientOfVariation: known-answer fixture", () => {
  const cv = coefficientOfVariation([3, 4, 5, 6, 7]); // mean=5, sd=1.5811...
  assert.ok(cv !== null);
  assert.ok(Math.abs(cv! - 0.3162278) < 1e-5);
});

test("reliabilityLabel: thresholds", () => {
  assert.equal(reliabilityLabel(0.1), "Stable");
  assert.equal(reliabilityLabel(0.24), "Stable");
  assert.equal(reliabilityLabel(0.25), "Variable");
  assert.equal(reliabilityLabel(0.5), "Variable");
  assert.equal(reliabilityLabel(0.51), "Volatile");
  assert.equal(reliabilityLabel(null), null);
});

test("iqr: n<4 -> null", () => assert.equal(iqr([1, 2, 3]), null));
test("iqr: known-answer fixture", () => {
  // sorted [1,2,3,4,5,6,7,8]: Q1 (idx .25*7=1.75) = 2+.75*(3-2)=2.75, Q3 (idx 5.25)=6+.25*(7-6)=6.25
  const r = iqr([8, 1, 6, 2, 5, 3, 7, 4]);
  assert.ok(r !== null);
  assert.ok(Math.abs(r!.q1 - 2.75) < 1e-9);
  assert.ok(Math.abs(r!.q3 - 6.25) < 1e-9);
  assert.ok(Math.abs(r!.iqr - 3.5) < 1e-9);
});

test("isRightSkewed: symmetric data -> false", () => assert.equal(isRightSkewed([1, 2, 3, 4, 5]), false));
test("isRightSkewed: one big outlier pulls mean above 1.5x median -> true", () => {
  assert.equal(isRightSkewed([1, 1, 1, 1, 100]), true);
});
test("isRightSkewed: median 0 -> false (guarded, not divide-by-zero)", () => assert.equal(isRightSkewed([-1, 0, 1]), false));
