-- Phase 2: canonical schema.
--
-- Single fact table all four platform connectors normalize into, plus a
-- sync log for the status panel. No dim_fx_rate table — confirmed with the
-- user that all ad accounts (Google/Meta/Amazon) bill in INR, so the FX
-- layer described in the spec is skipped entirely. Revisit if that changes.

create extension if not exists pgcrypto;

create type platform_enum as enum ('google', 'meta', 'amazon', 'myntra');

create table fact_ad_performance (
  id                   uuid primary key default gen_random_uuid(),
  platform             platform_enum not null,
  campaign_id          text not null,
  campaign_name        text,
  -- Meta = adset id/name, Amazon = ad group id/name, Google = ad group,
  -- Myntra = usually null (CSV rarely breaks out below campaign level).
  ad_group_id          text,
  ad_group_name        text,
  -- Always IST (Asia/Kolkata), regardless of the source platform's own
  -- reporting timezone. Converted in the normalization layer (Phase 5).
  date                 date not null,
  spend                numeric(14, 2) not null default 0,
  impressions           bigint not null default 0,
  clicks               bigint not null default 0,
  conversions          numeric(14, 2) not null default 0,
  revenue              numeric(14, 2) not null default 0,
  -- Source attribution window, e.g. meta_7d_click, amazon_14d, google_dda,
  -- myntra_as_reported. Never blend revenue across rows with different
  -- attribution_window values without labeling the result non-attributed.
  attribution_window   text not null,
  -- Original platform row, kept for debugging / re-normalization.
  raw                  jsonb,
  ingested_at          timestamptz not null default now()
);

-- Idempotent upsert target. ad_group_id is nullable, and Postgres treats
-- NULLs as distinct in a plain UNIQUE constraint (so two null-ad_group_id
-- rows for the same campaign/date would NOT collide and both insert) --
-- coalesce it in a unique index instead so upserts stay idempotent whether
-- or not a platform reports an ad-group level.
--
-- Amazon note (spec 4c/5): Sponsored Products / Brands / Display can share
-- a campaign_id across report types. The Amazon connector (Phase 4) must
-- fold the report type into ad_group_id (e.g. "sp:<ad_group_id>",
-- "sb:<placement_id>", "sd:<ad_group_id>") so SP/SB/SD rows for the same
-- underlying campaign_id don't collide here.
create unique index fact_ad_performance_upsert_key
  on fact_ad_performance (platform, campaign_id, coalesce(ad_group_id, ''), date, attribution_window);

create index fact_ad_performance_platform_date_idx
  on fact_ad_performance (platform, date);

create index fact_ad_performance_date_idx
  on fact_ad_performance (date);

create index fact_ad_performance_campaign_idx
  on fact_ad_performance (platform, campaign_id);

comment on table fact_ad_performance is
  'Canonical ad performance fact table. All four connectors (google, meta, amazon, myntra) normalize into this shape. Never sum revenue across platforms as one number without labeling it blended/non-attributed.';

create table sync_log (
  id       uuid primary key default gen_random_uuid(),
  platform platform_enum not null,
  run_at   timestamptz not null default now(),
  status   text not null check (status in ('success', 'partial', 'error')),
  rows     integer not null default 0,
  error    text
);

create index sync_log_platform_run_at_idx
  on sync_log (platform, run_at desc);

comment on table sync_log is
  'One row per sync attempt (scheduled pull, manual /sync/:platform trigger, or Myntra CSV upload). Powers the /sync/status panel.';
