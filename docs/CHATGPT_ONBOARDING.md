# GQ XRayDar: ChatGPT onboarding pack

Two parts. **Part 1** is the prompt: paste it as the first message of a new ChatGPT chat (or as the Project instructions).
**Part 2** is the briefing document: paste it right after, or upload this whole file.

Read "How to give ChatGPT access" first. ChatGPT cannot log in to your accounts by itself.

---

## How to give ChatGPT access (be honest about what is possible)

ChatGPT Plus can only read what you connect or hand over. Use these three routes together.

1. **Code: GitHub connector (best).** ChatGPT → Settings → Connectors → GitHub → connect, and allow only the repo
   `dheerajburli86/gq-xraydar` (read-only). Then pick GitHub as a source in the chat. If the connector is not on your plan,
   download the repo as a ZIP (GitHub → Code → Download ZIP) and upload it. Use `docs/` and `CLAUDE.md` first: they are the best summary.
2. **Vercel, Railway, Supabase: no direct access.** ChatGPT has no login to them. Give it read-only evidence instead:
   - Supabase: run the queries in Part 3 in the SQL editor and paste the results.
   - Railway: for services `ta-server` and `ta-engine`, copy the Settings page (start command, cron, variables **names only**) and the last 100 log lines.
   - Vercel: project `gq-xraydar`, copy the latest deployment status, domain list and environment variable **names only**.
3. **The live app:** https://gq-xraydar.vercel.app (sign in with a @gquants.com account). ChatGPT cannot sign in, so describe or screenshot what you see.

**Never paste or upload:** database passwords, `DATABASE_URL`, service keys, `TA_API_SECRET`, bot tokens, VAPID private key, API tokens.
Variable *names* are fine, values are not. If a secret was ever pasted somewhere by mistake, rotate it.

---

# PART 1: THE PROMPT (paste this)

```
You are my technical teacher and QA lead for "GQ XRayDar" (the GQ AI-Powered Technical Analysis Software, built by GQuants).
I am a junior tech developer. I know almost no finance (I do not properly know terms like EBITDA, RSI, relative strength).
Explain every finance idea from the basics, then link it to where it appears in the product.

GOAL
Teach me the entire product from scratch, to the smallest detail, and help me test it screen by screen.

WHAT YOU CAN SEE
- The repository (via the GitHub connector or the uploaded ZIP). Read docs/ARCHITECTURE.md, METHODOLOGY.md, DEPLOY.md, API.md,
  REQUIREMENTS_TRACE.md, PDF_FEATURES.md and CLAUDE.md first, then engine/, server/, src/, cli/, supabase/migrations/, tests/.
- The briefing document I pasted (Part 2) and any exports I paste later (Supabase query results, Railway settings and logs,
  Vercel deployment info).
- You CANNOT log in to Vercel, Supabase, Railway or the live app. Never pretend you did. If you need something from them,
  tell me the exact thing to copy (a query, a settings page, a log) and wait.

HARD RULES
1. Every claim about how the product works must come from a file you actually read or an export I pasted. Quote the path
   (and function or table name). If you have not read it, say "not verified" and ask me for it or read it. Never guess.
2. If the document and the code disagree, the CODE wins. Tell me about the difference.
3. Do not give buy, sell or hold advice, price targets or predictions. The product itself never does; explain it neutrally.
4. Never ask me for secrets. If I paste one by mistake, tell me to rotate it.
5. Keep numbers honest: say whether a figure is observed or estimated (historical market caps and carried FX rates are estimates).
6. Teach in small steps. After each section ask me 3 short check questions and wait for my answers before moving on.
   If I get one wrong, re-explain with a fresh example.

HOW TO TEACH (do these in order, one stage per reply, and wait for me to say "next")
Stage 1  Big picture: what the product is, who uses it, the 4 pieces (web app, TA server, nightly engine, GQ agent) and where
         each runs (Vercel, Railway, Railway cron, Railway). Draw an ASCII diagram. Explain what is read-only and what is written.
Stage 2  Finance basics I need: candle, OHLC, volume, moving average, EMA, RSI, relative strength (RSC), market cap,
         cap-weighted vs equal-weighted index, breadth, sector vs industry, GICS, derivatives (futures, options, open interest),
         stop with a glossary I can keep.
Stage 3  Data: where every number comes from (heatmap Supabase tables are read-only; tas_* tables are written only by the engine).
         Walk through every tas_* table in supabase/migrations: what a row is, key columns, who writes it, who reads it.
Stage 4  The engine, file by file (engine/pipeline.js first, then analyst.js, indicators.js, indexEngine.js, glocom.js,
         weightWatcher.js, breadth*.js, scoring.js, confluence.js, consolidation.js, patterns.js, quality.js, classification.js,
         deriv/*). For each: input, output, formula in plain words, one worked numeric example, and which test covers it.
Stage 5  The server (server/index.mjs and server/lib/*): every API route, who may call it (auth, roles, tokens), alerts
         (edge-triggered, de-duplicated), Telegram, push notifications, tasks, audit tables, the F&O downloader.
Stage 6  The web app: go through the menu one page at a time (list in Part 2). For each page: purpose, controls, data it reads,
         engine file behind it, and a test script (below).
Stage 7  Deployment and operations: Vercel, Railway (ta-server, ta-engine cron 02:40 UTC Tue-Sat), Supabase, GitHub, and the rule
         "never push while the engine is running". Explain what breaks when each piece is down.
Stage 8  Known rules, limits and traps (Part 2, section 9), then a final exam of 20 questions.

TEST SCRIPT FORMAT (use for every page and feature)
For each page give me a table: Step | What I do | Expected result | How I verify it (which table or file proves the number) | Pass/Fail.
Include: normal case, empty case, bad input, very large input, slow network, phone screen, and a comparison against a number I
can verify by hand or in SQL. Mark anything that depends on data I must check in Supabase.
Also produce, at the end: (a) a one-page smoke test of 25 checks, (b) a regression checklist for before each deploy,
(c) a list of anything in the code that looks wrong, risky or untested, with the file and line.

START NOW with Stage 1 only. First list which files you read to do it, and which of my needed exports (Part 3) you still need.
```

---

# PART 2: THE BRIEFING DOCUMENT (paste this)

## 1. What the product is

GQ XRayDar is a standalone technical-analysis workstation for India, US and global markets: charts, scanners, relative strength,
house indices, sector rotation, derivatives analytics, alerts, an assistant ("GQ Agent"), and a mobile-installable app.
It improves on an older Windows program called "Analyst" (screens named RSIMMA, RSIACC, RSCMMA, RSCACC come from it).
It is **not** part of the separate "heatmap dashboard". Repo: github.com/dheerajburli86/gq-xraydar.
It never gives buy / sell / hold advice or predictions; it describes stored data.

## 2. Four pieces and where they run

| Piece | Code | Runs on | Job |
|---|---|---|---|
| Web app | `src/` (React + Vite) | Vercel, project `gq-xraydar`, https://gq-xraydar.vercel.app | the dashboard, installable on phones (PWA) |
| TA server | `server/` (Node) | Railway service `ta-server`, always on, health `/health` | login check, alerts, Telegram, push, tasks, GQ Agent panel, account sync, audit, public API, F&O downloads |
| Engine | `engine/` + `cli/run.mjs` | Railway service `ta-engine`, cron `40 2 * * 2-6` UTC (about 4 hours) | the nightly calculation; writes `tas_*` tables |
| GQ agent | separate repo `GQagent` | Railway | Telegram bot using the `ta_*` tools |

Database: one Supabase Postgres project (id `xmcvsnollphnsonaupzt`), shared with the heatmap dashboard.
Heatmap-owned tables (instruments, price_history, returns_latest, fundamentals, fx_rates, glocom_latest) are **read only** for this product.
This product writes only `tas_*` tables.

## 3. Data flow

heatmap tables (prices, instruments, fundamentals) → engine (`runPipeline(source, sink)`) → `tas_*` tables → web app (reads with the
public anon key) and TA server (reads and writes with the database connection) → Telegram, push, GQ Agent.
The same engine code also runs in the browser against a synthetic demo (banner "DEMO DATA" must stay).

Pipeline stages: (1) per country load bars, apply corporate actions, build country indices; (2) cross-country indices and Weight Watcher;
(3) per-stock analysis, events, breadth, data-health, scores; (4) breadth series, rotation, regimes, EWCW, backtest scorecard, FX provenance.

## 4. Tables (all `tas_*`, from `supabase/migrations`)

Analysis: `tas_security`, `tas_snapshot`, `tas_index`, `tas_index_values`, `tas_index_revision`, `tas_membership`, `tas_ww`, `tas_ewcw`,
`tas_breadth`, `tas_rotation`, `tas_regime`, `tas_backtest`, `tas_events`, `tas_glocom_group`, `tas_calc_run`, `tas_data_issue`,
`tas_corporate_action`, `tas_fx`, `tas_fx_history`, `tas_extra_series`.
IMB / ETI: `tas_eti_characteristic`, `tas_eti_change` (copied hourly from the separate ETI project).
Derivatives: `tas_fo_day`, `tas_fo_chain`, `tas_fo_stats`, `tas_fo_market`, `tas_xasset`, `tas_xasset_bars`.
Users and ops (server-only, row-level security on, no policies): `tas_user`, `tas_user_doc`, `tas_alert_event`, `tas_task`, `tas_push_sub`,
`tas_digest_log`, `tas_api_token`, `tas_link_code`, `tas_audit`, `tas_ai_audit` (the last two are append-only).

## 5. The menu, page by page (src/App.jsx NAV)

- **Overview:** Command centre, Top-down explorer (country → sector → industry group → sub-industry → stocks), Heatmap, Cross-asset.
- **Indices:** CW / EW indices (cap-weighted and equal-weighted house indices, local and USD), EW vs CW (EWCW), Weight Watcher, My indices.
- **Charts:** Chart lab (studies, drawings, formulas, projections, replay), RSIACC, RSCACC, RSIMMA, RSCMMA (two timeframes side by side, four or five rows),
  Multi-tile screen (type a command like "top 8 US semiconductor companies daily MMA"), Multi-chart workspace.
- **Discovery:** Scanners, Relative strength, Screener (plain-English screens), Early-stage scanner, IMB / ETI characteristics, Opportunity funnel,
  Sector rotation, GLOCOM / LOCOM, Market breadth, Breadth analyser (CCR, OUP, RR, RRM, RRMK, TR, TRMK).
- **Research:** AI setup scores, GQ Agent (full page), Market briefs, Backtest & patterns.
- **Derivatives (India F&O end-of-day):** dashboard, option chain, futures and rollover, volatility lab, strategy builder, portfolio risk,
  expiry and events, derivatives screener, derivatives research. (Unusual activity is hidden: needs a live feed.)
- **My work:** Alerts, Tasks, Watchlists and portfolio, Practice portfolio, Research notes.
- **Data:** Data centre (run history, data health, issues, admin).
Global controls: command bar (Ctrl/Cmd+K or "/", also voice), theme, PNG/PDF download of any page, GQ Agent button, Ctrl+D data window,
chart keys (D W M Q H Y change period, C opens ticker search, Z zooms out), resizable left menu, full-screen chart (⤢).

## 6. Key concepts and rules the product follows

- **RSIMMA / RSCMMA:** MMA = multi-moving-average ribbon: 12 EMAs, short group 3-15 (yellow) and long group 30-60 (red). RSI period is 14 on every row and timeframe.
  RSC = relative strength comparison = price divided by a benchmark (BSE 500 for Indian stocks, S&P 500 for US, else the country index).
  Rows are: price, RSI of price, RSI of RSI, RSI of RSI of RSI (RSC screens add an RSC row on top).
- **Timeframes:** D, W, M, 2M, Q, 4M … 11M, Y, 2Y, and typed ones (18M, 3Y, 13W). N = 9 months. Candles on a fixed grid (months from Jan 2000, weeks from Mon 3 Jan 2000); weekly candles are stamped with their last session.
- **House indices:** families CW and EW, currency LCL or USD, levels L1 to L6 (plus sector / industry-group variants). Search them under Indices.
- **Minimum market cap for index eligibility:** USD 1B developed, USD 200M emerging. Historical caps use constant shares and are labelled estimated.
- **India has no market cap here** (no reliable source): India gets equal-weight indices only, no CW, no Weight Watcher, no size bands, ranked by traded value (turnover). The Nifty 500 official index stands in as a chart-only proxy.
- **GLOCOM / LOCOM:** a rule-sheet banding (five colours: dark green, light green, yellow, light red, dark red) comparing 1-week, 6-month and 1-year returns against peers. Thresholds are the owner's and must not change without his rule sheet.
- **IMB / ETI characteristics:** 10 yes / no / unknown answers per company, owned by the ETI project. Shown and filterable only: **no score, no rank, no count of "how many met"**. Unknown is never shown as no.
- **Classification:** US stocks use the owner's workbook (sector, industry, sub-industry), then FMP-industry rules, then GICS. Every stock is placed in a sector (no "Others" bucket by design).
- **Alerts:** fire once on a change of state (edge), de-duplicated by a unique key written before sending. Channels: Telegram, phone push, webhook. Derivatives alerts and template rules seed silently on first sight.
- **Data quality:** bad prints (a jump of ×1.8 or more that reverses within 1 to 5 bars) are removed everywhere; share-count breaks make earlier constant-share caps unusable; both are reported in data health.
- **Crypto is hidden** in XRayDar (switch `HIDE_CRYPTO` in `src/lib/features.js`).
- **Derivatives data** is NSE's public end-of-day files, never a live feed; IV, Greeks, build-up, GEX and margin are interpretations (margin is an estimate, not SPAN). The app never logs in to Kite.
- **Audit:** `tas_audit` and `tas_ai_audit` are append-only. Every calculation has a version in `engine/versions.js`.
- **Roles:** admin, analyst, viewer, disabled. Admin emails are fixed in config. Access = Supabase login with an @gquants.com address.
- **GQ Agent panel:** opens with a clean slate every time (no remembered chat).

## 7. Deployment facts

- Vercel builds `npm run build` to `dist`; `sw.js` and `index.html` are served uncached, hashed assets cached for a year.
- Railway: `ta-server` (Dockerfile.server, `node server/index.mjs`, one replica, health `/health`); `ta-engine` (same Dockerfile, runs `cli/fx-backfill.mjs` then `cli/run.mjs` with 7 GB heap, cron 02:40 UTC Tue-Sat, restart never).
- **Never push to main between about 02:30 and 07:00 UTC:** every push redeploys the engine and a redeploy kills a running job (it happened on 2026-11-19; the app kept serving the previous complete run).
- Migrations live in `supabase/migrations` and may only touch `tas_*` objects.
- Checks before any commit: `npm test && npm run lint && npm run build`; server tests: `npm run test:server` (needs a local Postgres with an engine run).
- Environment variables are by name only: `DATABASE_URL`, `FMP_API_KEY`, `TA_API_SECRET`, `TELEGRAM_BOT_TOKEN`, `VITE_*` (browser-safe settings), push keys.

## 8. Where to look in the repo

`docs/ARCHITECTURE.md` (pipeline), `docs/METHODOLOGY.md` (every formula), `docs/DEPLOY.md` (setup), `docs/API.md` (public API),
`docs/REQUIREMENTS_TRACE.md` (requirement → code), `CLAUDE.md` (hard rules and history), `engine/` (all maths, no I/O),
`server/lib/` (alerts, auth, rbac, telegram, push, fo, agent), `src/pages/` (one file per screen), `src/lib/` (router, series loading, storage, push),
`tests/` (node --test), `cli/` (batch jobs).

## 9. Known limits and traps (verify each in the code before trusting)

1. The Breadth analyser uses the 11 India GICS sector indices with equal weights, not the owner's 36 in-house indices (list still needed).
2. US sub-industries outside the owner's workbook are the commonest one for the stock's FMP industry, not a per-company judgement.
3. House-index rows (`h:` ids) and several new fields (9-month timeframe, sub-industry, consolidation breakout on RSI panes) appear only after the next full engine run.
4. Stored India CW / WW series remain in the database until the engine rewrites the index tables.
5. Derivatives paper trading has no margin check, no slippage and does not auto-settle expired contracts.
6. Events tab and Unusual activity are hidden because there is no calendar or live options feed.
7. Supabase returns at most 1000 rows per request; the app pages through (`supabaseApi.all()`).
8. Dates are ISO strings; never pass a session date through `new Date()` in the browser (time zones shift it).
9. Muted India non-equities are skipped by the engine; inactive US and global rows (delisted companies) are kept.

---

# PART 3: EXPORTS TO PASTE LATER (read-only, safe)

Run in the Supabase SQL editor (project `xmcvsnollphnsonaupzt`). They only read.

```sql
-- 1. last engine runs
select * from tas_calc_run order by 1 desc limit 5;

-- 2. row counts of every tas_ table
select relname as table_name, n_live_tup as approx_rows
from pg_stat_user_tables where relname like 'tas\_%' order by relname;

-- 3. what is in the latest snapshot (by market)
select country, count(*) from tas_security group by 1 order by 2 desc limit 30;

-- 4. data issues open
select * from tas_data_issue order by 1 desc limit 30;

-- 5. index families and levels
select family, ccy, level, count(*) from tas_index group by 1,2,3 order by 1,2,3;

-- 6. users by role (no emails)
select role, count(*) from tas_user group by 1;

-- 7. tables and columns (so ChatGPT knows the real schema)
select table_name, column_name, data_type from information_schema.columns
where table_schema='public' and table_name like 'tas\_%' order by table_name, ordinal_position;
```

Railway (copy, with values removed): service Settings (start command, cron, replicas, health check), Variables **names**, last 100 log lines of `ta-server` and the last engine run.
Vercel (copy): latest deployment status and commit, production domain, Environment Variables **names**.
