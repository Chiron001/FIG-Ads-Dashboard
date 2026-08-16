-- Editable app-wide settings, powering the new Settings page: Products COGS
-- % (previously a hardcoded 0.35 constant in server/src/routes/shopify.ts)
-- and a list of additional EBITDA-relevant cost line items. Singleton row
-- -- this is one shared config, not per-user -- enforced via a boolean
-- primary key that can only ever be `true` (the standard Postgres trick for
-- a table that must hold exactly one row).

create table if not exists app_settings (
  id boolean primary key default true,
  constraint app_settings_singleton check (id),
  cogs_rate double precision not null default 0.35,
  additional_costs jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

insert into app_settings (id) values (true) on conflict (id) do nothing;

comment on table app_settings is
  'Singleton row of editable app-wide settings (COGS %, additional EBITDA cost line items), edited from the Settings page.';
comment on column app_settings.cogs_rate is
  'Cost of goods sold as a fraction of selling price (e.g. 0.35 = 35%). Feeds Products/Product Quadrants POAS and the Settings page''s EBITDA preview.';
comment on column app_settings.additional_costs is
  'Array of {id, name, type, value} where type is one of "percent_of_revenue" | "flat_per_order" | "flat_total" -- additional EBITDA-relevant costs beyond COGS and ad spend (e.g. shipping, packaging, payment gateway fees, fixed overhead).';
