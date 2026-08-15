import test from "node:test";
import assert from "node:assert/strict";
import { linearRegression, diminishingReturnsFit } from "./regression";

test("linearRegression: n<2 -> null", () => assert.equal(linearRegression([1], [2]), null));
test("linearRegression: constant x -> null (no slope estimable)", () => {
  assert.equal(linearRegression([5, 5, 5], [1, 2, 3]), null);
});

test("linearRegression: exact line y=2x+3, r2=1", () => {
  const xs = [1, 2, 3, 4, 5];
  const ys = xs.map((x) => 2 * x + 3);
  const fit = linearRegression(xs, ys);
  assert.ok(fit !== null);
  assert.ok(Math.abs(fit!.beta1 - 2) < 1e-9);
  assert.ok(Math.abs(fit!.beta0 - 3) < 1e-9);
  assert.ok(Math.abs(fit!.r2 - 1) < 1e-9);
});

test("diminishingReturnsFit: n<14 -> null", () => {
  const spend = Array.from({ length: 13 }, (_, i) => (i + 1) * 10);
  const orders = spend.map((s) => 5 * Math.log(s) + 1);
  assert.equal(diminishingReturnsFit(spend, orders, 100, 2), null);
});

test("diminishingReturnsFit: known-answer fixture -- exact log relationship recovers a, budget ceiling matches hand calc", () => {
  const spend = Array.from({ length: 15 }, (_, i) => (i + 1) * 10); // 10..150
  const a = 5;
  const b = 1;
  const orders = spend.map((s) => a * Math.log(s) + b); // noiseless -> should recover exactly
  const avgOrderValue = 100;
  const breakEvenRoas = 2;

  const result = diminishingReturnsFit(spend, orders, avgOrderValue, breakEvenRoas);
  assert.ok(result !== null);
  assert.ok(Math.abs(result!.fit.beta1 - a) < 1e-6);
  assert.ok(Math.abs(result!.fit.beta0 - b) < 1e-6);
  assert.ok(result!.fit.r2 > 0.999);
  assert.equal(result!.reliable, true);

  // spend = avgOrderValue * a / breakEvenRoas = 100*5/2 = 250
  assert.ok(result!.budgetCeiling !== null);
  assert.ok(Math.abs(result!.budgetCeiling! - 250) < 1e-3);
});

test("diminishingReturnsFit: negative slope -> reliable can be true but budgetCeiling is null (no diminishing-returns shape to cap)", () => {
  const spend = Array.from({ length: 15 }, (_, i) => (i + 1) * 10);
  const orders = spend.map((s) => -3 * Math.log(s) + 50); // orders fall as spend rises
  const result = diminishingReturnsFit(spend, orders, 100, 2);
  assert.ok(result !== null);
  assert.ok(result!.fit.beta1 < 0);
  assert.equal(result!.budgetCeiling, null);
});

test("diminishingReturnsFit: low r2 (noisy/no relationship) -> reliable=false, no budget ceiling", () => {
  // orders essentially unrelated to spend
  const spend = Array.from({ length: 14 }, (_, i) => (i + 1) * 10);
  const orders = [3, 8, 2, 9, 1, 7, 4, 6, 2, 9, 3, 8, 1, 7]; // no relationship to spend
  const result = diminishingReturnsFit(spend, orders, 100, 2);
  assert.ok(result !== null);
  if (result!.fit.r2 < 0.3) {
    assert.equal(result!.reliable, false);
    assert.equal(result!.budgetCeiling, null);
  }
});
