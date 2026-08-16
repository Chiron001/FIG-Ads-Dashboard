-- User-entered monthly targets for the Projection Sheet (Shopify -> ↳
-- Projection Sheet): Unit Target + Price per product, per calendar month
-- ("YYYY-MM"). Keyed by month even though the current UI only ever shows
-- "this month" -- forward-compatible for a future month picker without a
-- schema change. Everything else on the Projection Sheet (traffic, CPM,
-- DRR, sessions, CVR, insight) is computed live from existing fact tables +
-- live Shopify catalog/session data, not stored here.

create table if not exists product_targets (
  product_id text not null,
  month text not null, -- "YYYY-MM"
  unit_target double precision,
  price double precision,
  updated_at timestamptz not null default now(),
  primary key (product_id, month)
);

comment on table product_targets is
  'User-entered per-product monthly targets (unit target, price) for the Shopify Projection Sheet. Everything else on that sheet is computed live, not stored.';
