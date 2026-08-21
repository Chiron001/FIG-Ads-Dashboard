-- Extends forecast_ad_spend (previously platform-total-only, backing the
-- Shopify Predictive Analysis page) to also carry per-campaign forecasts,
-- powering the new "Predictive Analysis" sub-section under Google Ads and
-- Meta Ads. One table, not a parallel one -- the schema and modeling
-- contract are identical, only the grain changes.
--
-- campaign_id follows the same sentinel convention forecast_shopify_
-- performance's channel column already uses: 'all' = the existing
-- platform-total row (unchanged computation, still its own independent
-- regression on the platform-level aggregate spend series -- confirmed
-- live to have a real, reliable trend, e.g. Google r2=0.70 -- summing
-- noisy per-campaign flat baselines instead would make this WORSE, not
-- better, so the two are computed independently, not derived from each
-- other). Real campaign ids get their own rows alongside it.
alter table forecast_ad_spend add column if not exists campaign_id text not null default 'all';
alter table forecast_ad_spend add column if not exists campaign_name text;
alter table forecast_ad_spend add column if not exists predicted_revenue double precision;
alter table forecast_ad_spend add column if not exists predicted_roas double precision;
alter table forecast_ad_spend add column if not exists predicted_conversions double precision;

comment on column forecast_ad_spend.campaign_id is
  '''all'' = the platform-total row (spend-only, unchanged since this table''s original version). A real campaign id (matching fact_ad_performance.campaign_id) = that campaign''s own independent forecast, only computed for campaigns with >= 7 days of history -- see server/src/routes/predictiveAnalysis.ts''s campaign forecast section.';
comment on column forecast_ad_spend.predicted_revenue is
  'Null for campaign_id = ''all'' rows (platform-total forecast is spend-only, unchanged) -- populated only for real per-campaign rows.';
comment on column forecast_ad_spend.predicted_roas is
  'predicted_revenue / predicted_spend for the same row -- derived, not independently forecast (same principle as the Shopify forecast''s predicted_aov).';

alter table forecast_ad_spend drop constraint forecast_ad_spend_pkey;
alter table forecast_ad_spend add primary key (forecast_date, platform, campaign_id);

comment on table forecast_ad_spend is
  'Forecast ad spend/revenue/ROAS/conversions, per platform (campaign_id=''all'') and per campaign. Only the forward-looking window (forecast_date >= today) is replaced on each recompute -- past forecast_date rows are deliberately PRESERVED once they''ve passed, so a "Predicted vs Actual" accuracy comparison has something real to compare against (a plain full-wipe-and-replace, this table''s original behavior, destroyed that history on every run).';
