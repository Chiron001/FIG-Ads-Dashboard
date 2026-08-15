-- Google Ads product-level (Shopping/PMax) and ad-level spend -- two new
-- grains, each a *different breakdown of the same campaign spend*, not an
-- additive slice of it. Three separate tables (fact_ad_performance already
-- exists) so nothing ever gets summed across grains by accident -- see the
-- "Critical modeling rule" in the build spec this migration implements.

create table fact_shopping_product_performance (
  id                uuid primary key default gen_random_uuid(),
  platform          platform_enum not null default 'google', -- Shopping/PMax product data is Google-only for now
  campaign_id       text not null,
  campaign_name     text,
  product_item_id   text not null,  -- SKU / offer id
  product_title     text,
  product_brand     text,
  product_type_l1   text,           -- category top level -- key roll-up dimension
  product_type_l2   text,
  product_type_l3   text,
  product_channel   text,           -- online / local
  date              date not null,  -- IST
  spend             numeric(14, 2) not null default 0,
  impressions       bigint not null default 0,
  clicks            bigint not null default 0,
  -- Clicked-item attribution, not purchased-item -- see column comment on
  -- `conversions`/`revenue` below and the UI's mandatory caveat banner.
  conversions       numeric(14, 2) not null default 0,
  revenue           numeric(14, 2) not null default 0,
  raw               jsonb,
  ingested_at       timestamptz not null default now()
);

comment on table fact_shopping_product_performance is
  'Google Shopping/PMax per-product (SKU) daily performance. Spend/impressions/clicks are exact; conversions/revenue are credited to the CLICKED product, not necessarily the purchased one -- directional ROAS, not per-SKU P&L. Reconciles to fact_ad_performance campaign totals within ~5% (some spend is genuinely unattributed at item level). Never summed with fact_ad_performance or fact_ad_creative_performance -- see 0005 migration header.';

create unique index fact_shopping_product_performance_upsert_key
  on fact_shopping_product_performance (platform, campaign_id, product_item_id, date);

create index fact_shopping_product_performance_date_idx
  on fact_shopping_product_performance (date);

create index fact_shopping_product_performance_campaign_idx
  on fact_shopping_product_performance (platform, campaign_id);

create index fact_shopping_product_performance_type_l1_idx
  on fact_shopping_product_performance (product_type_l1);

create table fact_ad_creative_performance (
  id              uuid primary key default gen_random_uuid(),
  platform        platform_enum not null default 'google',
  campaign_id     text not null,
  campaign_name   text,
  ad_group_id     text not null,
  ad_group_name   text,
  ad_id           text not null,
  ad_name         text,   -- nullable at source; UI falls back to ad_id + ad_type
  ad_type         text,   -- RESPONSIVE_SEARCH_AD, IMAGE_AD, VIDEO_AD, etc
  ad_status       text,   -- ENABLED / PAUSED / REMOVED
  date            date not null, -- IST
  spend           numeric(14, 2) not null default 0,
  impressions     bigint not null default 0,
  clicks          bigint not null default 0,
  conversions     numeric(14, 2) not null default 0,
  revenue         numeric(14, 2) not null default 0,
  raw             jsonb,
  ingested_at     timestamptz not null default now()
);

comment on table fact_ad_creative_performance is
  'Google per-ad (creative) daily performance, from ad_group_ad. Reconciles almost exactly (~0% tolerance) to fact_ad_performance campaign totals for Search/Display/Video ad types. Shopping/PMax campaigns have no rows here -- their product-level data lives in fact_shopping_product_performance instead. Never summed with the other two grain tables -- see 0005 migration header.';

create unique index fact_ad_creative_performance_upsert_key
  on fact_ad_creative_performance (platform, campaign_id, ad_group_id, ad_id, date);

create index fact_ad_creative_performance_date_idx
  on fact_ad_creative_performance (date);

create index fact_ad_creative_performance_campaign_idx
  on fact_ad_creative_performance (platform, campaign_id);

create index fact_ad_creative_performance_ad_group_idx
  on fact_ad_creative_performance (platform, ad_group_id);
