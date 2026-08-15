# FIG Living — Internal Ads Analytics Dashboard

Internal, single-brand tool. Pulls FIG Living's ad performance from Google
Ads, Meta Ads, Amazon Ads (live APIs) and Myntra Ads (CSV ingest, no public
API), normalizes into one canonical schema in Postgres (Supabase), and
displays it in a dark-themed dashboard. No login, no multi-tenancy — one
account per platform, configured via `.env`. All figures in INR, all dates
normalized to IST (Asia/Kolkata).

## Status

Build proceeds phase by phase per the project spec, committing after each.

- [x] **Phase 1 — Scaffold.** npm workspaces (`server`, `web`, `shared`),
      Express skeleton with `/health` + `/health/db`, Vite/React skeleton
      wired to the server through a dev proxy, `.env.example` with every var
      the spec calls for.
- [ ] Phase 2 — Canonical schema + migrations (`fact_ad_performance`,
      `sync_log`, `dim_fx_rate` if needed)
- [ ] Phase 3 — Canonical TS types in `/shared`
- [ ] Phase 4 — Connectors: Google → Meta → Amazon → Myntra CSV
- [ ] Phase 5 — Normalization (timezone, FX if needed)
- [ ] Phase 6 — API endpoints
- [ ] Phase 7 — Dashboard UI
- [ ] Phase 8 — Scheduler + token refresh + backfill

## Structure

```
/server        Express API + connectors + ETL + cron
/web           React dashboard (Vite)
/db/migrations SQL migrations
/shared        canonical TS types, imported by both server and web
.env.example
```

`server` and `web` depend on `shared` via npm workspaces (`@fig/shared`).
`shared` must be built (`npm run build:shared`) before its types are
resolvable elsewhere — this runs automatically via `postinstall` after
`npm install` at the repo root.

## Setup

```bash
npm install                # installs all workspaces, builds @fig/shared
cp .env.example .env       # fill in real values as each phase needs them
```

Run the server and web app in separate terminals:

```bash
npm run dev:server         # http://localhost:4000
npm run dev:web            # http://localhost:5173, proxies /api -> :4000
```

Smoke test:

```bash
curl http://localhost:4000/health       # {"ok":true,...}
curl http://localhost:4000/health/db    # ok:false until SUPABASE_* is set
```

## Manual prerequisites (not codeable — see spec §10)

1. **Google Ads:** developer token approval + OAuth refresh token.
2. **Meta:** app with `ads_read`, pass App Review, generate long-lived token.
3. **Amazon Ads:** register for the Advertising API, LWA setup, get profile ID.
4. **Myntra:** locate the CSV export in the seller/partner panel; note the
   exact column headers so the ingest mapping config matches.
5. **Confirm:** which ad accounts bill in INR vs USD — decides whether the
   FX layer (`dim_fx_rate`) gets built in Phase 5, or skipped entirely.
6. **Supabase:** create a project, get `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, and the direct Postgres `DATABASE_URL` for
   running migrations.

## Non-negotiables from the spec

- Never sum revenue across platforms into a single blended number without
  labeling it "blended, non-attributed" — attribution windows differ per
  platform and summing double-counts.
- Myntra is CSV-ingest only. No live Myntra connector.
- All dates stored in `fact_ad_performance.date` are IST, regardless of the
  reporting platform's own timezone.
