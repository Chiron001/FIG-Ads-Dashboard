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
      - **Product Name column** (3rd follow-up) on the SKU tab, fetched
        from Shopify. A SKU tag can prefix-match several distinct variant
        SKUs (see above) with different titles, so there's no single "the"
        product in general — shows the highest-revenue matching variant's
        title (the one actually driving the number in the row) with a
        "+N more" badge when more variants matched. The badge is laid out
        as its own flex item (`shrink-0`, sibling to a separately-truncating
        title span with `min-w-0`), not inside the title's own
        `truncate` — otherwise a long title silently swallows the "+N
        more" note as part of what gets ellipsized, which defeats the
        point of showing it. Verified live: `FIG-01-029` shows "Orilamp -
        Mini Lamp (Limited Edition) +4 more" (5 real variant SKUs share
        that family prefix).
      - **"Contains" search box** (4th follow-up), scoped to whatever
        level is active -- SKU/product name on the SKU tab, plus
        campaign/ad-set/ad name on the other three (placeholder text
        changes per level so it's clear what's actually searched).
        Client-side substring filter (case-insensitive, matching the same
        pattern `CampaignTable`/`ShopifyProductTable` already use)
        applied before sort, not a server round-trip. Verified live:
        "orilamp" matches on Product Name across multiple SKU rows;
        "058" matches on SKU alone, correctly narrowing to one row.
      - **"Total" row pinned to the top of the table** (5th follow-up),
        on all four tabs -- a weighted rollup (sum/sum, never averaged)
        over whatever's currently visible, so it always answers "total
        spend of the campaigns matching my search", not "total spend of
        everything". Recomputes live as search/"only tagged"/level
        change. Non-summable columns (name/SKU/status, and adCount/
        campaignCount on the SKU tab -- summing those would double-count
        ads/campaigns shared across multiple SKU rows) show "—"; the
        first column shows "Total (N)" with the visible row count.
        Deliberately placed as the first `<tbody>` row, not a `<tfoot>`
        row at the bottom (the existing convention in `CampaignTable`) --
        the user asked for it "on top" specifically, so it doesn't
        require scrolling past a long result set to see. Verified live:
        Campaign tab shows Total (24) unfiltered -> Total (19) when
        searching "dig", spend/impressions/clicks and every other summed
        column updating correctly; SKU tab shows Total (7) with Ads/
        Campaigns correctly "—" (not summed) and a real weighted Website
        ROAS (671.27x) across all matched SKUs.
- [x] **Shopify Sessions by ad platform (Google vs Meta), via `utm_source`.**
      User asked whether to connect GA4 to see per-product landing-page
      sessions split by ad platform — investigated live first: GA4 would
      need a new connector, service-account credentials, and an
      already-tracking property; Shopify Analytics already carries this via
      the `utm_source` ShopifyQL dimension on the existing connection, so
      built that instead (GA4 not connected).
      - `classifyUtmSource()` (`server/src/connectors/shopify.ts`) buckets
        raw utm_source values into `google` / `meta` / `other`, derived from
        this store's real observed values (live-queried): Meta's
        dynamic/multi-placement campaigns auto-tag utm_source with the
        *placement*, not one constant — `MetaAds`, `facebook`,
        `Instagram_Reels`, `Facebook_Mobile_Feed`, `ig`, `Threads_Feed`, and
        a dozen more all mean Meta; Google shows up as `google` or the
        shorthand `g`. Everything else (`kwikengage`, `chatgpt.com`,
        `wishlink`, null/direct, …) is a different channel entirely, not
        "unclassified" Meta/Google — bucketed `other`, never guessed.
        5 regression tests (`shopify.test.ts`) pin the classifier against
        every real value seen live.
      - **Row-cap-safe by construction.** A single `GROUP BY
        landing_page_path, utm_source` query blows past ShopifyQL's
        1000-row cap even over a 7-day window (confirmed live) — the long
        tail of one-off utm_source values multiplies row count. Fixed by
        filtering to one platform *before* grouping (`fetchTotalSessionsByPlatform`
        / `fetchProductSessionsByPlatform`, two parallel queries each with a
        WHERE fragment mirroring `classifyUtmSource`), which collapses row
        count back down to the size of the product catalog — confirmed
        live: 395 rows (Meta) / 178 rows (Google) over a 90-day range,
        vs. 1000 (capped) for the combined query even at 7 days.
      - Site-wide `googleSessions`/`metaSessions` added to
        `ShopifyOrderSummary` (two new KPI tiles) and per-product
        `googleSessions`/`metaSessions` added to `ShopifyProductRow` (two
        new sortable columns on the Products table) — same
        graceful-degradation pattern as the existing `sessions`/`cvr`
        fields (ShopifyQL failure → null → "—", rest of the page still
        renders). A caveat banner in the UI states this is
        utm_source-classified, not platform-verified attribution.
      - Verified live (30-day range): site-wide 1,26,877 sessions splits to
        10,322 Google / 73,426 Meta; per-product rows sane and additive
        (e.g. Wavy Floor Lamp - Crimson Red: 8,488 total → 294 Google /
        7,087 Meta), confirmed via Playwright with zero console errors.
- [x] **Meta Creative Performance.** A third Meta-only sub-view, sibling to
      SKU Attribution rather than merged into it (same nested-under-Meta-Ads
      sidebar pattern, own "↳ Creative Performance" nav item). Parses the
      user's full creative naming convention out of each ad's name --
      `$[SKU]_[IMG/VID/CRSL/GIF/UGC]_[Aesth/Price/Gift/Occ/Qlty/Featr/Lif/
      Exp]_[POV/Demo/BeforeAfter/Testi/Unbox]_[M/F/NA]_v(n)_n(n)$` -- into
      structured format/angle/style/gender/version/variant fields, on top of
      the same SKU token SKU Attribution already extracts.
      - `server/src/util/creativeTag.ts`'s `parseCreativeTag()` is
        deliberately tolerant of gaps: real tagging (like the SKU rollout
        before it) is expected to skip optional fields inconsistently, so
        each underscore-delimited token inside the `$...$` wrapper is tried
        against whichever categories haven't been filled yet, in spec order
        -- a token that fits nothing remaining is skipped, not treated as a
        parse failure. Validated against all ~10 real live Meta ad names
        that already follow the bare nomenclature (pre-`$...$`) as they'd
        parse once wrapped -- e.g. `FIG-01-035-BG_GIF_Featr_v1` (style/
        gender omitted, jumps straight from angle to version) and
        `FIG-01-048-OR_GIF_Qlty_Demo_NA_v1` (every field present, including
        `NA` gender) both resolve correctly. 20 unit tests in
        `creativeTag.test.ts`.
      - **Per the user (2026-08-16): none of this account's ~240 live Meta
        ad names carry the required `$...$` wrapper yet** -- confirmed live,
        zero rows match. That's an upcoming rename on the user's end, not a
        bug here; the route/UI both handle the resulting all-zero state
        gracefully (`taggedAds: 0`, empty Product tab with its normal empty
        state, no crash) and the coverage line says so explicitly ("none
        yet; this lights up once ad names start wrapping the tag").
        End-to-end verified live by temporarily wrapping 4 real ad names in
        `$...$` directly in Postgres, confirming the parsed fields/rollups/
        Product grouping came through correctly via curl and Playwright,
        then restoring the originals (confirmed 0 `$`-containing names
        remain).
      - **Four tabs**, same Campaign/Ad Set/Ad/Product-rollup shape as SKU
        Attribution: Campaign and Ad Set roll up spend/CTR/CVR/ROAS only
        (creative attributes don't aggregate meaningfully at those levels);
        **Creative (Ad)** is the flat, sortable, per-creative table with the
        new Format/Angle/Style/Gender/Version/Variant columns alongside
        Status and the full standard metric set -- this is the "which
        creative performed best" view, sortable by any column; **Product
        (true ROAS)** combines every creative sharing a SKU into one row
        (same true-ROAS fix as SKU Attribution's SKU tab), with a
        `Creatives` count column and each SKU clickable straight through to
        the Creative tab pre-filtered to it -- the "this product has N
        creatives, here's how each is performing and its status" view the
        user asked for.
      - **"Which [format/angle/style/gender] performs best" panel**, shown
        only on the Creative tab, above the table -- groups the currently
        visible (searched/filtered) creatives by whichever dimension is
        selected and shows weighted spend/CTR/CVR/Ads ROAS/Website ROAS per
        value, sorted by spend desc, computed client-side (no extra
        round-trip). Untagged creatives group under "Not tagged" rather
        than being dropped. This is the genuinely new "deep analysis" layer
        the flat per-ad table alone doesn't give -- comparing creative
        *types*, not just individual ads.
      - Same conventions as every prior section: weighted rollups (sum/sum,
        never averaged), null (not 0) for unmatched/untagged, "contains"
        search scoped per level, a pinned Total row reflecting the current
        filter, and the amber "directional" / green "true number" caveat
        banners with cross-links between tabs.
- [x] **UI/UX visual pass — "Midnight Atelier" design system.** A full
      restyle against a detailed design spec, scoped to `/web` only (no
      data/route changes). Confirmed with the user up front: dark-only,
      matching the original build spec's deliberate choice — no
      `[data-theme="light"]`, all the polish spent on one theme rather than
      split across two.
      - **Tokens, not a rewrite.** The existing `@theme` CSS-var names
        (`surface-*`, `ink-*`, `border`, `platform-*`, `status-*`) kept their
        names and just got new values — every one of the ~20 already-built
        components reskins automatically through the Tailwind classes they
        already use, with zero risky rename sweep. New tokens are additive:
        `--color-accent` (a warm amber-gold, deliberately derived from FIG's
        own lighting product line, not picked arbitrarily), glass tokens,
        `--font-display`/`--font-sans`/`--font-mono`, motion timing vars.
        Palette re-validated with the dataviz skill's `validate_palette.js`
        (not eyeballed) — caught and fixed two real regressions: Myntra's
        nudged amber fell outside the dark-mode lightness band (reverted to
        its original value, which passes), and the new `ink-muted` measured
        3.72:1 against `surface-1` (below the 4.5:1 text floor) — retuned to
        4.98:1.
      - **Glass only on floating layers** (spec's governing rule): the top
        bar, the date-range dropdown, the command palette, the KPI explain
        drawer, the mobile nav drawer, the Spend Flow hover tooltip. Tables,
        KPI numbers, and chart plot areas all stay solid — a number never
        renders on top of blur. `prefers-reduced-transparency` drops every
        `.glass` surface to solid via one CSS rule.
      - **The signature element — Spend Flow.** Total Spend → each connected
        platform → Revenue, one lane per platform sized by its real spend
        share (linear, not sqrt-compressed — the spec's "proportional"
        claim stays literal), filled with a left-to-right gradient from the
        platform's own color into a red→amber→green tone keyed to that
        platform's ROAS vs. Target ROAS. Hand-rolled SVG (no D3/visx
        dependency) — the spec explicitly allows this simpler form ("an
        elegant animated proportional-flow bar") over a full multi-width
        Sankey, which would need revenue and spend to reconcile on
        different scales for no real payoff. Animated draw-in
        (`scaleX`, staggered per lane, ~1.2s), hover dims other lanes and
        shows a glass tooltip (spend/revenue/ROAS/profit), click navigates
        to that platform, and a text legend (name + spend + ROAS) means
        color is never the only signal even for a lane too thin to hold its
        own inline label. Shown on every ad-platform page, hidden on
        Shopify/the two Meta sub-views.
      - **Typography**: Fraunces (display serif) on the dashboard title and
        section headers only; Inter everywhere else; JetBrains Mono
        reserved for hero numerals (KPI tile values, the flow band's
        totals) — dense table figures stay on Inter + tabular numerals,
        where mono digits get visually cramped at 13px.
      - **Motion**: KPI tiles count up on first load/range change (~600ms
        ease-out, `useCountUp`) and stagger in 40ms apart; hover lifts KPI
        cards 2px and tints table rows with the accent color; one shared
        easing curve (`cubic-bezier(0.22,1,0.36,1)`) everywhere.
        `prefers-reduced-motion` is enforced two ways: a blanket CSS rule
        zeroing all animation/transition durations, plus a
        `usePrefersReducedMotion` hook so JS-driven animation (the count-up
        loop, the flow band's draw-in) skips straight to the final state
        rather than just visually snapping through a zero-duration CSS
        transition.
      - **Fixed a real count-up bug found in testing, not shipped assuming
        it worked.** Two independent issues: (1) a `requestAnimationFrame`
        `start` timestamp captured via a separate `performance.now()` call
        (rather than the first callback's own `now`) could read *after*
        that first callback's timestamp, producing a negative elapsed time
        and a garbage negative eased value on frame one; (2) syncing the
        animation's start value from a `useEffect` left a one-render gap
        where the old (often still-`undefined`) display value was showing,
        so the caller's fallback flashed the *final* number for a frame
        before the count-up visibly restarted from 0 underneath it. Root-
        caused with an in-page `requestAnimationFrame` sampler (bypassing
        Playwright round-trip jitter, which had been muddying earlier
        attempts to reproduce it) against a real production build, not the
        dev server. Fixed by capturing `start` from the first tick's own
        timestamp and moving the start-value sync to render time (React's
        documented "adjust state during render" pattern) instead of an
        effect. Verified clean and monotonic 0→target afterward.
      - **Command palette (⌘K)**: glass overlay, navigate to any
        platform/section or jump to a date-range preset by typing. Scoped
        to navigation, not a campaign-name search index — indexing every
        campaign across every platform client-side is disproportionate
        machinery for what's fundamentally a navigation shortcut.
      - **"Explain this number"**: click any KPI tile to open a glass
        drawer with its formula and a one-line description
        (`metricExplainers.ts`) — trust through transparency. Scoped to the
        formula, not the raw rows behind it (that would mean threading raw
        campaign/order data through every section just to power this).
      - **Sync status dot** in the top bar (green/amber/red from
        `lastSync.status`), pulses briefly on `refreshKey` change (i.e. just
        after a sync completes) rather than tracking true in-flight state,
        which would need lifting each section's own "Sync now" trigger up a
        level for a purely cosmetic win.
      - **Responsive**: sidebar collapses to a glass overlay drawer below
        the `sm` breakpoint (hamburger trigger in the top bar, backdrop-tap
        or pick-a-destination both dismiss it) — the original layout simply
        didn't reflow below ~640px (the fixed-width sidebar ate most of a
        375px screen); this was caught in the mobile screenshot pass, not
        assumed to already work.
      - **Verified**: full monorepo build + 87 server tests green;
        `oxlint` clean (one pre-existing warning, not introduced here);
        colorblind-safe pairing preserved everywhere it already existed
        (status pills, delta ▲/▼ arrows) and extended to the flow band's
        legend; keyboard focus rings (accent, 2px, `:focus-visible`)
        confirmed visible via a real Tab-through screenshot; mobile drawer,
        command palette, KPI drawer, and `prefers-reduced-motion` all
        screenshot-verified via Playwright with zero console errors.
      - **Descoped, explicitly** (spec is large; these didn't make this
        pass): PNG chart export, a comfortable/compact density toggle, a
        full command-palette campaign-name index, and per-chart screen-
        reader table fallbacks.
- [x] **UI/UX iteration 2 — a batch of 17 targeted changes** against the
      redesign above, driven by direct screenshot annotations. Both `/web`
      and `/server` changed this round (two of these needed a real new
      join, not just styling).
      - **Date range + comparison merged into one control with an Apply
        button** (`DateRangePicker.tsx`) -- picking a preset or a
        comparison period used to fire a fetch immediately; now both are a
        draft until Apply, so changing your mind about one doesn't cost a
        round-trip for the other. Added a "Today" preset.
      - **KPI tiles are glass now, with a per-platform gradient tint** --
        an explicit reversal of the first pass's "data surfaces stay
        solid" rule, on direct instruction. `color-mix()` builds the tint
        from each card's own accent color (or the app accent as a
        fallback) so it stays correct without a second color prop.
      - **True (website) ROAS added to the Products section**, both
        platforms. Neither platform's catalog `product_item_id` is the
        Shopify SKU string -- confirmed live: Meta's is usually
        `/products/{handle}#product` (sometimes a bare numeric catalog id
        instead, which the regex simply doesn't match rather than
        guessing), Google's is `shopify_zz_{productId}_{variantId}` (the
        numeric halves of the `gid://shopify/...` ids). Both correctly
        decode into a real Shopify identifier and join against
        `fact_shopify_line_items` (`websiteRevenueForProductItem` in
        `server/src/routes/metrics.ts`) -- verified live: 64 of 405 Meta
        products and 27 of 35 Google products matched. Website
        Revenue/ROAS only populate at SKU-level grouping (a category
        roll-up mixes join keys). Also fixed a real bug this surfaced: the
        uncategorized-product group-key fallback was the literal string
        `"—"`, which rendered as-is in the Category/Product column.
      - **Portfolio analysis Pareto chart resized to half-width**, paired
        with a new **Product-wise Catalogue Spend** bar chart (Meta only)
        showing products averaging over ₹100/day spend, colored by ROAS.
        Both extracted into reusable `ParetoChart.tsx` / `RankedBarChart.tsx`
        so the same two chart shapes now back four different sections
        instead of being rebuilt per page.
      - **Removed the generic Ad Sets & Ads table from Meta's page** --
        redundant with Creative Performance's per-creative view, which
        replaced it. Google keeps its Ad Groups & Ads table (no equivalent
        page exists for it).
      - **SKU Attribution: a "Top SKUs by spend" bar chart + 8 summary
        cards** (Spend/Clicks/CPC/CPA/Meta Revenue/Ads ROAS/Website
        Revenue/Website ROAS) built entirely from data the route already
        returned -- no backend change needed. Click a bar to pin the
        cards to that SKU; nothing selected shows the total across every
        matched SKU. Added an "N of M SKUs at/above target ROAS" stat,
        the concrete tie-in for the new 5.5x target.
      - **Creative Performance rebuilt around one flat, creative-grouped
        table** instead of four Campaign/Ad Set/Ad/Product tabs -- every ad
        sharing the exact same parsed tag (SKU + format + angle + style +
        gender + version + variant) is one row, combined across however
        many ads/campaigns it's placed in. Website Revenue is taken once
        per group, not summed across its ads (the same SKU-sharing
        distortion the rest of the app already guards against, just at a
        new grain). A "Top creatives" bar chart sits above it, rankable by
        spend or either ROAS. The Product tab was dropped outright -- SKU
        Attribution's enhanced true-ROAS view already covers that need,
        so keeping a second copy here was the redundancy the user asked
        to cut.
      - **Target ROAS default raised to 5.5x** everywhere a default is
        read from: the client fallback, the server `.env` default, and
        the actual Railway `TARGET_ROAS` variable (was explicitly set to
        4, which would have silently overridden the code change --
        checked and updated via `railway variables --set`, not assumed).
      - **No more em dash as an empty-value placeholder.** `format.ts`'s
        `EMPTY` constant (the single source nearly every table cell
        renders through) changed from `"—"` to `"N/A"`, plus ~15 more
        hardcoded occurrences across components that didn't route through
        it. Left untouched: em dashes used as actual sentence punctuation
        in prose/banners (that's just how people write, not a
        placeholder) and the CI-range en dash in `statsFormat.ts`
        (different character, different job). Favicon replaced too -- the
        old one was a generic abstract mark that didn't read as FIG's;
        new one is a simple lowercase "f" in the app's own amber accent.
      - **Fonts: Montserrat (primary, headings/nav/hero numerals) + Lato
        (secondary, body/table text)** -- replaces the first pass's
        Fraunces/Inter/JetBrains Mono trio, per explicit "use 2 fonts."
      - **Info-button pattern replacing full-width caveat banners**
        (`InfoNote.tsx`) -- a small "i" trigger opens a glass popover with
        the same text instead of a permanently-visible bar. Applied across
        `AttributionBanner`, Products, SKU Attribution, Creative
        Performance, and Shopify.
      - **Sidebar collapse toggle moved to the top**, next to the logo
        (was buried at the bottom). Fixed a real gap the redesign left
        behind: Meta's SKU Attribution / Creative Performance sub-items
        vanished entirely in collapsed (icon-only) mode -- now render as
        small icon-only buttons with a tooltip, reachable at either width.
      - **Shopify page: blended ROAS/ACOS + a product-revenue Pareto
        chart.** ROAS/ACOS here are the one deliberate exception to "never
        sum platforms" -- Google + Meta spend combined against this page's
        real website revenue, because "what did all ad spend return on
        the store" is genuinely the question on this specific page (the
        rest of the app still never blends).
      - **Verified**: full monorepo build + 87 server tests green (5 more
        than the first pass's count came from work already logged);
        oxlint clean; live-curled both platforms' new website-revenue
        matching before wiring the frontend to it; re-verified the
        creative-grouping logic against real tagged data (temporarily
        wrapping 3 ads in `$...$` in Postgres, same verification pattern
        as the Creative Performance feature itself, then restoring);
        screenshot-checked the merged date/comparison picker, the
        collapsed-sidebar fix, an open InfoNote popover, and the paired
        Pareto/catalogue-spend charts, all with zero console errors.
- [x] **UI/UX iteration 3 — layout fix, glass legibility, comparison mode
      everywhere, and a new Shopify statistics sub-section.** Both `/web`
      and `/server` changed (the new sub-section needed a real backend join).
      - **Portfolio analysis moved above Campaigns** in the per-platform
        page (`PlatformSection.tsx`) -- was rendering below it.
      - **TopBar glass background bumped from 60% to 92% opacity**
        (`--glass-bg` in `index.css`) -- confirmed live that the Spend Flow
        band's vivid orange was bleeding through enough on scroll to make
        the title/search/Margin/Target ROAS text illegible. Still glass
        (inset highlight + blur unchanged), just solid enough that
        legibility never depends on what's scrolled underneath it.
      - **"Compare to" now applies everywhere, not just the primary KPI
        row.** New shared `web/src/lib/delta.ts` (`computeDelta`) and
        `web/src/components/DeltaBadge.tsx` (▲/▼ + signed %, colorblind-safe
        via arrow+color, never a misleading 0%), reused across every
        section that touches comparison: `CampaignTable` (per-row and Total
        row Spend/ROAS deltas), `PortfolioView` (a revenue-vs-comparison
        summary line above the Pareto chart), `ProductsSection` (per-row
        Spend/Revenue deltas), `ShopifySection` (every applicable KPI tile
        + a Pareto revenue comparison line), `ShopifyProductTable` (per-row
        Revenue delta). Comparison charts show a compact "current vs.
        comparison, delta%" summary line rather than overlaying two
        time-series on one axis, which would conflate two different
        campaign/product rankings.
      - **New Shopify sub-section: Product Quadrants** (sidebar: Shopify →
        ↳ Product Quadrants), a statistical parallel to Meta's SKU
        Attribution.
        - **Backend** (`GET /shopify/product-quadrants`): joins combined
          Google + Meta ad spend to every Shopify product, decoded and
          re-keyed at the *product* level (not variant) -- Google's
          `shopify_zz_{productId}_{variantId}` collapses to
          `gid://shopify/Product/{productId}` (variant dropped, matching
          `fact_shopify_line_items.product_id` directly), Meta's
          `/products/{handle}#product` matches by handle. Same decoding
          approach as Products' Website ROAS, duplicated rather than
          imported since the source patterns are private to `metrics.ts`.
        - **POAS** (Profit on Ad Spend) = Gross Profit ÷ Ad Spend, where
          Gross Profit = Revenue × 65% (COGS modeled at a flat 35% of
          selling price -- no real per-product cost data exists yet, so
          this is explicitly a modeled figure, not an accounting one).
        - **4-quadrant classification**, split at the cross-sectional
          median (not an arbitrary fixed threshold) across active products
          this period: Q1 low spend/high sales (scale opportunity), Q2
          high spend/high sales (star performers), Q3 high spend/low sales
          (reassess), Q4 low spend/low sales (low priority). Products with
          neither spend nor revenue are excluded from classification, with
          the excluded count surfaced rather than silently dropped.
        - **Statistics**: Pearson correlation (`pearsonCorrelation`)
          between site-wide sessions and revenue, and separately between
          *marketing* (Google+Meta) sessions and revenue, one point per
          product; a cross-sectional OLS (`linearRegression`, revenue ~
          spend across products, not a time series) powers a risk-modeling
          scenario table projecting incremental revenue/gross profit/net
          return at +₹10k/25k/50k of additional spend, with the r² and a
          low-fit warning always shown alongside so a weak fit is never
          presented as a confident forecast.
        - **Frontend** (`ShopifyProductQuadrantsSection.tsx`): a quadrant
          scatter chart (bubble size = impressions, reference lines at the
          two medians), 4 quadrant summary cards, a POAS-ranked bar chart
          paired half-width with a spend-share donut by quadrant, two
          half-width correlation scatters, the risk-modeling panel, and a
          full sortable/filterable product table. New `ProductQuadrant*`
          types in `shared/src/index.ts`. Quadrant colors reuse the app's
          existing validated status palette (good/critical/info/warning)
          rather than inventing a new categorical set.
      - **Verified**: full monorepo build (`tsc`, both workspaces) and the
        87-test server suite green; the new endpoint live-curled against
        real data (153 active products, quadrant counts Q1 32/Q2 44/Q3
        32/Q4 45, sessions-vs-revenue r=0.87 n=149, marketing-sessions-vs-
        revenue r=0.85 n=149, spend/revenue regression r²=0.42) before
        wiring the frontend to it; deployed to Railway (server) and
        confirmed via Vercel's own deployment log that production picked
        up the same commit.
- [x] **Shopify Products table: full 3-column comparison + POAS/ROAS/ad
      spend/ATC/bounce rate.**
      - **Comparison mode expands into 3 sub-columns** (Now / Prior / Δ%)
        for every numeric column, not just Revenue -- a 2-row grouped
        header (`colSpan=3` per metric). Product stays sticky-left so it's
        still visible scrolling the now much wider table.
      - **POAS column**: Gross Profit ÷ combined ad spend (Gross Profit =
        revenue × 65%, same COGS=35% convention as Product Quadrants).
      - **Two separate ad-spend columns**, kept distinct on request since
        they measure different things: **SKU Attributed Spend** (Meta
        spend from ads whose *name* carries the product's SKU tag, same
        mechanism as SKU Attribution) and **Meta Catalog Spend** (matched
        via the product catalog instead, an exact handle match) --
        additive, not double-counted, since they're different Meta ad
        mechanisms.
      - **ROAS column**: Revenue ÷ (SKU Attributed Spend + Meta Catalog
        Spend).
      - **ATC and Bounce Rate columns**: both live via new ShopifyQL
        queries (`ShopifyConnector.fetchProductEngagement`) --
        `sessions_with_cart_additions` and `bounce_rate`, confirmed against
        the real schema before building; bounce rate is session-weighted
        when multiple raw landing paths collapse into one product handle.
      - **Verified**: full monorepo build clean, 87/87 server tests green,
        new fields live-curled against real data (120 products, 63 with
        matched ad spend, 98 with ATC>0, 116 with a bounce rate) across two
        different date ranges before wiring the UI; deployed to Railway and
        confirmed live.
- [x] **Settings page (API integrations + editable COGS/EBITDA costs) and a
      whole-site password gate.**
      - **Settings page** (sidebar: Admin → Settings), backed by a new
        singleton `app_settings` table (`db/migrations/0008_app_settings.sql`):
        - **API Integrations**: connected/not-connected status + which env
          var(s) each platform needs -- deliberately never the actual
          key/token values, since this page is reachable by everyone the
          site password is shared with (confirmed explicitly before
          building, given the alternative meant handing out real Meta/
          Google/Shopify credentials to that same audience).
        - **Products COGS %** is now editable and persisted
          (`server/src/db/appSettings.ts`'s `getCogsRate()`), replacing the
          hardcoded 0.35 constant that used to live in `shopify.ts` --
          both Products (POAS/ROAS) and Product Quadrants read the live
          value on every request.
        - **Additional Costs (EBITDA)**: an editable list of {name, type,
          value} cost line items -- % of revenue, flat per order, or flat
          for the whole selected range -- persisted alongside COGS.
        - **A live EBITDA preview** (Revenue − COGS − blended Google+Meta
          ad spend − Additional Costs) for the globally selected date
          range, reflecting unsaved edits before Save so the effect is
          visible immediately.
      - **Whole-site password gate**, `SITE_PASSWORD` (defaults to
        "55555"): a shared-secret header (`X-Site-Password`), checked on
        every backend request except `/auth/check` (the check itself) and
        `/health` (Railway's own probe) -- see
        `server/src/middleware/siteAuth.ts`. The frontend
        (`PasswordGate.tsx`, wraps `<App/>` in `main.tsx`) shows a password
        form until entered correctly, stores it in localStorage, and
        attaches it to every subsequent API call; a stored password is
        silently revalidated against the server on every reload, so
        rotating `SITE_PASSWORD` bounces stale browsers back to the form.
        Deliberately simple -- one shared secret, not per-user accounts,
        matching what was actually asked for (keep a shared link from being
        casually stumbled into, not defend against a determined reader of
        the JS bundle).
      - **Verified**: full monorepo build clean, 87/87 server tests green;
        migration applied to the live DB; the whole gate + settings CRUD
        live-curled end to end (401 without the header, 200 with it,
        GET/PATCH persists and is reflected in Products' POAS immediately,
        a CORS preflight confirmed the browser is allowed to send the
        custom header cross-origin) before wiring the frontend to it.
        Deployed frontend first, then backend (so no window existed where
        the backend required the header but the live frontend didn't send
        it yet); settings reset back to defaults (35% COGS, no additional
        costs) after the verification pass, since those PATCH calls hit the
        live database.
- [x] **Shopify Projection Sheet**: monthly unit targets vs. live pace
      (sidebar: Shopify → Projection Sheet), one row per ACTIVE Shopify
      product via a new live-catalog connector method
      (`fetchAllActiveProducts()`, paginated GraphQL `products()`) -- not
      limited to products with sales history, so a brand-new product still
      gets a row to plan against.
      - **Unit Target and Price are the only user-entered fields**,
        persisted to a new `product_targets` table keyed by product + month
        (`db/migrations/0009_product_targets.sql`), editable inline with a
        Save-changes bar (dirty-row tracking).
      - **Everything else is computed live** on every request, per the
        requested formulas: Target Revenue = Unit Target × Price; Required
        Traffic = Unit Target ÷ Previous Month CVR (CVR = units ÷ sessions
        -- confirmed against the attached spreadsheet's own numbers, since
        the request text's literal "sessions ÷ units" doesn't reproduce
        the spreadsheet's own Traffic Required figures); CPM = Meta
        product-catalog spend/impressions for the previous month (reuses
        `fetchAdMetricsByProductKeys`, exported from `routes/shopify.ts`);
        Minimum Ad Spend Required = (1000 ÷ CPM) × Required Traffic × 0.8;
        Planned DRR = Unit Target ÷ days in this month; Current DRR = MTD
        units sold ÷ today's day-of-month; plus two "projected month end"
        columns (units and sessions, pace-extrapolated) and an Insight
        column implementing the described decision tree (on pace + traffic
        healthy → on track; on pace but traffic short → increase sessions;
        behind pace with traffic also short → increase sessions; behind
        pace despite healthy traffic → review ads/creative).
      - CPM currently reads N/A for most products -- Meta's per-product
        catalog sync only started 2026-08-12, so July has no matched data
        yet. A real data-coverage gap, not a bug; will resolve on its own
        as more full months accumulate.
      - MTD session breakdown (Meta paid / Google paid / rest / total /
        Meta share) reuses the connector's existing per-product session
        queries unchanged -- already generic to any date range.
      - Table groups its ~20 columns by color-tinted header bands
        (target-impact / pace / actuals / session-breakdown / projection)
        for scannability at that width; sticky product column; a KPI
        summary row (products with a target, total target units/revenue,
        MTD units, on-track vs. needs-attention counts).
      - **Verified**: full monorepo build clean, 87/87 server tests green;
        live-curled end to end against real data (176 active products)
        including a full set-target → recompute → reset-to-null round trip
        (unitTarget=150, price=3299 correctly produced targetRevenue=
        494850, requiredTraffic=12150, plannedDrr=4.84, and an insight
        verdict matching the actual pace) before wiring the frontend to
        it; deployed frontend first, then backend, and confirmed live.
      - **Follow-up**: Unit Target and Price can now also be one-click
        filled instead of typed -- a "prev: N" hint under Unit Target sets
        it to last month's actual units sold (`previousMonthUnitsSold`,
        already computed for the CVR calc, now also exposed on the row);
        a "shop: ₹N" hint under Price sets it to Shopify's live selling
        price (new `shopifyPrice` field -- the catalog query now also
        fetches `priceRangeV2.minVariantPrice` per product). A 3-way
        filter (All / Complete / Missing Target/Price, each with a live
        count) sits above the table to hide products that already have
        both fields set, or show only the ones still missing something.
- [x] **Fixed a real Google Ads undercounting bug**: the main campaign
      query (`FROM ad_group`) structurally excludes Performance Max
      campaigns, which have no ad groups at all (asset_groups instead) --
      confirmed against the user's own screenshot, our synced numbers were
      short by ~2.5-3x on days with real PMax spend. Fixed with a second
      `FROM campaign` query that fills in exactly the (campaignId, date)
      gaps the ad_group query missed, verified to an exact rupee/click/
      impression match against Google's own console, and backfilled 30
      days of history. See `server/src/connectors/google.ts`.
- [x] **Shopify Products table**: dropped the Vendor column; added an
      always-on "Performance" column -- a colored verdict badge per
      product (Growing/Declining/Stable, sub-classified by driver:
      traffic, conversion, or efficiency) comparing against the
      immediately-adjacent previous period regardless of the top bar's
      "Compare to" setting. Click a badge for a side-drawer with the full
      rule-based analysis (not an AI call -- a deterministic decision tree,
      same philosophy as the Projection Sheet's Insight column) plus every
      underlying metric's current-vs-previous delta. See
      `web/src/lib/productInsight.ts`.
- [x] **Light/dark theme toggle**, "Appearance" control at the bottom of
      the sidebar -- reverses the earlier "dark-only, deliberately, no
      toggle" decision on explicit request. Light theme is styled after
      Apple's own light interfaces: the #f5f5f7 page gray + white cards,
      San-Francisco-adjacent ink grays, hairline borders, soft diffuse
      shadows, and Apple's systemBlue (#0071e3) as this theme's accent
      (deliberately not the dark theme's amber, carried over unchanged --
      Apple blue is core to reading as "Apple style," and the amber
      measures too light for on-accent button text once the surface
      flips from near-black to near-white). Status colors got their own
      light-mode-specific values too (the dark theme's brighter tones
      measure poorly as text on white); platform brand colors and every
      chart-fill hex are deliberately unchanged in both themes (Recharts
      SVG props don't reliably resolve CSS custom properties, a standing
      finding from earlier in this build; a full per-theme chart-palette
      re-validation was out of scope for this pass). `data-theme` on
      `<html>`, applied synchronously before React mounts so there's no
      flash of the wrong theme, persisted to localStorage (a deliberate,
      explicit exception to this app's usual no-localStorage convention
      for UI state). See `web/src/lib/theme.ts` and `index.css`.
      Screenshot-verified end to end (password gate, Google Ads, Shopify,
      Settings, collapsed sidebar, reload-persistence) with zero console
      errors before shipping.
- [x] **Frozen headers on every big data table** (2026-08-18): scrolling a
      table used to lose the header row entirely, making a wide table's
      columns unreadable a few rows in. Root cause was a well-known CSS
      trap, not a missing `position: sticky` -- these tables' horizontal
      scroll wrapper (`overflow-x-auto`) unavoidably computes `overflow-y`
      to `auto` too per spec, which makes *that* div "the nearest scroll
      container" for sticky purposes instead of the page, and since the
      div never itself needs to scroll vertically its sticky children have
      nothing to stick to -- confirmed live that no `overflow-y` value
      (`hidden`/`clip`/`visible`) fixes it, because all of them still
      establish a scroll container. Fix: stop fighting it -- each table's
      wrapper is now an intentional, bounded scroll pane
      (`.table-scroll-pane`, `max-height: 65vh` with its own scrollbar,
      same "frozen row" pattern as Google Sheets/Notion/Airtable) with the
      header sticky relative to itself. Applied to all 8 big tables
      (Campaign, Products, Ads, Meta Creative Performance, Meta SKU
      Attribution, Shopify Products, Product Quadrants, Projection Sheet);
      the two small non-scrolling tables were deliberately left alone.
      Along the way, fixed two more real bugs the fix surfaced: the
      Projection Sheet's color-tinted group headers used a translucent
      `rgba` background (fine for body cells, meant to blend with hover
      states) that let scrolled-past rows bleed through once that same
      background sat on a *sticky* cell -- now layered over an opaque
      base for headers only; and the comparison-mode two-row header's
      `--thead-row-height` offset constant was a guessed `34px` that didn't
      match row 1's real height (`32.5px`, since row 2 deliberately uses
      smaller padding/font), leaving a 1.5px gap a row peeked through.
      Screenshot-verified in both themes, single- and two-row headers,
      realistic incremental scrolling. See `web/src/index.css` and the
      `table-scroll-pane`/`sticky-thead` usages across `web/src/components/`.
- [x] **Light theme depth pass** (2026-08-18): the first light-theme cut
      read as flat -- page (`#f5f5f7`) and cards (`#ffffff`) measured too
      close in tone for cards to visibly lift off the page, no matter how
      the shadow was tuned. Deepened the page to `#e9ebef` (cards stay
      crisp white) so the tone gap itself carries most of the depth cue;
      strengthened glass opacity/shadows to match; and gave `KpiTile`'s
      "glass sheen" diagonal highlight (previously a hardcoded
      `rgba(255,255,255,0.06)`, invisible on a white card) its own
      light-mode value via the same `--card-sheen-*` tokens the dark theme
      already used. See `index.css`'s `:root[data-theme="light"]` block.
- [x] **Seven UI/UX fixes from screenshot feedback** (2026-08-18):
      - **Date range dropdown made solid**: it floats directly over busy KPI
        tiles/chart content with no dimmed backdrop behind it, so `.glass`'s
        translucency there just read as illegible bleed-through, not an
        intentional glass layer (unlike the command palette, which has a
        dedicated backdrop). Now a plain solid card; its internal dividers/
        inputs, previously hardcoded `border-white/10`/`bg-black/20`
        (silently broken in light theme too, since white-on-white is
        invisible), now use the regular theme-aware border/surface tokens.
      - **Projection Sheet's Insight badge is click-to-open, not hover**: was
        a native `title` tooltip (easy to miss, unusable on touch); now a
        small click-triggered popup (`ProjectionInsightDrawer.tsx`) with the
        product name, verdict badge, and full message.
      - **Portfolio analysis Pareto chart gained a Spend/Revenue toggle**,
        on both Google and Meta Ads pages, and the section now **defaults to
        open** (was collapsed) -- required widening `ParetoPointDTO`/
        `ParetoInput` (shared + server) to carry `spend` alongside `revenue`
        per point; ranking/80%-crossing logic is still always revenue-based
        (spec §6a) since `ParetoChart` already re-sorts/re-cumulates
        client-side from whichever field is selected, so this needed no
        backend logic change. Google's Pareto is now also **half-width**,
        matching Meta's layout -- paired with "Profit contribution ranking"
        (moved up from a full-width row below) instead of full-width alone;
        Meta keeps catalogue spend in that slot and contribution ranking
        stays a separate full-width row below, unchanged. See
        `web/src/components/PortfolioView.tsx`.
      - **Sidebar Settings moved to the bottom**, directly above the
        Appearance toggle, instead of stranded mid-list with a long empty
        stretch below it (`<nav>` is now a flex column, Settings' wrapper
        gets `mt-auto`).
      - **Shopify Product Quadrants' "Ad spend share by quadrant" donut
        redesigned**: was a small fixed-200px donut + a thin 4-row %-only
        legend, leaving much of the card empty next to its taller sibling
        panel. Now a bigger donut with in-slice % labels and a richer
        legend (product count, spend, POAS per quadrant) that fills the
        card properly.
      - **Sidebar is a fixed dark navy (`#003466`) brand rail even in light
        theme**, explicit request -- only the main content area follows the
        theme toggle. New `--sidebar-*` tokens (bg/border/ink/active/hover)
        default to the existing surface/ink tokens in dark mode (no visual
        change there) and are overridden to navy + light-on-navy text in
        `:root[data-theme="light"]`; `PlatformSidebar.tsx` now references
        these instead of the app-wide `surface-*`/`ink-*` tokens directly.
- [x] **Fixed Meta Creative Performance: 0 tagged creatives despite the
      "$...$" rollout actually being live** (2026-08-19). `isTaggedCreative`
      required both SKU *and* format inside the "$...$" wrapper -- but
      confirmed live against the real account that the rollout that's
      actually shipping is a bare `$FIG-05-007$` (SKU alone, nothing else),
      not the full `$SKU_FORMAT_ANGLE_STYLE_GENDER_vN_nN$` sequence the
      written spec describes; the descriptive words (Video/Image/UGC) are
      still free text outside the wrapper. Every one of the ~50 already-
      tagged ads was therefore reading as untagged. Fixed by requiring only
      the SKU (`server/src/util/creativeTag.ts`) -- SKU Attribution was
      unaffected (it never depended on `tagged`, just a bare "FIG-..." token
      anywhere in the ad name). Also fixed a second-order issue the relaxed
      check would otherwise have caused: grouping creatives purely by
      SKU+format+angle+... would have collapsed every different ad sharing
      one bare SKU into a single indistinguishable row once format is
      always null. `MetaCreativePerformanceSection.tsx`'s `groupByCreative`
      now falls back to one row per ad (keyed and named by the ad itself)
      whenever no structured fields are present, and only consolidates by
      the full tag once an ad actually carries one (confirmed live: one ad
      already does -- `$FIG-02-008_UGC_Unbox_F_v1$` -- and correctly shows
      its Format/Style/Gender columns while the SKU-only ads around it
      correctly show N/A). Verified against the real account: 44 distinct
      creatives from 44 tagged ads for Last 7 Days (was 0 before the fix).
- [x] **Auto-sync on load + a single "Sync all" button** (2026-08-19): every
      platform used to need its own manual "Sync now" click before trusting
      what's on screen -- tedious across a working session. `App.tsx` now
      has one `handleSyncAll()` that fires `triggerSync`/`triggerShopifySync`
      for every *connected* platform (skips Amazon/Myntra, on hold) for the
      current top-bar date range, in parallel via `Promise.allSettled` (one
      platform's API hiccup doesn't block the others). It runs automatically
      exactly once per page load, as soon as the initial connection-status
      fetch resolves (a `statusLoaded` flag distinct from `syncStatus` being
      non-null, since that also stays null on a failed fetch -- needed
      "the attempt finished" as its own signal, not "and it happened to
      succeed"), and it's also wired to a new "Sync all" button in the
      TopBar for on-demand use, next to the date range picker -- spinning
      icon + disabled while in flight, same as each section's own local
      "Sync now" button already did. Verified live: page load correctly
      fires exactly `/sync/google`, `/sync/meta`, `/shopify/sync` (not
      Amazon/Myntra); the button correctly disables on click and re-enables
      once every platform's real API sync round-trip finishes (can take
      30-60s+, that's the platforms' own APIs, not this).

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
