-- Product URL handle (slug), e.g. "wavy-floor-lamp-red" -- needed to join
-- line items against live Shopify Analytics session data, which only
-- identifies a product by its storefront landing_page_path
-- (/products/<handle>), not by product_id. See server/src/connectors/shopify.ts
-- fetchProductSessions() and the "Products" section's Sessions/CVR columns.
--
-- Session counts themselves are NOT stored -- Shopify's ShopifyQL analytics
-- API caps any single query at 1000 result rows, and this store's landing
-- page long tail (query-string variants, UTM combinations, etc.) blows past
-- that even for a single day's per-path breakdown. A live range-aggregate
-- query per request (matching how this table is already queried -- range
-- totals, not a daily time series) stays under the cap and avoids a
-- storage layer for data that can't be stored completely anyway.

alter table fact_shopify_line_items add column product_handle text;

comment on column fact_shopify_line_items.product_handle is
  'Product URL handle/slug from Shopify (e.g. "wavy-floor-lamp-red"), used to join against live session data by landing_page_path. Nullable -- rows synced before this column existed are null until re-synced.';
