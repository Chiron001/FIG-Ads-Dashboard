import test from "node:test";
import assert from "node:assert/strict";
import { iqrOutliers, zScoreOutliers } from "./outliers";

test("iqrOutliers: n<8 -> no flags even with an obvious outlier", () => {
  const flags = iqrOutliers([1, 2, 3, 100], (v) => v);
  assert.equal(flags.length, 0);
});

test("iqrOutliers: single clear high outlier in n=8 is flagged", () => {
  const values = [10, 11, 9, 10, 12, 9, 11, 100];
  const flags = iqrOutliers(values, (v) => v);
  assert.equal(flags.length, 1);
  assert.equal(flags[0].value, 100);
  assert.equal(flags[0].direction, "high");
  assert.ok(flags[0].fenceDistance > 0);
});

test("iqrOutliers: all-equal values -> no flags (zero IQR, nothing exceeds it)", () => {
  const flags = iqrOutliers([5, 5, 5, 5, 5, 5, 5, 5], (v) => v);
  assert.equal(flags.length, 0);
});

test("zScoreOutliers: single outlier flagged, |z|>2", () => {
  const values = [10, 11, 9, 10, 12, 9, 11, 100];
  const flags = zScoreOutliers(values, (v) => v);
  assert.equal(flags.length, 1);
  assert.equal(flags[0].value, 100);
});

test("zScoreOutliers: zero stddev (all-equal) -> no flags, not NaN/Infinity", () => {
  const flags = zScoreOutliers([5, 5, 5, 5], (v) => v);
  assert.equal(flags.length, 0);
});
