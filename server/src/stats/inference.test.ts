import test from "node:test";
import assert from "node:assert/strict";
import { confidenceFromClicks, wilsonInterval, twoProportionZTest } from "./inference";

test("confidenceFromClicks: boundary thresholds", () => {
  assert.equal(confidenceFromClicks(1000), "high");
  assert.equal(confidenceFromClicks(999), "medium");
  assert.equal(confidenceFromClicks(300), "medium");
  assert.equal(confidenceFromClicks(299), "low");
  assert.equal(confidenceFromClicks(100), "low");
  assert.equal(confidenceFromClicks(99), "insufficient");
  assert.equal(confidenceFromClicks(0), "insufficient");
});

test("wilsonInterval: n<1 -> null", () => assert.equal(wilsonInterval(0, 0), null));

test("wilsonInterval: known-answer fixture (p=0.5, n=100)", () => {
  // Hand-calculated Wilson 95% interval for x=50, n=100 -- widely cited
  // reference value is approximately [0.404, 0.596].
  const r = wilsonInterval(50, 100);
  assert.ok(r !== null);
  assert.equal(r!.p, 0.5);
  assert.ok(Math.abs(r!.low - 0.4039) < 1e-3);
  assert.ok(Math.abs(r!.high - 0.5962) < 1e-3);
  assert.equal(r!.confidence, "low"); // n=100 clicks -> low per thresholds
});

test("wilsonInterval: interval always within [0,1]", () => {
  const r = wilsonInterval(0, 50); // p=0, edge case
  assert.ok(r !== null);
  assert.ok(r!.low >= 0 && r!.high <= 1);
  const r2 = wilsonInterval(50, 50); // p=1, edge case
  assert.ok(r2!.low >= 0 && r2!.high <= 1);
});

test("twoProportionZTest: known-answer fixture, clearly significant", () => {
  // p1=0.15 (150/1000), p2=0.10 (100/1000) -- hand-calculated z ~= 3.38
  const r = twoProportionZTest(150, 1000, 100, 1000);
  assert.equal(r.confidence, "sufficient");
  assert.ok(Math.abs(r.z - 3.381) < 0.01);
  assert.equal(r.significant, true);
  assert.equal(r.verdict, "Significant difference (95%)");
});

test("twoProportionZTest: near-identical rates -> not significant", () => {
  const r = twoProportionZTest(150, 1000, 148, 1000);
  assert.equal(r.significant, false);
  assert.equal(r.verdict, "No significant difference — likely noise.");
});

test("twoProportionZTest: gated below 100 conversions on either side", () => {
  const r1 = twoProportionZTest(50, 1000, 150, 1000);
  assert.equal(r1.confidence, "insufficient");
  assert.equal(r1.verdict, "Insufficient data to compare — need more conversions.");

  const r2 = twoProportionZTest(150, 1000, 50, 1000);
  assert.equal(r2.confidence, "insufficient");
});

test("twoProportionZTest: zero clicks guarded (not divide-by-zero)", () => {
  const r = twoProportionZTest(150, 0, 150, 1000);
  assert.equal(r.confidence, "insufficient");
});
