# FIG Living — Internal Ads Analytics Dashboard

Internal, single-brand tool. Pulls FIG Living's ad performance from Google
Ads, Meta Ads, Amazon Ads (live APIs) and Myntra Ads (CSV ingest, no public
API), normalizes into one canonical schema in Postgres (Supabase), and
displays it in a dark-themed dashboard. No login, no multi-tenancy — one
account per platform, configured via `.env`. All figures in INR, all dates
normalized to IST (Asia/Kolkata).

## Live

- **Dashboard:** https://fig-ads-dashboard.vercel.app
- **API:** https://server-production-1271c.up.railway.app (`/health`,
  `/sync/status`, etc.) — the dashboard talks to this automatically, no
  need to hit it directly except for debugging.

Vercel auto-deploys reliably on push to `main`. **Railway's GitHub
auto-deploy has not been firing** (confirmed twice — pushes land on GitHub
but no new deployment starts) despite the repo showing as connected; cause
not yet diagnosed, possibly an incomplete GitHub App authorization on
Railway's side. Until that's fixed, redeploy `/server` manually after any
`server/`, `shared/`, or `railway.json` change:

```bash
railway up --service server --ci --json
```

## Status

Build proceeds phase by phase per the project spec, committing after each.

- [x] **Phase 1 — Scaffold.** npm workspaces (`server`, `web`, `shared`),
      Express skeleton with `/health` + `/health/db`, Vite/React skeleton
      wired to the server through a dev proxy, `.env.example` with every var
      the spec calls for.
- [x] **Phase 2 — Canonical schema + migrations.** `fact_ad_performance` +
      `sync_log` in `db/migrations/0001_init.sql`, applied by a small
      tracked runner (`npm run migrate --workspace server`). No
      `dim_fx_rate` — confirmed all ad accounts bill in INR. **Applied and
      verified against the live Supabase project** (schema checked
      column-by-column via `information_schema`; `/health/db` returns
      `ok:true`). Note: Supabase's direct `db.<ref>.supabase.co` host is
      IPv6-only — use the **session pooler** connection string instead (see
      `.env.example`).
- [x] **Phase 3 — Canonical TS types in `/shared`.** `CanonicalRow`,
      `SyncLogEntry`, `AdsConnector`, and `computeDerivedMetrics` (CTR/CPC/
      CPM/ROAS/ACOS/CVR, null-safe on zero denominators — spot-checked).
- [ ] **Phase 4 — Connectors: Google → Meta → Amazon → Myntra CSV.**
      - [x] Google Ads (`server/src/connectors/google.ts`) — verified live
        against the real account (987-317-2491, client under manager
        150-991-6423, `GOOGLE_ADS_LOGIN_CUSTOMER_ID` required). Smoke test:
        `npm run google:test --workspace server`.
      - [x] Meta Ads (`server/src/connectors/meta.ts`) — verified live
        against `act_295809043230605` (FigLiving, INR, Asia/Kolkata). Uses
        a System User token (Employee role, `ads_read` only, no expiry,
        least-privilege by design). Smoke test:
        `npm run meta:test --workspace server`.
      - [ ] **Amazon Ads — on hold** (user's call, 2026-08-15). Refresh-token
        + profile-discovery script is ready (`npm run amazon:auth
        --workspace server`) for whenever this resumes.
      - [ ] **Myntra CSV ingest — on hold** (same decision).
- [x] **Phase 5 — Normalization (partial).** Timezone: each connector
      checks the source account's own timezone in `authenticate()` and warns
      (never silently mislabels) if it isn't IST — both live accounts
      (Google, Meta) confirmed IST. FX: skipped entirely per the Phase 2
      confirmation (all accounts bill INR). Not yet done: Amazon/Myntra are
      on hold, so their normalization is moot for now.
- [x] **Phase 6 — API endpoints**, all verified live against real backfilled
      data (`server/src/routes/metrics.ts`, `server/src/routes/sync.ts`):
      `GET /metrics/summary`, `GET /metrics/timeseries`,
      `GET /metrics/campaigns`, `GET /sync/status`, `POST /sync/:platform`.
      (`POST /ingest/myntra` not built — Myntra on hold.)
- [x] **Phase 7 — Dashboard UI**, restructured per explicit request into 4
      platform-tab sections (Google/Meta/Amazon/Myntra) rather than the
      spec's single blended-comparison hero table — each tab is a fully
      detailed KPI + time series + campaign-table view for that platform
      alone. Dark theme (Tailwind v4 + Recharts), date range picker with
      Yesterday/Last 7/Last 30 Days presets + custom range. Verified
      end-to-end with Playwright screenshots against live data — see
      `web/src/App.tsx` and `web/src/components/`.
- [ ] **Phase 8 — Scheduler + token refresh + backfill (partial).**
      `/server` is now deployed to **Railway** (project
      `fig-ads-dashboard-server`, service `server`, GitHub-connected —
      auto-deploys on push to `main`, same as Vercel), publicly reachable at
      `https://server-production-1271c.up.railway.app`. `/web` on Vercel
      points at it via the `VITE_API_BASE_URL` build-time env var. Manual
      sync pieces exist (`server/src/scripts/backfill.ts`, the "Sync now"
      button, `POST /sync/:platform`) but there's still no `node-cron` daily
      job — syncing only happens when triggered by hand.
- [x] **Statistical Analysis Layer.** Implements the spec's sample-size-gated
      rigor rules on top of Google Ads (and reusable for any platform):
      - `server/src/stats/` — 7 pure modules (descriptive, outliers,
        inference, correlation, regression, smoothing, concentration), **55
        unit tests, all passing** (`npm test --workspace server`), covering
        the mandated fixtures: zero denominators, n=1, n=2, all-equal
        values, single outlier, known-answer cases. Deferred methods
        (chi-square, Gini, CUSUM, Holt-Winters, LTV:CAC) are marked
        `// out of scope` inline per spec §0 rather than built.
      - New endpoints: `GET /stats/compare` (two-proportion z-test on CVR,
        gated at ≥100 conversions/side), `GET /stats/anomalies` (IQR
        primary / z-score fallback on daily spend+CPA, gated at n≥8),
        `GET /stats/diagnostics` (Pearson correlation + log-regression
        diminishing-returns budget ceiling per campaign), `GET
        /stats/portfolio` (Pareto 80/20 + profit-contribution ranking).
      - `GET /metrics/campaigns` extended inline (cheap enough to compute
        for every row): reliability label (CV of daily ROAS), skew flags,
        Wilson 95% CI on CVR, marginal ROAS.
      - UI: confidence dot + skew flag inline on the ROAS cell, a
        Reliability column, a Marginal ROAS column + KPI tile (vs the
        immediately preceding period, independent of the "Compare to"
        dropdown), a "Compare two campaigns" modal, a per-campaign detail
        modal (Anomalies/Diagnostics tabs), a collapsible Portfolio section
        (Pareto chart + contribution table — the one deliberate dual-axis
        chart exception, per `dataviz` skill), and a 7d-MA/EWMA/Raw
        smoothing toggle on the trend chart (MA is the default line, not
        raw, per spec §5). Every inferential output shows its confidence
        tag and `n`; correlations are always labeled "association, not
        causation"; divide-by-zero renders "—", never 0/NaN/Infinity.
      - No new migration needed — computed entirely from existing
        `fact_ad_performance` daily rows.
      - Verified live against real Google Ads data (curl on every new
        endpoint + Playwright screenshots of every new UI surface) before
        commit.

## Structure

```
/server
  src/connectors    per-platform AdsConnector implementations (google.ts, meta.ts)
  src/routes        Express routes (metrics.ts, sync.ts)
  src/etl           sync.ts -- authenticate/fetchRaw/normalize/upsert per platform
  src/db            pool.ts (pg, for writes/queries) + supabase.ts (health check only)
  src/scripts       one-off/manual scripts (migrate, backfill, connector smoke tests,
                     OAuth refresh-token helpers)
/web              React dashboard (Vite + Tailwind v4 + Recharts)
/db/migrations    SQL migrations
/shared           canonical TS types + API response shapes, imported by both server and web
.env.example
```

Writes to `fact_ad_performance` go through raw `pg` (`server/src/db/pool.ts`),
not Supabase-js — the upsert conflict target is an expression-based unique
index (`coalesce(ad_group_id, '')`), which Supabase-js's `.upsert()` can't
target. Supabase-js is kept only for the lightweight `/health/db` check.

`server` and `web` depend on `shared` via npm workspaces (`@fig/shared`).
`shared` must be built (`npm run build:shared`) before its types are
resolvable elsewhere — this runs automatically via `postinstall` after
`npm install` at the repo root.

## Setup

```bash
npm install                # installs all workspaces, builds @fig/shared
cp .env.example .env       # fill in real values as each phase needs them
npm run migrate --workspace server   # applies db/migrations/*.sql (needs DATABASE_URL)
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

Load real data (needs Google/Meta credentials in `.env`):

```bash
npm run backfill --workspace server -- --days=30 --platforms=google,meta
```

## Manual prerequisites (not codeable — see spec §10)

1. **Google Ads:** developer token approval + OAuth refresh token. Done —
   see `server/src/scripts/google-get-refresh-token.ts` (`npm run
   google:auth --workspace server`) to regenerate if it's ever revoked. OAuth
   app is published (Production), so no 7-day test-token expiry to worry
   about. One gotcha worth knowing if this is ever redone: the account is a
   client under a manager (MCC) account, so `GOOGLE_ADS_LOGIN_CUSTOMER_ID`
   (the manager's id) is required even for a user with direct access to the
   client account.
2. **Meta:** done — a System User token (`ads_read` only, Employee role,
   "View performance" asset access only), generated once through Business
   Settings (no script needed; System User tokens don't use an OAuth
   refresh flow and, set to "Never" expire, don't need periodic renewal
   either). No App Review was needed — the app only ever accesses ad
   accounts its own admins/System Users have a role on (Standard Access),
   not third-party accounts.
3. **Amazon Ads — on hold.** Registration + LWA setup not done yet. When
   resumed: `server/src/scripts/amazon-get-refresh-token.ts` (`npm run
   amazon:auth --workspace server`) handles the refresh token and also
   auto-discovers the profile ID + region.
4. **Myntra — on hold.** Locate the CSV export in the seller/partner panel;
   note the exact column headers so the ingest mapping config matches, when
   this resumes.
5. **Confirmed:** all ad accounts (Google, Meta) bill in INR — FX layer
   skipped entirely, see Phase 5 above.
6. **Supabase:** done — see Phase 2 above.

## Non-negotiables from the spec

- Never sum revenue across platforms into a single blended number without
  labeling it "blended, non-attributed" — attribution windows differ per
  platform and summing double-counts.
- Myntra is CSV-ingest only. No live Myntra connector.
- All dates stored in `fact_ad_performance.date` are IST, regardless of the
  reporting platform's own timezone.
