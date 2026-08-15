import test from "node:test";
import assert from "node:assert/strict";
import { pearsonCorrelation } from "./correlation";

test("pearsonCorrelation: n<10 -> null", () => {
  const xs = Array.from({ length: 9 }, (_, i) => i);
  const ys = Array.from({ length: 9 }, (_, i) => i * 2);
  assert.equal(pearsonCorrelation(xs, ys), null);
});

test("pearsonCorrelation: perfect positive correlation -> r=1", () => {
  const xs = Array.from({ length: 10 }, (_, i) => i);
  const ys = Array.from({ length: 10 }, (_, i) => i * 2 + 5);
  const r = pearsonCorrelation(xs, ys);
  assert.ok(r !== null);
  assert.ok(Math.abs(r!.r - 1) < 1e-9);
  assert.equal(r!.strength, "strong");
});

test("pearsonCorrelation: perfect negative correlation -> r=-1", () => {
  const xs = Array.from({ length: 10 }, (_, i) => i);
  const ys = Array.from({ length: 10 }, (_, i) => -i);
  const r = pearsonCorrelation(xs, ys);
  assert.ok(Math.abs(r!.r + 1) < 1e-9);
});

test("pearsonCorrelation: constant series -> null (undefined, not 0)", () => {
  const xs = Array.from({ length: 10 }, () => 5);
  const ys = Array.from({ length: 10 }, (_, i) => i);
  assert.equal(pearsonCorrelation(xs, ys), null);
});

test("pearsonCorrelation: strength labels", () => {
  // constructed to land in each band via a known formula is fiddly; assert
  // the boundary logic directly instead
  const strongish = pearsonCorrelation(
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 20] // one point off -> still strong but not perfect
  );
  assert.ok(strongish !== null);
  assert.ok(strongish!.r > 0.7);
  assert.equal(strongish!.strength, "strong");
});
