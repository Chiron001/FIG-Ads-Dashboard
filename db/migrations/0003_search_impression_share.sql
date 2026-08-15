-- Google Ads-only Search impression-share metrics, for the campaign table
-- column spec. These are fundamentally campaign-level-per-day metrics
-- (not additive across ad groups like spend/clicks), so they're nullable
-- and only populated on a synthetic ad_group_id='' row per campaign+date
-- (the Google connector's fetchRaw emits a second, campaign-level query
-- result alongside the normal ad_group rows) -- read with MAX() when
-- aggregating a campaign's rows, never SUM(), since summing a percentage
-- across ad groups would be meaningless.

alter table fact_ad_performance
  add column search_impression_share numeric,
  add column search_budget_lost_impression_share numeric;

comment on column fact_ad_performance.search_impression_share is
  'Google Ads Search campaigns only; null for other platforms/campaign types. Campaign-level metric, not additive -- aggregate with MAX(), never SUM().';
comment on column fact_ad_performance.search_budget_lost_impression_share is
  'Google Ads Search campaigns only; null for other platforms/campaign types. Campaign-level metric, not additive -- aggregate with MAX(), never SUM().';
