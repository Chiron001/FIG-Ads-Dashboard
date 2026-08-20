-- Powers the new AI "Ask anything" home page: (1) the Anthropic API key,
-- added from the Settings page rather than .env (the user wants to paste it
-- in later, in-app, without a redeploy), stored on the existing app_settings
-- singleton; (2) a log of every question asked, so the home page can show
-- "last 3" inline plus a "show all" view capped at the most recent 25.

alter table app_settings add column if not exists anthropic_api_key text;

comment on column app_settings.anthropic_api_key is
  'Anthropic API key for the AI home page''s "ask anything" feature, pasted in from the Settings page. Never returned to the client -- /settings only reports whether it is set (see IntegrationStatus).';

create table if not exists ai_query_log (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  created_at timestamptz not null default now()
);

comment on table ai_query_log is
  'Every question asked on the AI home page, newest first. Home page shows the last 3 inline and a "show all" view capped at the most recent 25 (see GET /ai/history).';
