import test from "node:test";
import assert from "node:assert/strict";
import { movingAverage, ewma } from "./smoothing";

test("movingAverage: known-answer fixture, window=3", () => {
  const result = movingAverage([1, 2, 3, 4, 5], 3);
  assert.deepEqual(result, [null, null, 2, 3, 4]);
});

test("movingAverage: gap in window -> null for any window containing it", () => {
  const result = movingAverage([1, 2, null, 4, 5], 3);
  // windows: [1,2,null]->null, [2,null,4]->null, [null,4,5]->null
  assert.deepEqual(result, [null, null, null, null, null]);
});

test("ewma: known-answer fixture, alpha=0.5", () => {
  // t0=10 (seed), t1=0.5*20+0.5*10=15, t2=0.5*30+0.5*15=22.5
  const result = ewma([10, 20, 30], 0.5);
  assert.equal(result[0], 10);
  assert.equal(result[1], 15);
  assert.equal(result[2], 22.5);
});

test("ewma: holds last value through a gap instead of resetting", () => {
  const result = ewma([10, null, 30], 0.5);
  assert.equal(result[0], 10);
  assert.equal(result[1], 10); // held
  assert.equal(result[2], 20); // 0.5*30 + 0.5*10
});

test("ewma: leading nulls stay null until first real value", () => {
  const result = ewma([null, null, 10], 0.5);
  assert.deepEqual(result, [null, null, 10]);
});
