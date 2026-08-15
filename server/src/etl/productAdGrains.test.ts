import { test } from "node:test";
import assert from "node:assert/strict";
import { collapseProductDuplicates } from "./productAdGrains";
import type { ProductPerformanceInput } from "./grainTypes";

function row(over: Partial<ProductPerformanceInput> = {}): ProductPerformanceInput {
  return {
    campaignId: "c1",
    campaignName: "Campaign",
    productItemId: "p1",
    productTitle: "Product",
    productBrand: null,
    productTypeL1: null,
    productTypeL2: null,
    productTypeL3: null,
    productChannel: null,
    date: "2026-08-14",
    spend: 10,
    impressions: 100,
    clicks: 5,
    conversions: 1,
    revenue: 500,
    raw: {},
    ...over,
  };
}

test("collapseProductDuplicates: distinct keys pass through unchanged", () => {
  const rows = [row({ productItemId: "p1" }), row({ productItemId: "p2" })];
  const out = collapseProductDuplicates(rows);
  assert.equal(out.length, 2);
});

// The exact live bug this guards against: Meta's product_id breakdown is
// queried at level=ad, so the same product shown via two different ads in
// one campaign on one day produces two raw rows sharing (campaignId,
// productItemId, date) -- Postgres's ON CONFLICT DO UPDATE errors if that
// duplicate key reaches the same INSERT batch.
test("collapseProductDuplicates: same (campaign, product, date) from two different ads is summed, not duplicated", () => {
  const rows = [
    row({ spend: 10, impressions: 100, clicks: 5, conversions: 1, revenue: 500, raw: { adId: "ad-a" } }),
    row({ spend: 4, impressions: 40, clicks: 1, conversions: 0, revenue: 0, raw: { adId: "ad-b" } }),
  ];
  const out = collapseProductDuplicates(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].spend, 14);
  assert.equal(out[0].impressions, 140);
  assert.equal(out[0].clicks, 6);
  assert.equal(out[0].conversions, 1);
  assert.equal(out[0].revenue, 500);
});

test("collapseProductDuplicates: different date or campaign keeps rows separate", () => {
  const rows = [row({ date: "2026-08-14" }), row({ date: "2026-08-15" }), row({ campaignId: "c2" })];
  const out = collapseProductDuplicates(rows);
  assert.equal(out.length, 3);
});

test("collapseProductDuplicates: descriptive fields fill gaps from a later duplicate without overwriting an existing value", () => {
  const rows = [row({ productTitle: null, productTypeL1: null }), row({ productTitle: "Real Title", productTypeL1: "lamps" })];
  const out = collapseProductDuplicates(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].productTitle, "Real Title");
  assert.equal(out[0].productTypeL1, "lamps");
});

test("collapseProductDuplicates: empty input -> empty output", () => {
  assert.deepEqual(collapseProductDuplicates([]), []);
});
