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
