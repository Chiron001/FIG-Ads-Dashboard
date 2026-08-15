-- Campaign roster, separate from performance facts. fact_ad_performance
-- only ever contains rows a platform actually returned for a date range,
-- which for Google/Meta means rows with real activity that day -- a
-- paused or simply inactive-that-week campaign produces zero rows and
-- never showed up in the UI at all. This table is refreshed on every sync
-- (upserted from a lightweight roster call each connector makes
-- independent of any date range) so the campaign list is always complete,
-- and carries platform status so the UI can show ENABLED/PAUSED/etc.

create table dim_campaign (
  platform      platform_enum not null,
  campaign_id   text not null,
  campaign_name text,
  -- Raw platform status string (Google: ENABLED/PAUSED/REMOVED; Meta:
  -- effective_status values like ACTIVE/PAUSED/ARCHIVED/DELETED). Stored
  -- as-is rather than normalized into a shared enum -- the platforms' own
  -- vocabularies differ enough that forcing one taxonomy would lose
  -- information for little gain at this scale.
  status        text,
  updated_at    timestamptz not null default now(),
  primary key (platform, campaign_id)
);

comment on table dim_campaign is
  'Full campaign roster per platform (including zero-activity/paused campaigns), refreshed on every sync. Joined against fact_ad_performance in /metrics/campaigns so the campaign list is never limited to just what had spend in the selected range.';
