-- fact_shopping_product_performance / fact_ad_creative_performance
-- (0005) were built Google-only. Meta also has a product grain (Insights
-- `breakdowns=product_id`, via its catalog/pixel product matching -- not
-- Shopping-specific despite the table name) and an ad grain (Insights
-- `level=ad`), so both tables are now multi-platform. The `default
-- 'google'` on `platform` was never relied on (every upsert always sets it
-- explicitly) but is misleading now -- dropped for clarity.

alter table fact_shopping_product_performance alter column platform drop default;
alter table fact_ad_creative_performance alter column platform drop default;

comment on table fact_shopping_product_performance is
  'Per-product (SKU) daily ad performance, Google (Shopping/PMax feed) and Meta (catalog/pixel product-matched, via breakdowns=product_id) both included. Spend/impressions/clicks are exact; conversions/revenue are credited to the product shown in the clicked/viewed ad, not necessarily the one purchased -- directional ROAS, not per-SKU P&L. Reconciles to fact_ad_performance campaign totals within ~5% (some spend is genuinely unattributed at item level; on Meta this can be much lower for non-catalog campaigns -- see the reconciliation field, not a fixed assumption). Never summed with fact_ad_performance or fact_ad_creative_performance -- see 0005 migration header.';

comment on table fact_ad_creative_performance is
  'Per-ad (creative) daily performance, Google (ad_group_ad, Search/Display/Video ad types only) and Meta (Insights level=ad, effectively all campaign types) both included. Reconciles closely to fact_ad_performance campaign totals -- near-exact on Meta, and on Google for Search/Display/Video (Shopping/PMax campaigns have no rows here; see the product grain instead). Never summed with the other two grain tables -- see 0005 migration header.';
