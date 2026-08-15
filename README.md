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
- [x] **Product-Level & Ad-Level Spend (Google + Meta).** Two new grains, each a
      different breakdown of the SAME campaign spend `fact_ad_performance`
      already holds -- never summed with campaign or with each other (the
      "Critical modeling rule" the build spec leads with):
      - `db/migrations/0005_google_product_ad_grain.sql` — two new tables,
        `fact_shopping_product_performance` (from `shopping_performance_view`,
        one row per SKU/campaign/day) and `fact_ad_creative_performance`
        (from `ad_group_ad`, one row per ad/day). No changes to the existing
        campaign-grain table.
      - `GoogleAdsConnector` gains `fetchProductPerformance`/
        `normalizeProductPerformance` and `fetchAdPerformance`/
        `normalizeAdPerformance` (`server/src/connectors/google.ts`),
        reusing the same authenticated session as the main sync — no
        separate auth. `ad_group_ad.status`/`ad.type` needed the same
        numeric-protobuf-enum resolution as `campaign.status` (verified live:
        raw codes, not strings, exactly like the existing campaign-status
        gotcha).
      - `server/src/etl/productAdGrains.ts` — upserts for both tables, wired
        into `runSync("google", …)` so both grains refresh on the same
        schedule as the campaign sync, each independently try/caught so one
        grain's failure never blocks the other or the main sync.
      - New endpoints: `GET /metrics/products` (SKU or category L1/L2
        roll-up, defaults to L1 per spec §1f), `GET /metrics/products/pareto`
        (SKU cumulative-revenue Pareto + zero-order "spend leak" tail
        flags), `GET /metrics/ads` (per-ad, any campaign/ad-group filter).
        Both product/ad endpoints return a `reconciliation` field (grain
        spend vs. campaign spend for the same filter) — verified live: ads
        reconcile to ~0.0001% (near-exact), products reconcile only
        partially when a campaign mixes Shopping and Search spend, which the
        UI surfaces honestly rather than hiding.
      - `server/src/util/reconciliation.ts` + test — the spec's explicit
        guardrail ("a unit test that would FAIL if product+ad+campaign
        spend were ever added together"): simulates the exact double-count
        bug (grain spend + campaign spend, as if summed across grains) and
        asserts it's caught as ~100% out of tolerance, not silently passed.
      - `web/src/lib/verdict.ts`'s `verdictFor`/`computeMedians` were
        loosened from `CampaignRow` to a `Pick<...>` subset so the exact
        same Scale/Maintain/Cut/etc rules apply at ad grain too (spec §2d),
        no logic duplicated.
      - UI: two new collapsible subsections (matching the Portfolio
        section's pattern), **Products** and **Ad Groups & Ads**
        (`web/src/components/ProductsSection.tsx`, `AdsSection.tsx`) — each
        with its own campaign filter, independent of the campaign table
        above. Products defaults to the category roll-up (toggle to
        sub-category or individual SKU), carries the mandatory
        clicked-vs-purchased attribution caveat banner, a reconciliation
        note, and a Pareto headline + collapsible spend-leak list. Ads shows
        per-ad Verdict pills, sorted by spend desc, zero-spend hidden by
        default. Never a combined table mixing grains.
      - Verified live end-to-end: manual `/sync/google` populated both new
        tables from the real account (1,000 product rows / 55 SKUs, 184 ad
        rows / 4 ads), all three endpoints curl-verified, and every new UI
        surface confirmed via Playwright screenshots (category roll-up, SKU
        drill-down, Pareto + spend-leak list, ad table with verdicts and a
        nearly-exact reconciliation) with zero console errors.
      - **Extended to Meta Ads** (`db/migrations/0006_generalize_product_ad_grain.sql`
        drops the `platform` column's Google-only default; both tables were
        already multi-platform-shaped). `MetaAdsConnector` gains the same
        four methods: `fetchAdPerformance`/`normalizeAdPerformance` (Insights
        `level=ad`, no breakdown — ad status/type aren't valid Insights
        fields, confirmed live, so they're joined in-memory from a separate
        `/ads?fields=...,effective_status,creative{object_type}` roster call,
        same pattern as `fetchCampaignRoster`) and
        `fetchProductPerformance`/`normalizeProductPerformance` (Insights
        `breakdowns=product_id` — Meta's catalog/pixel product matching,
        confirmed live to return real rows even on non-DPA "UGC" campaigns).
        Meta's product breakdown has no category dimension, so the shared
        `ProductsSection` only offers SKU grouping (no roll-up) when
        `platform="meta"`. Shared plumbing: `server/src/etl/grainTypes.ts`
        (connector-agnostic `ProductPerformanceInput`/`AdPerformanceInput`,
        kept import-cycle-free from `../connectors/*`),
        `productAdGrains.ts`'s upsert functions now take an explicit
        `platform` param instead of hardcoding `"google"`, and
        `/metrics/products`, `/metrics/products/pareto`, `/metrics/ads` all
        take a `?platform=google|meta` query param (default `google` for
        back-compat). Two real bugs found and fixed against live Meta data:
        (1) `metaGet`'s retry loop only handled parsed API error bodies, not
        network-level exceptions — a real `ECONNRESET` on a
        product-breakdown chunk went unretried and failed the whole grain;
        fixed by wrapping `fetch()` itself in the same retry/backoff. (2)
        Meta's product_id breakdown is queried at `level=ad`, so the same
        product shown via two different ads in one campaign/day produces two
        raw rows sharing the same `(campaign, product, date)` upsert key —
        Postgres's `ON CONFLICT DO UPDATE` errors ("cannot affect row a
        second time") if that lands in one `INSERT` batch; fixed with a
        `collapseProductDuplicates` pre-aggregation step (summed, not
        dropped), covered by 5 new tests including the exact live scenario.
        Verified live end-to-end: `/sync/meta` populated both new tables
        (2,899 product rows / 405 SKUs, 512 ad rows), ads reconcile to
        ~0.07% of campaign spend (near-exact), products cover ~44% (the rest
        has no catalog/pixel match, surfaced honestly in the same banner as
        Google's), and both sections confirmed via Playwright against the
        live Meta Ads tab with zero console errors.
      - Added the same **"Hide zero-spend"** filter (default on) to the
        Products section that the campaign table and Ads section already
        had — % Spend/% Rev recompute over the visible (filtered) set,
        matching the existing pattern.
- [x] **Shopify — connected.** `SHOPIFY_STORE_DOMAIN=figliving1.myshopify.com`
      + `SHOPIFY_ADMIN_ACCESS_TOKEN` (a store-level "legacy custom app"
      Admin API token, scopes `read_orders`/`read_all_orders`/
      `read_products`) are live in `.env` and on Railway. **Getting the
      token was non-trivial** — Shopify retired creating new legacy custom
      apps as of 2026-01-01, so the obvious path (a static token, no OAuth)
      looked closed at first. Two things unblocked it:
      1. `figliving1.myshopify.com` turned out to already have an existing
         legacy custom app from before that cutoff (unaffected by the
         retirement — "does not impact any existing apps"), so no OAuth was
         actually needed in the end.
      2. As a fallback for the case where that hadn't been true,
         `server/src/routes/shopifyOauth.ts` (+ `SHOPIFY_CLIENT_ID`/
         `SHOPIFY_CLIENT_SECRET` in `env.ts`) implements a one-time OAuth
         handshake (`GET /shopify/oauth/install` → Shopify's authorize
         screen → `GET /shopify/oauth/callback`, with HMAC verification and
         one-time state/nonce checking) against a Dev-Dashboard app, ending
         in a page that displays the resulting Admin API access token once
         for manual copy into `SHOPIFY_ADMIN_ACCESS_TOKEN` — nothing is
         stored server-side. Kept in the codebase (unused for now, but zero
         cost to keep) in case the token ever needs regenerating via that
         route instead.
      - Verified live: connector smoke test against the real store (1,067
        orders / ₹44.8L revenue / 1,508 line items over a 30-day sample),
        then a 90-day production backfill via `POST /shopify/sync`
        (2,846 orders, ₹1.17Cr revenue), confirmed end-to-end on the
        deployed frontend (`/shopify/status` → `connected: true`, KPI
        tiles and a 144-row product table populated with real SKUs/types/
        vendors) with zero console errors.
      - **Sessions + CVR** (per-product and site-wide). Session/traffic data
        isn't part of the Orders/Products Admin API at all — it lives in
        Shopify's separate Analytics engine, queried live via
        `shopifyqlQuery` (confirmed its real schema by introspection first
        rather than guessing: `ShopifyqlQueryResponse { parseErrors:
        [String!]!, tableData: { columns, rows } }`). Deliberately **not
        stored** — `db/migrations/0007_shopify_product_handle.sql`'s header
        explains why: ShopifyQL caps any single query at 1000 result rows,
        and this store's landing-page long tail (query-string/UTM variants
        of the same product URL) blows past that even for a single day's
        breakdown, so a daily-grain fact table would silently be incomplete.
        Instead:
        - `ShopifyConnector.fetchTotalSessions` — one ungrouped ShopifyQL
          call per request (`FROM sessions SHOW sessions SINCE … UNTIL …`),
          always a single exact row regardless of path cardinality. Powers
          the "Sessions" KPI and the site-wide CVR (`unitsSold / sessions`)
          in `GET /shopify/summary`.
        - `ShopifyConnector.fetchProductSessions` — session counts grouped
          by `landing_page_path`, filtered to `/products/` paths,
          `ORDER BY sessions DESC LIMIT 1000` so any truncation only drops
          low-traffic long-tail variants rather than real products, then
          aggregated in Node by product handle extracted from the path
          (`/collections/x/products/wavy-floor-lamp-red` and
          `/products/wavy-floor-lamp-red` both → `wavy-floor-lamp-red`).
          Joined against `fact_shopify_line_items` by the new
          `product_handle` column (0007) to add `sessions`/`cvr` per row in
          `GET /shopify/products`.
        - Both calls are wrapped so a ShopifyQL failure (plan/permission
          restriction, transient error) degrades to `sessions: null` rather
          than breaking the rest of the response — the order/product data
          from Postgres always renders regardless.
        - Verified live: total sessions 1,29,347 / CVR 1.37% for a 30-day
          window, per-product sessions ranging from real single digits to
          8k+ for top sellers, all confirmed via Playwright with zero
          console errors.
- [x] **Meta SKU Attribution — Ads ROAS vs Website ROAS.** Meta-only, per
      user request: a Campaign → Ad Set → Ad drill-down where each ad's
      spend is cross-referenced against Shopify's ground-truth revenue for
      the SKU tagged in the ad's *name* (not a real Meta field — a
      convention the user is rolling out, e.g. `"❌FIG-05-007-RD_VID_..."`).
      - `server/src/routes/metaSkuAttribution.ts` (new, mounted at
        `GET /meta-sku-attribution`, its own top-level path since it reads
        from both `fact_ad_creative_performance` and
        `fact_shopify_line_items`): extracts a `FIG-...` token per ad name
        (tolerant of a leading emoji/junk prefix, confirmed against real ad
        names), then matches it against Shopify SKUs as a **prefix**, not
        exact-match — confirmed live that some ad tokens are a shorter
        family code shared by several variant SKUs (`FIG-01-029` alone
        matches 4 different color/size SKUs), so a prefix match sums
        revenue across all of them rather than silently missing 3 out of 4.
        Rolls up Campaign/Ad Set totals weighted (sum/sum), and
        website revenue/ROAS stay `null` (not `0`) for a group with zero
        SKU-tagged ads, distinct from a real measured zero.
      - **Directional, not literal per-ad attribution** — flagged with a
        caveat banner in the UI, not swept under the rug: if two ads share
        the same SKU tag, each shows that SKU's *entire* revenue for the
        range (not split between them), so a fresh, low-spend ad can show
        an extreme Website ROAS (confirmed live: a few real ₹2–7-spend ads
        showed 18,000x+ against a shared family's full period revenue) —
        this is exactly the "this ad's spend vs. that product's sales"
        comparison the user asked for, not a claim that this ad caused
        that revenue.
      - **Own page, nested in the sidebar** — not an accordion inside the
        Meta Ads page (that was the first cut; moved per follow-up
        request). `PlatformSidebar.tsx`'s `SidebarSelection` gained a
        `"meta-sku-attribution"` value rendered as a small "↳ SKU
        Attribution" link directly under the Meta Ads nav item (hidden in
        collapsed/icon-only sidebar mode, like every other label);
        `App.tsx` renders `MetaSkuAttributionSection` as its own top-level
        view when selected, reusing the global date range/margin/target
        ROAS bar exactly like every platform page.
      - **Campaign / Ad Set / Ad level switcher** with the **full standard
        metrics** at every level, not just the SKU comparison fields —
        Spend, Impressions, Clicks, CTR, CVR, CPC, CPA, Orders, alongside
        Ads Revenue/ROAS and Website Revenue/ROAS, all sortable, all
        weighted rollups (sum/sum, never averaged) when viewing Campaign or
        Ad Set level. Flat sortable tables per level (not the nested
        expand-tree from the first cut) so every column has room and
        matches the rest of the app's table conventions (`CampaignTable`,
        `AdsSection`). "Only show tagged ads" filters to rows/groups with
        at least one SKU match at whichever level is selected.
      - Verified live: 10 of 240 real ads already carry a SKU tag (the
        user's naming rollout is in progress) — confirmed exact at all
        three levels, including the Ad-level "Only show tagged ads" filter
        narrowing to exactly those 10; campaign-level rollups for matched
        ones show sane numbers (e.g. ₹7,27,896 website revenue / 26.90x
        website ROAS on one real campaign), unmatched rows correctly show
        "no SKU tag" / "—" rather than 0, confirmed via Playwright
        with zero console errors.
      - **4th tab: "SKU (true ROAS)"** — a second follow-up fix. The
        Campaign/Ad Set/Ad tabs each show a SKU's *entire* revenue against
        only *that row's own* spend, which distorts badly when several ads
        share one SKU tag (each shows the same revenue at a different,
        wrong ratio). This tab combines **every** ad carrying a given SKU
        — across all campaigns and ad sets — into one row, so Spend is the
        SKU's real combined total and Website ROAS is one honest number
        per product, not repeated at several conflicting values. Adds
        `adCount`/`campaignCount` for transparency (how many ads/campaigns
        fed into that row). `MetaSkuGroupRow` (new shared type) factors the
        same `MetaSkuPerformance` base the other three levels already use.
        Verified live: `FIG-05-007-RD` correctly combines 2 ads into
        ₹28.91 total spend (previously shown as two separate, much smaller
        per-ad numbers); `FIG-01-029` combines 3. Extreme ratios still
        appear for very-new/low-spend SKUs (flagged in the UI, same
        `>100x` warning styling as the other tabs) — that's the real
        Meta-spend-vs-all-channel-revenue ratio for a SKU with only a few
        rupees of tagged spend so far, not a bug.

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
