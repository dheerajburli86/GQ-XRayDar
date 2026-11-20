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

- `methodology.eligibility.minCapUsd` = USD 1B developed, USD 200M emerging, tested on the (estimated) cap at every rebalance in `IndexBuilder.addCountry`, before the Large/Mid/Small split (so the percentile bands are computed on the stocks that pass). Countries without a reliable cap (India) skip it and the bands: wait for a cap source, do not substitute turnover. Methodology version 1.1.0; the stored indices change at the next engine run.

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
