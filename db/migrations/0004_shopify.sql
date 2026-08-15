-- Shopify is ground-truth order/product data, not an ad platform -- it has
-- no spend/impressions/clicks/campaigns, so it gets its own tables rather
-- than being forced into fact_ad_performance. Purpose: cross-check what
-- each ad platform *claims* as attributed revenue against what Shopify
-- actually recorded, and surface product-level performance the ad-platform
-- fact table has no concept of.
--
-- No customer PII (name/email/phone) is fetched or stored -- nothing here
-- needs it.

alter type platform_enum add value 'shopify';

create table fact_shopify_orders (
  order_id          text primary key, -- Shopify order id
  order_number      text,             -- human-readable, e.g. "#1042"
  date              date not null,    -- IST, converted from Shopify's created_at
  financial_status  text,             -- paid / refunded / partially_refunded / pending / voided
  total_price       numeric not null default 0,
  subtotal_price    numeric not null default 0,
  total_discounts   numeric not null default 0,
  total_tax         numeric not null default 0,
  currency          text,
  source_name       text,             -- Shopify's own channel tag: web, pos, iphone, etc
  line_item_count   integer not null default 0,
  raw               jsonb,
  ingested_at       timestamptz not null default now()
);

create index fact_shopify_orders_date_idx on fact_shopify_orders (date);

comment on table fact_shopify_orders is
  'Ground-truth Shopify orders, independent of any ad platform''s self-reported attribution. Cross-reference against fact_ad_performance revenue, never sum the two -- they measure different things.';

create table fact_shopify_line_items (
  id             text primary key, -- Shopify line item id
  order_id       text not null references fact_shopify_orders(order_id) on delete cascade,
  date           date not null,    -- denormalized from the order for direct date-range queries
  product_id     text,
  variant_id     text,
  title          text,
  variant_title  text,
  sku            text,
  product_type   text,
  vendor         text,
  quantity       integer not null default 0,
  price          numeric not null default 0,
  line_total     numeric not null default 0,
  raw            jsonb,
  ingested_at    timestamptz not null default now()
);

create index fact_shopify_line_items_date_idx on fact_shopify_line_items (date);
create index fact_shopify_line_items_order_idx on fact_shopify_line_items (order_id);
create index fact_shopify_line_items_product_idx on fact_shopify_line_items (product_id);

comment on table fact_shopify_line_items is
  'Product-level breakdown per order. One row per line item; a product sold across many orders has many rows, aggregated by product_id at query time.';
