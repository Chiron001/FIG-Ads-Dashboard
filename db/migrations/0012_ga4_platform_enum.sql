-- GA4 needs to log into sync_log like every other data source (so it gets
-- the same "last synced" UI treatment as Google/Meta/Amazon/Myntra/Shopify)
-- -- same reasoning migration 0004 used to add 'shopify'. Not an ad
-- platform for forecast_ad_spend purposes (that stays scoped to the
-- original 4), just a sync-log participant.
alter type platform_enum add value 'ga4';
