-- Powers the new "Predictive Analysis" sub-section under Shopify: forecasts
-- for both ad spend and Shopify revenue/orders/AOV/CVR, plus the real data
-- (GA4 channel history, Shopify customer id) those forecasts are trained on.

-- --- GA4 daily channel data (stored, unlike Shopify's live-only ShopifyQL
-- session data -- see db/migrations/0007's header for why that one stays
-- live-only). Forecasting needs a real time series, so this one IS synced
-- and stored, same as fact_ad_performance. Raw GA4 channel group (16
-- possible values) is stored as-is, not pre-collapsed -- the 5-way
-- Paid/Organic/Direct/Referral-Email-Other/Unassigned bucketing used by the
-- forecast lives in application code (server/src/lib/ga4Channels.ts), so
-- re-bucketing later never needs a re-sync.
create table if not exists fact_ga4_channel_daily (
  date            date not null,
  channel_group   text not null, -- GA4's own sessionDefaultChannelGroup, e.g. "Paid Search", "Direct", "Unassigned"
  sessions        double precision not null default 0,
  conversions     double precision not null default 0, -- GA4 "key events" count -- broader than transactions, not purchase-specific
  transactions    double precision not null default 0,
  revenue         double precision not null default 0,
  ingested_at     timestamptz not null default now(),
  primary key (date, channel_group)
);

create index fact_ga4_channel_daily_date_idx on fact_ga4_channel_daily (date);

comment on table fact_ga4_channel_daily is
  'Daily sessions/conversions/transactions/revenue by GA4 channel group. Stored (unlike Shopify''s live ShopifyQL session queries) because forecasting needs a real time series. Cross-checked against, never summed with, fact_shopify_orders -- GA4 and Shopify measure revenue via different attribution logic.';

-- --- Shopify customer id (opaque, NOT PII -- no name/email/phone) ----------
-- Added specifically to compute new-vs-returning segmentation for the
-- Shopify forecast: a customer's Nth order is "new" if N=1, "returning"
-- otherwise, computed at query time from order history grouped by this id
-- (never stored as a flag, since "was this a repeat customer" can change
-- retroactively as later orders come in).
alter table fact_shopify_orders add column if not exists customer_id text;

comment on column fact_shopify_orders.customer_id is
  'Shopify''s numeric customer id (gid://shopify/Customer/...), NOT name/email/phone -- added to compute new-vs-returning segmentation for the Predictive Analysis forecast. Null for orders synced before this column existed, and for genuine guest checkouts with no Shopify customer record.';

-- --- Forecast outputs -------------------------------------------------------
--
-- Both tables share the same modeling contract (see server/src/lib/forecast.ts):
-- 7-day moving average as the baseline, upgraded to a linear-regression trend
-- line only when r2 >= 0.3 (the same reliability floor already used by the
-- ads diminishing-returns model, server/src/stats/regression.ts) -- confirmed
-- against 97 days of real Shopify order history before this was built: the
-- trend line's r2 came back 0.036 (unreliable), and the flat moving-average
-- baseline had the lower backtest error (16.9% MAPE vs 19.4%). is_reliable
-- and r2 are stored explicitly so the UI can show *why* a forecast is a flat
-- line, not silently pick one model and hide the disagreement.
--
-- Recomputed on demand (POST /forecast/run, also piggybacked onto "Sync
-- all") rather than on a true OS-level cron -- this app has no scheduler at
-- all yet (confirmed: no cron, no Railway Cron Job configured), and standing
-- one up is a bigger, separate infra decision. This is the same "don't build
-- a separate pipeline without a good reason" call, applied to the fact that
-- the reason (an actual scheduler) doesn't exist yet either.
create table if not exists forecast_ad_spend (
  forecast_date       date not null,
  platform            platform_enum not null,
  predicted_spend     double precision not null,
  ci_low              double precision, -- null if the model has no meaningful spread yet (e.g. flat MA baseline)
  ci_high             double precision,
  model_used          text not null, -- "moving_average_7d" | "linear_regression"
  r2                  double precision, -- null for moving_average_7d (no fit to score)
  is_reliable         boolean not null default false,
  generated_at        timestamptz not null default now(),
  primary key (forecast_date, platform)
);

comment on table forecast_ad_spend is
  'Forecast ad spend per platform per day (7/14/30-day horizons all live in the same table, one row per forecast_date). Recomputed and overwritten (upsert) each time POST /forecast/run runs, not appended -- only the latest forecast per date is kept.';

create table if not exists forecast_shopify_performance (
  forecast_date              date not null,
  -- 'all' = every channel combined; otherwise one of the 5 collapsed
  -- buckets (see ga4Channels.ts). A literal sentinel rather than NULL --
  -- NULL can't participate in a composite primary key/upsert target.
  channel                    text not null default 'all',
  predicted_revenue          double precision not null,
  predicted_orders           double precision not null,
  predicted_aov              double precision,
  predicted_conversion_rate  double precision,
  ci_low                     double precision, -- confidence interval on predicted_revenue specifically
  ci_high                    double precision,
  model_used                 text not null,
  r2                         double precision,
  is_reliable                boolean not null default false,
  generated_at               timestamptz not null default now(),
  primary key (forecast_date, channel)
);

comment on table forecast_shopify_performance is
  'Forecast Shopify revenue/orders/AOV/CVR per day, optionally split by channel bucket (channel = ''all'' is the combined total row). Same recompute/upsert contract as forecast_ad_spend.';
