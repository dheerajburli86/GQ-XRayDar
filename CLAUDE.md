# Notes for Claude Code sessions on this repo

This is the **GQ AI-Powered Technical Analysis Software**, a standalone product. It is
NOT part of the heatmap dashboard and must not be wired into it.

## Hard rules

- **Never write to a heatmap-owned table** (instruments, price_history, returns_latest,
  fundamentals, fx_rates, glocom_latest, ...). The engine reads them; it writes only `tas_*`.
  Schema changes go in `supabase/migrations/` and only touch `tas_*` objects.
- **One engine.** Any number shown in the app comes from `engine/`. Do not re-implement
  maths in a page; add it to the engine (and a test in `tests/`).
- **Fields go through `engine/fields.js`.** Screens, heatmap colours, alerts and the NL
  parser read the registry; adding a screenable value means adding a field there (and it
  automatically joins the flat screen row).
- **GLOCOM / LOCOM follow the owner's rule sheet** in `engine/glocom.js` (do not alter thresholds without it).
  A stock's GLOCOM is the heatmap's `glocom_latest` where present. **IMB / ETI characteristics come from the ETI
  project only** (`tas_eti_characteristic`, see below): never compute, score or rank them here.
- **Never label estimated data as observed.** Historical market caps (constant shares),
  carried FX and stale constituents are estimated / flagged; keep it that way.
- The demo is synthetic and must keep its "DEMO DATA" banner.

- **The server sends, the GQ agent polls.** `server/` uses the GQ agent's bot token for
  `sendMessage` only. Never add `getUpdates` / a webhook here: Telegram allows one poller.
- **Alerts fire on an edge, once.** `tas_alert_event`'s UNIQUE key is the de-duplication and
  the row is inserted BEFORE anything is sent; template rules seed silently on first sight.
  Do not move either into memory or reorder them.
- **User tables are server-only.** `tas_user*`, `tas_alert_event`, `tas_task`, `tas_push_sub`,
  `tas_digest_log` have RLS on and no policies; the browser reaches them only through
  `server/` (Supabase login + @gquants.com, or the agent secret).
- **Shared maths stays in `engine/`**: the chart read (`chartRead.js`) and the report card
  (`scorecard.js`) run in the browser and on the server from the same file.

## Checks before committing

```
npm test && npm run lint && npm run build
npm run test:server   # needs the local Postgres below with an engine run + 20261114 migration
```

Local end-to-end check of the batch engine against a throw-away Postgres:
`DATABASE_URL=postgres://postgres@localhost:5433/postgres node scripts/local-integration.mjs && node cli/run.mjs`
(the script refuses any non-local database).

## Gotchas

- Dates are ISO strings everywhere; never round-trip a session date through `new Date()`
  in the browser (timezones shift it).
- `periodKey(..., "W")` is cached; weekly candles are stamped with their LAST session.
- Supabase PostgREST returns at most 1000 rows per request; `supabaseApi.all()` pages.
- `tas_index_values` is per index-year; `tas_index_series(key)` unnests it for SQL users.
- Event rows are stored compact (`engine/eventCodec.js`); decode before use.
- The heatmap mutes India non-equities with `is_active=false`; the engine therefore skips
  inactive India rows but keeps inactive US / global ones (delisted companies).

## Derivatives (F&O), added 2026-11-15

- **Data = NSE's public end-of-day files**, downloaded by the TA server (`server/lib/fo.mjs`):
  F&O UDiFF bhavcopy, participant-wise OI, ban list, combined OI / MWPL. It writes only
  `tas_fo_day`, `tas_fo_chain` (last `FO_CHAIN_KEEP_SESSIONS`), `tas_fo_stats` (kept),
  `tas_fo_market`. Parsers find columns by NAME and throw with the header they saw.
- **Never log in to Kite from this app.** The heatmap's live ticker holds the account's
  session; a second TOTP login can end it. Live chains / depth / tape need a dedicated
  broker session (see `engine/deriv/sources.js`) and are labelled "needs a live feed".
- **OI units**: the bhavcopy may quote OI and volume in shares. The parser converts to
  contracts when >= 90% of rows divide by the lot, and records the choice in `tas_fo_day.units`.
- **Fact vs interpretation**: exchange-published numbers (prices, OI, participant OI, ban)
  are facts; IV, Greeks, build-up, writing / buying, GEX, margin are interpretations with
  stated assumptions and confidence. Keep the labels; margin is an ESTIMATE, not SPAN.
- All maths lives in `engine/deriv/` with tests in `tests/deriv.test.mjs` (Greeks are checked
  against finite differences). Fractions everywhere; pages format with `fp` (signed) / `pc` (unsigned).
- Cross-asset series (`tas_xasset`) are built by `cli/xassetJob.mjs`, run by the server when
  older than 20 h. Bond funds come from FMP into `tas_xasset_bars` because the heatmap has none.

## Risk, alerts, API, audit and ops (added 2026-11-16)

- **Risk maths is engine-only**: `engine/deriv/risk.js` (beta-weighting, Taylor attribution, stress, VaR/ES,
  hedges, sizing, limits, margin monitor), `montecarlo.js` (seeded Merton + Heston-type), `coach.js`,
  `engine/validation.js` (walk-forward, sensitivity, Brier / calibration, PSI). Tests in `tests/risk.test.mjs`.
- **Derivatives alerts** (`engine/deriv/alerts.js`, user doc `deriv.alerts`) run in the same alert tick, fire on
  an EDGE between the last two stored sessions, seed silently on first sight and use the same
  `tas_alert_event` unique key. Priority decides channels (`PRIORITY_CHANNELS`); webhook URLs must be public https.
- **Quote hygiene** lives in `enrichChain` (`quoteFlags`); IV/Greeks are suppressed on dead and below-intrinsic
  contracts. Changing it changes stored summaries: bump `FO_VERSION` (now 3) so old sessions are reprocessed.
- **Every calculation has a version** in `engine/versions.js`; bump it when results change.
- **Audit tables are append-only** (`tas_audit`, `tas_ai_audit`, trigger refuses UPDATE/DELETE). Never add an
  update/delete path. Browser-computed model outputs go through `POST /api/audit/ai` (`src/lib/audit.js`).
- **Roles** on `tas_user.role` (admin | analyst | viewer | disabled); `ADMIN_EMAILS` are always admin; enforce
  with `server/lib/rbac.mjs`. **API tokens** are hashed (`tas_api_token`), scoped, rate-limited per token; `/v1`
  and the `/v1/stream` WebSocket are in `server/lib/publicApi.mjs`, documented in `docs/API.md`.
- `engine/deriv/capabilities.js` is the exchange capability matrix and rule engines; pages should read it rather
  than assume an exchange offers depth, tape or SPAN. NSE freeze limits there are from NSE/FAOP/77189 (2026-11-02); NSE revises them often, re-check before relying on them.
- Chart patterns (`engine/patterns.js`) are computed in the batch engine for D and W (snapshot `chartPatterns`) and
  appear as screen fields `chartPattern*`; the chart lab recomputes them for the bars on screen.

## GLOCOM / LOCOM (added 2026-11-15)

- Rule sheet (owner's picture, rows tested in order, first match wins) and the five band colours
  (dark green, light green, yellow, light red, dark red) live in `engine/glocom.js`; tests in `tests/glocom.test.mjs`.
- Peer sets: a stock's GLOCOM = vs its market (heatmap `glocom_latest` wins when present, `source` says which);
  LOCOM = vs its own GICS industry group (needs 3+ stocks); industries / sectors = vs the other groups of the market,
  on the EQUAL-WEIGHTED average of their constituents' 1W / 6M / 1Y returns (calendar look-backs, as returns_latest).
  LOCOM = within industry group (confirmed by the owner 2026-11-15). LTW 40 is W <= 0.4 and 6M >= 0.4, as the heatmap's
  scraper_common.classify (owner: follow the heatmap where the picture differs).
- Group rank 1 = best (band, then the heatmap's 50/30/20 score). History of the last `methodology.glocom.historySessions`
  sessions is stored in `tas_glocom_group` (`C:<country>|industry|sector`, `G|...` in USD); the page computes moves
  (`groupMoves`, `groupTimeline`). Jump > 0 = moved up that many places.

## IMB / ETI characteristics (added 2026-11-15)

- Source of truth: the ETI project (repo dheerajburli86/ETI, Supabase project "ETI"). It stores, per company, the 10
  characteristics (6 IMB, 4 ETI gates) as yes / no / unknown with numbers and notes. Sir's rule: **no score, no rank,
  no view** -- this app shows and filters them, nothing more. Do not add counts, totals or orderings by "how many met".
- Copy: `tas_eti_sync()` in the heatmap DB pulls `company_characteristics_latest` over dblink (connection string in the Vault
  secret `eti_src_conn`; a foreign server is not allowed, dblink_fdw belongs to supabase_admin; ETI login `xraydar_reader`: read-only, SELECT on companies / characteristics only) into `tas_eti_characteristic`, hourly
  via pg_cron `tas-eti-sync`. Instruments are matched by ISIN, then NSE symbol. Every changed answer after first sight
  is appended to `tas_eti_change` (first sight is silent), which is what the "eti" alert kind reads.
- `unknown` (null) means the rule could not be checked. Never show or filter it as "no".
- Definitions / labels: `engine/eti.js` (mirror of the ETI README). Screen fields `eti_<key>`.

## Analyst-style screens (added 2026-11-16, owner's screenshots of the "Analyst" software)

- `screens/RSIMMA|RSIACC|RSCMMA|RSCACC` (`src/pages/StackedScreens.jsx`): black look in every theme, two timeframes side
  by side (default Daily | Weekly), log scale ON by default for every pane including RSIs, "Averages only" hides every
  price / RSI / RSC line in one click. RSI screens have 4 rows, RSC screens 5 (RSI up to three deep on RSC).
  RSC benchmark defaults to BSE 500 for Indian stocks. All maths: `engine/analyst.js` (tests `tests/analyst.test.mjs`).
- Timeframes: D, W, M, 2M, Q, 4M, 5M, 6M, 7M, 8M, 9M, 10M, 11M, Y, 2Y plus anything typed (`normaliseTf`: "18M", "3Y",
  "13W"). n-month candles sit on a fixed grid from January 2000, n-week from Monday 3 Jan 2000 (`periodKey`).
  `TfPicker` (components/pickers.jsx) is the selector; chart lab and workspace use it too.
- From / To dates on the Analyst screens: To drops every bar after it; From opens the window and, with "Candles start
  from From date" ticked (off by default: candles count from January), anchors every candle of 2 months or longer (and n-week) on From's month / week
  (`periodKey(date, tf, anchor)`). Bars before From still warm up the RSIs and EMAs. Without From, the grids above apply.
- RSI period is 14 on every row and every timeframe (owner 2026-11-16: "keep 14 default for all period"). The "14,21" in
  Analyst's 5th RSC row label is NOT used: no 21, no second indicator. The page has an RSI period box for anyone who wants
  to change it; the default stays 14.

## Robustness and speed (added 2026-11-17)

- **Every page sits inside `ErrorBoundary`** (`src/components/ErrorBoundary.jsx`, wired in `App.jsx`): a page that throws shows "Try again / Reload" instead of a blank screen, and the menu keeps working. A missing page file after a deploy retries once, then reloads the app once (30 s guard in sessionStorage).
- **Charts never throw on bad data**: `cleanSeriesData` in `TvChart.jsx` sorts, de-duplicates and drops non-numeric rows; each series is added in its own try/catch (Chart lab uses the same helper). Do not call `series.setData` on raw rows elsewhere.
- **Supabase reads are cached and retried** (`src/data/supabaseApi.js`): an in-memory LRU shares in-flight requests; index series, breadth, rotation, GLOCOM, WW, EWCW and backtest results are also kept in IndexedDB per engine run (`runGet/runSet`, purged when a new run lands). Transient network errors retry twice. Answers are shared: pages must not mutate them.
- A failed load that a page does not render shows a Retry banner (`gqta-load-error` event from `useAsync`). Page files are prefetched in idle time after startup.
- **Server**: per-request timeout (150 s, 200 s for the agent), pg pool timeouts + `statement_timeout`, gzip for JSON over 2 KB, `/livez` (process) vs `/health` (database), the data cache keeps serving the last good run if a refresh fails, unhandled rejections are logged not fatal, Telegram 429 waits once and retries. Pinned by `tests/http.test.mjs`.
- Testing tools used: `/tmp/pw/monkey.mjs` style headless click-through (every button/select/row on every page) against a local PostgREST over the throw-away Postgres. Never run two such scripts in one browser tab: they fight over the hash and look like 30-second hangs.

## Never deploy during the engine run (added 2026-11-19)

The engine service (`railway.engine.json`, cron `40 2 * * 2-6`, ~4 h) is redeployed by every push to main, and a
redeploy ENDS the job that is running. On 2026-11-19 a push at 06:26 UTC killed that day's run (marked failed in
`tas_calc_run`; the app kept serving the previous complete run). Push only between ~07:00 and 02:30 UTC.

## Added 2026-11-19 (owner's improvements list + additional feature list)

- **Bad prints / share breaks** (`engine/quality.js`): `removeBadPrints` drops a 1-5 bar jump of x1.8+ that comes
  straight back (QH Thailand 31 Dec 2021 = 899,101); applied in the engine AND in every bar loader (browser, server)
  so charts and numbers agree. `shareBreaks` + `methodology.eligibility.maxCapUsd / maxCapMultiple`: before a x3+
  step confirmed by FMP share counts (or any x10 step) constant-share caps are unusable, so the stock joins CW / EW /
  WW only from then (LATAM Airlines, Delcath). Both are reported in data health.
- **Weight Watcher** leaves a date empty when a big country of the parent had < 25% of its stocks (`tas_ww.gaps`);
  industry-group views added; line names on hover only (`TvChart hoverNames`).
- **Ticker search** (`src/lib/instruments.js`): categories INDIA / US / EUROPE / Emerging / JAPAN / Indices / Currency /
  Commodity / Crypto; chart refs `s:<id>`, `i:<index key>`, `x:<symbol>`. Extra chart-only instruments (more indices,
  yields, commodity futures, currency pairs from tas_fx) are in `tas_extra_series`, built by `cli/extraJob.mjs` on the
  server. MSCI index levels are licensed and not available; MSCI tracker ETFs sit in the ticker category "US ETF" (not "Indices"), tagged as tracking an MSCI index.
- **Keys** (`src/lib/chartKeys.js`): D W M Q H Y period, C (or typing) opens the ticker popup. Wheel zoom keeps the
  last bar fixed (`rightBarStaysOnScroll`). The last instrument opened carries across chart screens.
- **Multi-tile screen** (`src/pages/Tiles.jsx`, parser `engine/tiles.js`): command → top-N by cap of a country /
  group, relative to a listed index with the group's name (PHLX Semiconductor) else the house country-sector CW.
- **GLOCOM / LOCOM**: same rule sheet; called LOCOM for Indian industries / sectors, GLOCOM elsewhere (owner's
  improvements list, supersedes the 2026-11-15 wording). Stock vs its industry = "GLOCOM within industry". History
  kept 70 sessions so the 3-month move works.
- **Chart lab**: studies (`engine/studies.js`), drawing geometry (`engine/drawings.js`), formula language
  (`engine/formula.js`, no eval, own-property names only), projections (`engine/projection.js`), seasonality,
  TPO from candles, replay with practice orders, paper stats (`engine/paperStats.js`). Alerts accept `match: any`,
  `once`, and `{kind: level|line}` conditions limited to `universe.ids`.

## Added 2026-11-19 (remaining items from the owner's list)

- **Stacked screens** now take indicators (`Indicators` button: studies, formulas, projections from the shared stores, each on its own pane via `StudyPane`). Price pane `ohlc` carries volume for the volume studies.
- **Workspace** price panels draw the projections saved in the chart lab (shared `projections` store, keyed by instrument id); they are edited in the lab only.
- **Confluence** (`engine/confluence.js`, version `CONFLUENCE_VERSION`) is a COUNT of agreeing signals, never a forecast or a score of quality. Screen fields `confluenceNet*` / `confluenceLean*`; Chart lab tab shows the signals behind the count.
- **Script import / export** (`importFormulas` / `exportFormulas` in `engine/formula.js`) moves OUR formula language as text. It never runs Pine or JS; unsupported lines are reported, not guessed.
- **Events** (chart lab tab) are entered by the user; no calendar feed exists, so none is shown as fact.
- **Derivatives paper trading** (`engine/deriv/paperBook.js`, `src/components/DerivPaper.jsx`, store `paper.deriv`, INR): fills at the stored end-of-day price, pays `INDIA_COSTS`, NO margin check, NO slippage, no live quote. Futures move cash only when closed; options pay / receive the premium at once. Expired contracts are marked at expiry value but not auto-settled yet.

## Added 2026-11-19 (evening): data window, OHLCV, stock menu, hidden features

- **Data window**: Ctrl+D toggles a draggable window (`src/components/DataWindow.jsx`, mounted once in App) with the candle under the cursor: date, day, OHLC, % change, volume and the 12 EMAs of the close (3-15 yellow, 30-60 red), as in the Analyst software. Position is remembered in localStorage. Charts report the hovered candle through `reportHover` (`src/lib/dataWindow.js`); every chart that has real candles passes `ohlcv={{name, tf, bars}}` to `TvChart` (or does it in the chart lab). A level series (indices, no OHLC) shows one value, never O=H=L=C.
- **OHLCV legend** (`OhlcvLegend`) sits top-left of price charts; it follows the cursor, and shows the last candle when the cursor is away.
- **Stock links** (`StockLink` in `ui.jsx`): the name opens the stock page as before; the small arrow or a right-click lists Chart lab, RSIMMA / RSIACC / RSCMMA / RSCACC and the peers tile.
- **Hidden features for v1** are listed with reasons in `src/lib/features.js` (`HIDDEN`); delete a key to bring one back. Now hidden: Derivatives → Unusual activity (needs a live options feed) and the chart lab Events tab (no calendar feed).
- **India has NO market cap here (owner, 2026-11-19: no reliable source; only 36% of active India stocks had one).** `CAP_UNRELIABLE_COUNTRIES` in `engine/geography.js` makes `toSecurity` drop every India cap, so India stocks join no CW or EW index (the engine excludes a stock with no cap from both), no Weight Watcher group and no "top N by cap" list; they keep charts, RSIMMA/RSCMMA screens, scanners, GLOCOM/LOCOM and IMB/ETI. `supabaseApi.js` also blanks India caps in stored rows so the app is consistent before the next engine run rewrites them. Bring India back by removing it from that set once a reliable cap source exists. Pinned by `tests/indiaCap.test.mjs`.

## India without a market cap: EW indices, turnover ranking, Nifty 500 proxy (added 2026-11-19)

- **Engine** (`IndexBuilder.addCountry`, `capless` = `CAP_UNRELIABLE_COUNTRIES`): India gets EQUAL-WEIGHT indices only (`EW|LCL|C:India`, `EW|USD|C:India`, `...|S:<sector>`), no `K:` size segments, no CW, no memberships / Weight Watcher, and it is never added to a regional / global roll-up (so Global / Asia CW do not contain India). Do not give it a placeholder cap to "make CW work".
- **Benchmarks**: `countryFamily(country)` (engine/geography.js) says CW or EW; `bCountry` / `bSector` / rotation / regimes in `pipeline.js` and the screen presets, chart-lab "vs its market", tiles house benchmark and `defaultBenchmark` all read it. EW-vs-CW, small-vs-large and sector/country-vs-global pairs are skipped for India.
- **Turnover** (`engine/turnover.js`, `tas_security.turnover_usd`, migration 20261119000200): median daily close x volume in USD over 60 sessions (>= 20 with volume). A liquidity measure, never shown as a cap. `secRankCmp` orders capped stocks by cap first, uncapped by turnover; every top-N / default-instrument / search ordering uses it. Heatmap tile size and tooltip switch to "traded value" when no stock in the view has a cap; Tiles titles say "by turnover".
- **Proxy**: "India CW (Nifty 500, official index)" is the stored Nifty 500 level series, offered in ticker search (All / India / Indices) as a chart / RSC line only. It is not a house index and is in no roll-up.
- Stored India CW / WW series remain in the database until the next engine run (02:40 UTC) rewrites the index tables; `tests/indiaCap.test.mjs`, `tests/turnover.test.mjs` pin all of the above.

## Index minimum market cap (added 2026-11-19, owner / Alok Sir)

- `methodology.eligibility.minCapUsd` = **flat USD 250M for every global stock** (Alok Sir, 2026-11-26; was 1B developed / 200M emerging, methodology 1.4.0), tested on the (estimated) cap at every rebalance in `IndexBuilder.addCountry`, before the Large/Mid/Small split (so the percentile bands are computed on the stocks that pass). Countries without a reliable cap (India) skip it and the bands: wait for a cap source, do not substitute turnover. Methodology version 1.1.0; the stored indices change at the next engine run.

## Added 2026-11-20: US classification workbook, 9-month timeframe, Z key, callouts

- **US stocks and ADRs use the owner's workbook** (`engine/reference/usClassification.js`, 1,450 symbols, Sector / Industry / Sub-industry; stock sheet wins over the ADR sheet). `toSecurity` applies it first (`classSource: us_workbook`); the rest of the US stays on GICS with no sub-industry, so industry-level GLOCOM mixes the two until the workbook is extended. `tas_security.sub_industry` (migration 20261120000000) and field `subIndustry`.
- **Timeframe N = 9 months** is in `analyzeSecurity`, the field registry (all per-timeframe fields incl. MMA / RSC boxes) and the scanner timeframe lists, which now offer D W M Q N Y. Stored snapshots lack N until the next engine run.
- Tables (`.tbl`) wrap headers and cap text columns; numeric columns are never truncated.
- **Z** zooms the chart under the cursor out (`zoomOutAt` in TvChart). **Callout** drawing = text box with chosen background and text colour (chart lab overlay).
- US default RSC benchmark in the stacked screens is the S&P 500 (`^GSPC`), as BSE 500 is for India.

## Added 2026-11-20 (evening): rule-based US classification, crypto hidden, pair bar on Workspace

- **US stocks outside the workbook** are placed by their FMP profile industry (`engine/reference/usIndustryRules.js`, `classSource: us_rule`). Rules are the dominant workbook placement per FMP industry plus hand rows (Shell Companies -> Financials, Marine Shipping, Coal, Uranium, Education ...); Biotechnology splits on cap (>= USD 2B commercial-stage, else clinical-stage). The sub-industry on a rule row is the commonest one for that FMP industry, NOT a per-company judgement: extend `US_CLASS` for names where it matters. `cli/pgSource.mjs` reads `fundamentals.profile->>'industry'` as `fmp_industry` (us_stocks only). Workbook rows always win.
- **Crypto is hidden in XRayDar only**: `HIDE_CRYPTO` in `src/lib/features.js`; filtered in `supabaseApi.securities()`, `server/lib/data.mjs` and the ticker categories. Flip to false to bring it back.
- **Period-pair bar** (Daily | Weekly, Monthly | Quarterly, Half-yearly | 9-month, Yearly | 2-year) on the stacked screens and Workspace. Single-window screens (Chart lab, Tiles, stock page) have one period by design.

## Breadth analyser (added 2026-11-20, owner's workbook GQ_Breadth_Analysis)

- `engine/breadthRange.js` + `src/pages/BreadthAnalyser.jsx` (menu: Discovery -> Breadth analyser). For a parent index and its constituent indices (sectors, size segments, countries, regions, classifications) over chosen periods: % change, CCR, OUP, RR, RRM, RRMK, TR, TRMK. Formulas are the workbook's, pinned cell for cell in `tests/breadthRange.test.mjs` (fixture = the workbook's own 36 rows); a ratio with a zero denominator is null (the workbook's #DIV/0!).
- Weights = each constituent's cap on the START date (`tas_index_values.cap_usd`); change = index LEVEL change (not cap change, so a rebalance does not read as a move). Indices without a cap history (India's equal-weight ones) carry equal weights and the page says so.
- "Reverse CCR for ranges": end date fixed, start steps back one trading day per row, newest start first (`reverseRange`). Periods are multi-select (1D ... 1Y, YTD). Both tables export to CSV.
- Not the heatmap's market-breadth page (`Breadth.jsx`, advance/decline): that one is unchanged.

## Improvements list items 30-31 (added 2026-11-20)

- **Item 30**: the top-down explorer now lists Sub-industries (owner's US workbook + rules) under a sector or industry group; clicking one (`sub=` in the URL) shows its stocks, and the stocks tables carry a Sub-industry column.
- **Item 31**: Market breadth has a Period selector (1M ... All, or Custom from / to). It slices the charts and KPIs; the data itself is unchanged.
- **Item 29 (house indices as rows)**: `engine/pipeline.js` analyses the USD CW series of Global / region / classification / country / country-sector (plus India's EW ones) as close-only rows, id `h:<index key>`, `asset_class = 'Index'`, `universe = 'house_indices'`, snapshots under country "House indices" (136 on the local data). They join scanners / RS / screener when the scope includes Index; they never enter CW / EW. Rows appear after the next engine run. Chart lab has no price_history bars for `h:` ids; open them through the index series instead.

## Resizable side menu and full-screen charts (added 2026-11-20)

- The left menu has a drag handle on its right edge (160-520 px, saved as `navWidth`, double-click resets to 228). Collapsed mode is unchanged.
- Stacked screens (RSIMMA / RSIACC / RSCMMA / RSCACC): ⤢ on a column header (or double-click it) opens that column full screen with taller panes; ✕ or Esc returns. Workspace panels have the same ⤢. The Multi-tile screen already had its own maximise.

## EWCW on the stacked screens (added 2026-11-20)

Opening an equal-weight house index (`i:EW|...`) on RSCMMA / RSCACC defaults its benchmark to the cap-weighted twin (`CW|...`), so the screen reads EW vs CW. All CW / EW levels (country, sector, industry group) are in ticker search under Indices; a different benchmark can still be picked.

## GQ Agent panel starts clean (added 2026-11-20)

`AgentPanel` history is in-memory only and is cleared whenever the panel is opened (button or `openAgent`), so nobody lands on the previous person's question. ⌫ still clears mid-visit.

## Start page (added 2026-11-20)

The app opens on `home` = `src/pages/Start.jsx` and never opens a page for the user (owner's rule). It lists every left-menu item, in menu order, with a sentence of what it is for (`WHAT`, keyed by page key; the menu itself is `src/lib/nav.js`, shared with the Start page). Hovering a row (or tapping "◀ Show me") adds the class `pointed` to the matching `.navitem` (outline plus a moving ◀) and scrolls it into view. A new menu item shows up here by itself; add its sentence to `WHAT`. The market summary is the `market` page, menu "Command centre".

## Back button (added 2026-11-20)

`BackBar` in `App.jsx` sits at the top of every page except Start: a big thick green "← Back" (browser history, so every URL-based drill-down, including heatmap, explorer and chart pages, steps back one level) plus a "⌂ Start" link. If Back does not change the address (deep link, nothing behind), it goes to Start. A drill-down that keeps its state outside the URL would not be covered, so keep drill state in the query string.

## What-if price and two-window full screen on the stacked screens (added 2026-11-20, Alok Sir)

- **What-if price** (`engine/whatif.js`, panel in `StackedScreens.jsx`): a typed close for the last stored session replaces that close; a later date appends a candle (open = previous close). Earlier dates are ignored. Everything on both windows (RSIs, averages, RSC) is rebuilt from the changed daily bars; the panel shows before / with-price closes and RSI. NOTHING is saved or sent anywhere, it clears when the instrument changes, and it is always badged HYPOTHETICAL. RSC carries the price with the last stored FX ratio. Exchange holidays are not known, so a holiday weekday is accepted. Tests: `tests/whatif.test.mjs`.
- **⤢ Full screen** button (toolbar) puts both windows on the whole screen; the bar there changes the instrument, comparison, periods, and switches Both / Left only / Right only. The per-column ⤢ and double-click are kept.

- **Voice input (mic buttons in the command bar and Assistant) is hidden** via `HIDE_VOICE` in `src/lib/features.js` (owner, 2026-11-20); set it to false to bring it back.

## Phone layout (added 2026-11-20)

At <= 760px the left menu is a slide-in drawer (☰ in the top bar, closes on navigation), the top bar keeps only search, reload and the theme toggle (`.m-hide` hides the rest), tables and cards scroll sideways inside themselves, inputs are 16px (no iOS zoom), and the stacked screens fold their second toolbar row behind "More controls". The floating Data window is off on phones. Tested at 390 px: no page scrolls sideways.

## Synced panes, full-screen screen switcher, ticker reuse (added 2026-11-20, Alok Sir's list)

- **Panes of one window zoom / pan together** (stacked screens). Every pane of a column is drawn on the SAME bar slots: `TvChart`
  gets `timeline` (union of the column's row dates) and `padToTimeline` adds whitespace before / after a series (and repeats the
  previous value over a day only the other market was closed, for lines), so `ChartSync({ logical: true })` can follow by bar
  position. Time-range sync was wrong here: an RSI that starts 14 bars later reported a clipped range and dragged the price with
  it. Full screen has its own pair of syncs. Other pages keep the time-range sync (different instruments, different dates).
- **Full screen** (⤢ on a column or the toolbar button) opens BOTH windows; the bar has the RSIMMA / RSIACC / RSCMMA / RSCACC
  switch (`carryFocus` keeps it open across the switch), instrument, comparison and a period for each side.
- **Ticker reuse** (`cutAtTickerReuse`, engine/quality.js, applied in the engine and both bar loaders): a gap of 7+ days with a
  permanent x5 level change means the bars in front belong to a previous holder of the ticker (US META: a ~$14 company until
  Jan 2022, Facebook from 9 Jun 2022), so the series starts at the break; data health reports `ticker_reuse_cut`. Facebook's
  2012-2022 history is under FB in the price source and is NOT in `price_history` for META: loading it is a heatmap-pipeline job
  (this app never writes price_history).
- `window.__GQ_TEST_CHARTS` (set by a headless test before load) collects every chart so a test can read visible ranges.

- **Stale indices are removed after a complete run** (`pgSink.finish`): every index of the run is upserted with its `run_id`, so after
  `status = "ok"` any `tas_index` row with another run_id is no longer produced (India CW, a segment under the minimum cap) and is
  deleted with its yearly values. Before this, such rows lingered from older runs and kept showing in the app.

## Owner's list, 21 Nov 2026 (Alok Sir's meeting)

- **GLOCOM / LOCOM category changes** (`BandChange` in `glocomUi.jsx`): the coloured arrow between the two bands carries the change (green up, red down); rank moves are shown plainly (#5 → #1), no "N places". Moves list: upgrades, downgrades, then rank-only. Global also rates **countries** against each other (`G|country`, engine `accG.country`, equal-weighted like industries).
- **Weight Watcher**: children ordered by latest weight; Top 10 / Prev 10 / Next 10 paging; log scale on by default. `methodology.startDate` moved 2015 → **2010** (version 1.2.0) so WW and every index start earlier: first real run on the full data, watch the run time and memory.
- **Breadth analyser**: Global / region / classification by sectors or size as well as countries; "Global · <sector> (by country)" parents; the note says what CCR is computed across.
- **Command centre** (`market?m=G|R:x|M:x|C:x`, US / India one click): sector strength with bands and 1W band change, industry strength (GLOCOM / LOCOM), setup report by stage, PDF download (`downloadPage`).
- **Full screen** (stacked screens and Workspace): period-pair bar and period pickers in the full-screen bar; Both / "<period> only" buttons name the period. Double-click opens Both.
- **GQ Agent**: `GQAGENT_URL` is not set on ta-server, so the built-in assistant answers. `nl.js` folds typos (markt cap, Fundmental), reads score components (`score_fundamentals`, `score_technical` ...), money units, returns, and never takes a bare number as a ticker; a list question with conditions is always a screen. The panel answers screens / "explain X" itself even when the remote agent is connected. The button is a tab on the right edge (it covered tables' Next button).
- **ETF type** (`engine/etfType.js`): Equity / Fixed income / Commodity / Currency / Real estate / Alternative / Multi-asset / Crypto in the industry-group slot of ETFs (engine and `supabaseApi.securities`), field `etfType`. Provider asset class wins when known.
- **ETF details** on the stock page from `tas_etf_info` (migration 20261121000000, filled hourly in slices by `cli/etfInfoJob.mjs` on the TA server from FMP etf/info, holdings, sector and country weightings; India as `<SYMBOL>.NS`, else the heatmap's `etf_weights`). Stock page shows market cap in local currency and USD.
- **Funnel** starts at Global, US or India; India uses its EW indices and equal weights; only stocks reach the last step.

## ROC and KST (added 2026-11-23, Shankar Sir)

- `roc` and `kst` in `engine/studies.js` (tests in `tests/studies.test.mjs`, KST checked against a hand computation). Chart lab / Workspace studies "ROC" and "KST (Know Sure Thing)": every period, weight and the signal length is an editable box.
- KST = w1 SMA(ROC r1, s1) + ... + w4 SMA(ROC r4, s4), signal = SMA(KST, sig); Pring's 10/15/20/30, 10/10/10/15, 1/2/3/4, 9 are only the starting values.
- Screen fields per timeframe (D W M Q N Y): `kst*`, `kstSignal*`, `kstAbove*`, `kstCross*`, computed by the batch engine with `methodology.indicators.kst` (methodology 1.3.0). Null until a timeframe has ROC r4 + SMA s4 - 1 bars (45 at Pring's settings), so Q / N / Y are empty for short histories. Rows appear after the next engine run.

## Every indicator is editable, and the GQ agent answers in the panel (added 2026-11-23, Shankar Sir / owner)

- **Indicators** (`engine/studies.js` STUDIES, 56 studies, all drawn by `studyOverlays`) plus the MA kinds (EMA, SMA, WMA, HMA, DEMA, TEMA), MMA groups, RSI, MACD, RSC, Fibonacci, volume profile, key levels and the Renko / Kagi / P&F / Heikin-Ashi chart types. Every period, multiplier, level and colour is a box in Chart lab → Indicators or in ⚙ Settings (`src/lib/indSettings.js`, shared by Chart lab, Stock, Workspace, the stacked screens, Tiles and the data window). Added 2026-11-23: Stochastic RSI, Momentum, Awesome Oscillator, TSI, historical volatility, standard deviation, linear regression line and slope / R², MA envelope, Choppiness, Ulcer (tests in `tests/studies.test.mjs`).
- The NIGHTLY screen fields (rsiD, kstW, mmaBullW ...) are computed once for the whole universe with `methodology.indicators`; they cannot follow one viewer's settings. Charts and the stacked screens recompute live with the viewer's settings.
- **Agent panel**: when ta-server has `GQAGENT_URL` (GQ agent, `gqagent-production.up.railway.app`) and the shared `TA_API_SECRET`, EVERY question goes to the GQ agent (Grok), except chart commands the panel performs itself. The agent reads XRayDar's numbers through `/api/fields`, `/api/screen` (structured conditions, `columns`), `/api/stock`, `/api/chart-read`, `/api/market`, `/api/review`; the built-in keyword parser answers only when the agent is not connected or fails. The panel renders tables, headings and code from the agent's markdown.

## Indicators checked against TA-Lib / pandas-ta / TradingView (added 2026-11-23)

- `tests/indicatorReference.test.mjs` pins **82 series** (every study, the MA kinds, RSI, MACD, ATR, ...) against independent references on 800 random-walk candles: TA-Lib, pandas-ta, or TradingView's own formula where a library's convention differs (OBV from 0, PPO / KST / Keltner / Supertrend as TradingView defines them). Fixture + generator in `tests/fixtures/`. A change to any indicator's maths must keep this test green, or regenerate the fixture with a stated reason.
- DPO follows TradingView's default (close - SMA from n/2+1 bars ago); the old centred form is a `centered` option.
- Added: KAMA, Williams Alligator (shifted forward), Chandelier Exit, ZigZag (last leg provisional), Fisher Transform, RVI, Klinger, Price Volume Trend, Balance of Power (56 studies). Woodie pivots gain R3/R4/S3/S4, Camarilla R5/S5; VWAP session is a choice (auto/day/week/month/quarter/year); Ichimoku displacement is editable.
- Every study has Style controls in Chart lab → Indicators: line width, colour of the main line (up / down colours for PSAR and Supertrend), a price **source** (close, open, high, low, hl2, hlc3, ohlc4) for single-series studies (`SOURCE_STUDIES`), and ↺ to go back to the starting values.

## Colours are settings too; study settings are cleaned before use (added 2026-11-24)

- `indSettings.colors` (⚙ Settings → Colours): candles up / down, close line, comparison, volume, MMA groups, RSI and its
  level lines, MACD and histogram, RSC and its average, drawings, Fibonacci, and the black look of the RSI / RSC screens and
  multi-tile (`a*` keys: background, text, price up / down, short / long EMAs, ACC 1-8, RSI levels). Charts read them; do not
  hard-code a chart colour in a page. `TvChart` re-applies `theme` when it changes.
- `cleanParams` (lib/chartOverlays.js) turns what a viewer typed into usable numbers: blank / text -> the study's starting
  value, periods held to 1 .. number of candles (max 2000), shifts 0-500, levels / multipliers / scale left free. A period of
  1,000,000 froze the page before this.
- Bar-only studies (CMF, Elder, Force, Chaikin osc, Coppock, volume osc, AO, BOP), studies with upper / lower lines and pivots
  take the study's up / down colours. `tests/studyOverlays.test.mjs` fails if any setting of any study changes nothing on the chart.

## Accounts, per-person agent access, sharing levels, community and chat (added 2026-11-24, owner + Shankar Sir)

- **Whole site behind sign-in** (Vercel `VITE_REQUIRE_LOGIN=true`), **open signup** with email + password (`OPEN_SIGNUP`, on by
  default; `0` returns to the domain list). The Supabase auth project is SHARED with the heatmap dashboard (it already allowed
  public signUp), so one account works on both. Accounts are created by the server, already confirmed, through
  `public.tas_create_account()` (SECURITY DEFINER, execute revoked from anon/authenticated; writes auth.users + auth.identities
  in GoTrue's exact shape, `$2a$` bcrypt; verified live against /auth/v1/token). Reason: Supabase's built-in mailer only reaches
  the project's own team, so confirmation emails would lock outsiders out. "Forgot password" uses resetPasswordForEmail, which
  only works once custom SMTP is set in Supabase; until then admins set a temporary password (`tas_set_password`, People & access).
- **Agent is per person** (`tas_user.agent_access {enabled, sources}`): OFF for every new account; admins (ADMIN_EMAILS / role
  admin) always have everything. Sources: `xraydar` (market data), `web`, and the GQ agent's project ids (code + DB):
  heatmap-dashboard, gq-xraydar, eti, gq-finxray-us, gdp-macro-dashboard, busybee. ta-server sends `user.access.sources` to
  the GQ agent, whose `buildTools({allow})` drops every tool outside the list and whose prompt names what is allowed. A
  Telegram account LINKED to an XRayDar account follows the same list (`GET /api/agent/access`); unlinked team Telegram users
  keep the team rules. No personal mail access exists anywhere. The guest (no-login) agent path is OFF (`AGENT_PUBLIC=1` revives it).
  The built-in fallback answers only for someone allowed `xraydar`.
- **Sharing levels** (`tas_share`, `tas_share_member`): private / chosen people / everyone, for items of the synced documents
  in `SHARE_KINDS` (watchlists, screens, customIndicators, alerts.rules, notes, workspaces, customIndices, deriv.screens,
  drawings, projections, indSettings). The payload is taken from the owner's SAVED doc (never the request) and refreshed on
  every `PUT /api/docs/:key`; deleting the item ends the share. `ShareButton` (components/Share.jsx) + the "Shared items" tab of Community & chat (no separate Shared library page, owner 2026-11-25).
- **Community** (`tas_room` kinds room / board / group / dm, `tas_room_member`, `tas_message`, `tas_file`): public rooms and
  boards are readable by anyone signed in and posting joins them; groups and DMs are members-only. Polling (3 s open
  conversation, 30 s unread badge), no websockets. Files are bytea, 10 MB, allow-listed types, served only after a membership
  check with a sandbox CSP. Items sent in chat are COPIES; "💬 Send" in the top bar posts a picture of the screen + a link.
  People see display names, never emails (exact email search finds a person). 30 messages/min per person; 5 signups/hour/IP.
- Tests: `tests/community.test.mjs` (in `npm run test:server`; the local DB needs an `auth` schema stand-in, see the test).

## The dashboard GQ Agent (history, 2026-11-24 morning)

The site runs with `VITE_REQUIRE_LOGIN=false`, so the panel has no Supabase session. `POST /api/agent/chat` therefore accepts a request with NO Authorization header as a guest (`cfg.agentPublic`, env `AGENT_PUBLIC`, on by default, `AGENT_PUBLIC=0` turns it off; a token that is sent must still be valid). `GET /api/agent/status` (public) tells the panel whether the agent is connected. Guests are sent to the GQ agent as `{guest: true, guestId: sha256(ip|secret)}` (NOT an email: the agent refuses a non-email and the panel then fell back, 2026-11-24); the agent gives guests read-only access to every project's code and data EXCEPT BusyBee (staff tasks / payroll), plus the XRayDar tool and the web, and a "where the numbers live" map in its prompt (owner, 2026-11-24: the team has NO Indian market caps on any channel; the agent must say so and never quote the heatmap`s partial `market_cap_inr`). The panel shows the question at once with a working line (steps + seconds) until the answer replaces it. Rate-limited per IP and audited with a null user. The built-in fallback ranks "by market cap / biggest / largest" by `capUsd` (it used the AI score before). Before this the panel silently fell to the built-in keyword assistant (wrong answers such as "3341 stocks match" for "5 biggest US stocks"). Every other route still needs a login. The Google sign-in was removed the same day; the email-link `SignIn` stays for `VITE_REQUIRE_LOGIN` builds.

## XRayDar sign-in has its OWN Supabase project (added 2026-11-25, owner)

Logins no longer live in the heatmap's Supabase project (xmcvsnollphnsonaupzt). They are in "GQ-XRayDar" (ceneywmgbqmjgrlbtsiw);
the xmcv project keeps only the data and the tas_* tables. Browser: `VITE_AUTH_SUPABASE_URL / _ANON_KEY` (auth client only,
`src/lib/server.js`). Server: `AUTH_SUPABASE_URL / _ANON_KEY / _SERVICE_KEY` verify tokens and, through `server/lib/authAdmin.mjs`
(admin API), create accounts and set temporary passwords. Without the service key the old SQL functions in xmcv are used (tests only).
Accounts made before the move do not exist in the new project and must sign up again; tas_user rows keep their ids.
The new project's Site URL / Redirect URLs are the XRayDar address (reset links). Never point XRayDar login at xmcv again.

## India stocks missing from XRayDar; chart links from the GQ agent (added 2026-11-25, Alok Sir's items 2 and 5)

- **Missing stocks**: 8 active india_stocks rows (Neogen, Tata Motors CV, Page Industries, NLC India, MTAR, Saregama, JM Financial,
  Raymond Lifestyle) had a blank `instruments.type` and were dropped by `isEquityRow`. In india_stocks a blank type is now a stock
  (`stockType`); US `FUND` rows (REIT trusts) count as stocks too. The heatmap's `NO_RECENT_TRADES` marker (~358 India rows) is
  analysed with `tas_security.dormant = true`: shown with a warning on the stock page, excluded from indices, breadth and back-tests
  (`isStock` in pipeline.js). Data health reports `not_analysed` for any active stock-universe row still dropped, and
  `no_recent_trades` (info) for dormant ones. Rows appear after the next engine run.
- **Chart links**: `GET /api/chart-link?ref=&screen=&tf=&tf2=&bench=&country=` (analysis.chartLink) returns a URL for Chart lab,
  the stock page or RSIMMA / RSIACC / RSCMMA / RSCACC with periods (`?l=&r=` on the stacked screens) and a comparison. Screen rows
  carry a `chart` link. The GQ agent's xraydar tool has `chart_link` and its prompt makes every chart answer end with a link.
  Links into the app open in place in the agent panel (`aTag` in AgentPanel.jsx). Needs `APP_URL` on ta-server.

## Alok Sir's list, 25 Nov 2026: sizes, group minimum, one name per industry, price repairs

- **India has no size segment**: a Size filter is skipped wherever the scope is India (`src/lib/scope.js` `effectiveScope`, used by `applyScope`). Scanners / Screener show a `ScopeNote` line naming every filter in force with "Clear filters" (Grok bots read the page; a filter left from an earlier question once gave "0 in scope").
- **GLOCOM groups need `methodology.glocom.minGroupStocks` (5) stocks to be ranked**; smaller ones keep counts and returns, show greyed "Not ranked", and never take a rank. `rerateHistory` re-rates histories written before the rule (applied in both API layers), so it holds before the next engine run.
- **Global industries use the GICS industry group for every market** (`sec.gicsIndustryGroup`); the owner's US workbook groups stay inside the US. **One name per group**: `engine/reference/industryAliases.js` folds variants (Pharmaceuticals & Medical Products -> Pharmaceuticals, "&" vs "and" spellings ...) in `toSecurity` and both API layers.
- **Price repairs** (`tas_price_repair`, `cli/priceRepairJob.mjs`, ta-server every 6 h): bars more than 50x from the latest close are re-fetched from FMP; `decideRepairs` replaces (provider differs and is plausible), drops (> 1000x and the provider has nothing usable) or confirms (provider agrees: a real move). Every bar loader applies them with `applyPriceRepairs` before corporate actions. price_history itself is never written; data health rule `price_repaired`. India is skipped (Kite).
- Weight Watcher: column "Change vs 4 quarters ago", table 50 rows a page.

## Corporate actions: NSE feed loaded, and India prices are ALREADY adjusted (added 2026-11-25)

- **Source**: NSE `corporates-corporateActions` JSON answers from the Supabase database's outbound `net.http_get` (not from the sandbox; BSE's API is 403 there). Half-year slices 1996 to 2026 are in `tas_nse_ca_raw`; split / bonus / consolidation rows parsed into `tas_nse_ca` and the view `tas_nse_ca_factor` (factor = new shares per old: bonus a:b -> (a+b)/b, split from X to Y -> X/Y). Debenture / NCRPS / DVR / preference bonuses are not equity changes and are left at 1. 1,405 parsed events, matched to instruments by ISIN.
- **Kite's India history is already adjusted** for most of them: 273 of 291 events (since 2012) are flat across the ex-date (Reliance 2024 and HDFC Bank 2025 bonuses, for instance). Blindly loading all of them would adjust twice. Only events whose stored prices still show the jump were kept in `tas_corporate_action` (26 on 2026-11-25: Tembo, Dharan, Landsmill, MBL Infra, ...), and `applyCorporateActions` now skips any action whose close-before / close-on ratio is closer to 1 than to the factor (`skipped` lists them). Pinned in `tests/quality.test.mjs`.
- Load only `source = 'nse_corporate_actions'` rows; never re-insert all 1,405 without that guard. US / Global history is adjusted by the providers; do not load actions for them.
- BSE-only stocks are missing (NSE feed only); ISINs not in `instruments` are skipped.

## LTW 40 corrected (2026-11-25, Alok Sir)

LTW 40 is now W >= 0.4 and 6M < 0.4 (the Excel formula), reversing the earlier heatmap-copied rule. Belgium (W 38, 6M 46, 1Y 41) is Neutral 40 60. Pinned in `tests/glocom.test.mjs`. Stored GLOCOM codes change at the next engine run.

## GLOCOM / LOCOM band history export (added 2026-11-26, Shankar Sir's mail)

`GET /api/glocom-history` (login or agent secret) returns every stored session of `tas_glocom_group` as CSV, one row per date x group:
date, market, level, group, band, band_code, rank, rated_groups, score, stocks, ret_1w/6m/1y, pctile_1w/6m/1y (fractions; USD for Global).
`?scope=G|industry`, `?market=India`, `?format=json`. Builder in `engine/glocomExport.js`. Depth is only what `methodology.glocom.historySessions`
stores (70 sessions); it is NOT point-in-time: past dates are re-derived by each run from today's prices, corporate-action / bad-print repairs and
today's industry mapping. Equal-weight average of constituents; Indian groups carry no cap or size filter.

## Extra chart series added from the owner's indices list (2026-11-26)

23 more FMP series in `engine/reference/extraInstruments.js` (WIG20, WIG, RTSI, China A50, platinum, palladium, heating oil, RBOB, aluminium, zinc, wheat, rice, corn, soybeans + oil + meal, cocoa, coffee, sugar, OJ, live cattle, lumber, oats), chosen from a live probe (`cli/indexProbe.mjs`). Stale FMP series (lead, cotton, lean hogs, feeder cattle) were left out on purpose.
Still not held: 26 items FMP cannot serve (PSI 20, BUX, SZSE, STAR 50, Hang Seng TECH, Philippines, Karachi, Vietnam, Gulf / Africa exchanges, TA-35, Athens General, Turkey All Share, nickel, gas oil, coal, HRC, CRB, India 10Y), MSCI index levels (licensed; ETFs stand in) and MCX gold / silver (need Kite, never log in separately).

## USD copies of local-currency indices (added 2026-11-26)

`cli/extraJob.mjs` `runUsd`: every held exchange-provided index (heatmap global_indices, india_indices, and the extra FMP indices) quoted in local currency also gets a chart series `USD:<symbol>` (heatmap ones `USD:GL:^BVSP`, `USD:IN:<symbol>`), labelled "<name> (USD)", category Index, in `tas_extra_series`. Level x `tas_fx` USD-per-unit on the same day; a day with no fixing carries the last rate up to 5 days and the source text says estimated. Currency comes from `COUNTRY_CURRENCY` (the heatmap's instruments.currency says USD for every global index, which is wrong for the levels). US indices are already USD and get no copy.

## Technology / Non Technology index groups (added 2026-11-26, Alok Sir)

Scope suffix `|T:Technology` / `|T:Non Technology` (`parseScope().tech`, level "Xs"): CW / EW, local + USD, per country, region, classification and Global. Definition in ONE place, `engine/reference/techGroup.js` (Sir 2026-11-26: IT sector PLUS Alphabet / Meta / Amazon-type platforms, Tesla, SpaceX): US = workbook IT sector + platform industries + a few sub-industries (Tesla's EV makers, SpaceX's satellite comms, Netflix streaming, online travel / resale); India / Global = GICS Information Technology only (no sub-industry there). India is equal-weight only and in no roll-up (no cap), so the Global / region Technology groups hold US + Global stocks, and India has its own `C:India|T:...` pair. Indices appear after the next engine run.

## Engine runs countries side by side (added 2026-11-26)

The batch engine waited on the database (CPU < 1 core of 24, ~4 h per run). Now: pass 1 reads the next `ENGINE_PREFETCH` (2) countries' bars while the current one is computed, and still adds countries in sorted order; index batches are written `ENGINE_WRITES` (3) at a time in the background (`pgSink` kickFlush / drainFlush; a write error is re-thrown at the next write or the drain); bar chunks are read `ENGINE_READS` (3) at a time; pass 2 runs up to `ENGINE_COUNTRIES` (4) countries at once, largest first, within `ENGINE_BUDGET` (14000) securities in memory (`engine/concurrency.js` weightedLimiter; a country bigger than the budget runs alone). Every shared accumulator only adds, so results do not depend on finishing order: `tests/concurrency.test.mjs` and a local run compared sequential vs parallel (identical snapshot scores, index levels and year hashes; 95 s -> 39 s). Pool capped at 12 connections. `ENGINE_COUNTRIES=1 ENGINE_READS=1 ENGINE_WRITES=1 ENGINE_PREFETCH=0` restores the old behaviour. The ta-engine container has 24 GB and `--max-old-space-size=20480` for the countries held at once.

## GQ Agent changes the open chart (added 2026-11-26, Alok Sir points 5 and 6)

- Cause of "RSIMMA link opens a plain chart": screen rows only carried `chart` (the Chart lab), and the agent labelled it RSIMMA. Rows and `stock` now carry `links = {chart, stock, RSIMMA, RSIACC, RSCMMA, RSCACC}` (`screenLinks` in server/lib/analysis.mjs); `chart_link` takes `style` (candles, ha, line, bar, renko, kagi, pnf, tpo) and the Chart lab reads `?style=`.
- The panel changes the OPEN chart itself: `src/lib/chartIntent.js` (`parseChartIntent` / `applyChartIntent`, tests `tests/chartIntent.test.mjs`) handles "make it candlesticks", "open RSIMMA", "weekly and monthly" in place, without the agent. A sentence with any word outside its vocabulary (another ticker, a question) still goes to the agent; when the agent's answer to an open / show / switch request has exactly one in-app link (`linkToFollow`), the panel opens it on screen.
- StackedScreens sends its context (mode, instrument key, left / right periods); the GQ agent's message carries chart type, screen, periods and instrument id, and its tool text says to answer a change request with one chart_link for the same instrument.
