# GQ XRayDar

A standalone global market intelligence platform: technical analysis across global
equities plus an F&O (derivatives) workstation, cross-asset context and user-built
indices. Equity side:
CW / EW index hierarchy (local currency and USD), EWCW, Weight Watcher, the four
stacked RSIACC / RSCACC / RSIMMA / RSCMMA screens, relative strength, early-stage
scanning, sector rotation, market breadth, heatmaps, explainable AI setup scores,
a natural-language and voice command layer, a chart lab (Heikin-Ashi, Renko, Kagi,
Point & Figure, key levels, drawings, busiest prices), 13 scanners, indicator alerts
on Telegram, morning / weekly summaries, tasks, the GQ Agent, a practice portfolio,
backtesting and briefs. Derivatives side (NSE end-of-day): option chain with IV and
all Greeks, OI and build-up analytics, ban list / MWPL / participant OI, futures basis
and rollover, a volatility lab, dealer gamma, a strategy builder with 53 templates,
an expiry war room, unusual activity, a derivatives & confluence screener and signal
research. Light, dark or device theme; installable on a phone.

It is **independent of the heatmap dashboard**: its own repository, its own web app,
its own tables. It only *reads* market data from the heatmap's Supabase database.

```
┌──────────────────────── heatmap Supabase (read only) ────────────────────────┐
│ instruments · price_history · fundamentals · fx_rates · glocom_latest        │
└───────────────┬───────────────────────────────────────────┬──────────────────┘
                │ DATABASE_URL (engine, batch)              │ anon key (web app: price_history only)
        ┌───────▼────────┐  writes tas_* tables   ┌──────────▼─────────┐
        │ cli/run.mjs    │ ─────────────────────► │ web app (Vite/React)│
        │ engine/ (JS)   │                        │ reads tas_* + bars  │
        └────────────────┘                        └─────────┬───────────┘
                                                            │ login, alerts, tasks, agent
                         ┌──────────────────┐  ta_* tools  ┌─▼────────────────┐
         Telegram ◄──────│ GQ agent (bot)   │◄────────────►│ server/ (Node)   │
                         └──────────────────┘   sends alerts└──────────────────┘
```

**Deploying everything (Railway servers, Vercel, Telegram): see [docs/DEPLOY.md](docs/DEPLOY.md).**
Where each point of the feature PDF lives: [docs/PDF_FEATURES.md](docs/PDF_FEATURES.md).

Until the database is connected the app runs on a **synthetic demo universe**
(generated in the browser and pushed through the exact same engine), with a
"DEMO DATA" banner on every screen.

---

## 1. Unzip and push to a new GitHub repository

The zip already contains a git repository with the first commit made.

```powershell
# Windows PowerShell (macOS / Linux: the same commands work in a terminal)
Expand-Archive gq-technical-analysis.zip -DestinationPath .
cd gq-technical-analysis

# with the GitHub CLI
gh repo create dheerajburli86/gq-technical-analysis --private --source . --push

# or without it: create an EMPTY private repo named gq-technical-analysis on github.com, then
git remote add origin https://github.com/dheerajburli86/gq-technical-analysis.git
git push -u origin main
```

## 2. Run it locally (demo data)

Requires Node.js 20+.

```bash
npm install
npm run dev          # http://localhost:5173  (first load builds the demo universe, ~10 s)
npm test             # engine unit tests
npm run lint
npm run build        # production build in dist/
```

## 3. Connect to the heatmap database (when ready)

Everything below only **adds** `tas_*` tables. Nothing the heatmap owns is altered.

1. **Create this app's tables** — run `supabase/migrations/20261113000000_tas_schema.sql`
   in the Supabase SQL editor of the heatmap project (or `supabase db push`).
2. **Load historical FX** (needed for correct USD index histories):
   ```bash
   DATABASE_URL="postgresql://postgres.<project>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres" \
   FMP_API_KEY=... node cli/fx-backfill.mjs --from 2014-01-01
   ```
   Without it, USD series fall back to a constant latest rate and are labelled *estimated*.
3. **Dry-run the engine** (computes everything, writes nothing):
   ```bash
   DATABASE_URL=... npm run engine:dry
   ```
   Tip: `-- --countries "India,Japan"` restricts the run for a quick test.
4. **Run the engine for real**:
   ```bash
   DATABASE_URL=... npm run engine
   ```
   A full global run reads ~22k stocks × 10+ years and takes tens of minutes; every
   run is recorded in `tas_calc_run`. Re-runs are deterministic: unchanged history is
   not rewritten and any changed past value is logged in `tas_index_revision`.
5. **Point the web app at Supabase** — create `.env.local` (see `.env.example`):
   ```
   VITE_SUPABASE_URL=https://xmcvsnollphnsonaupzt.supabase.co
   VITE_SUPABASE_ANON_KEY=<publishable / anon key>
   ```
   `VITE_DATA_SOURCE=demo` forces demo mode even when those are set.
6. **Schedule the engine** after the heatmap's nightly price refreshes — see
   `.github/workflows/engine.yml` (manual-trigger only until you enable the schedule;
   add `DATABASE_URL` as a repository secret). Do not schedule it during the India
   refresh window the heatmap documents (10:00–11:00 UTC).

## 4. Deploy (web app, TA server, engine, Telegram)

Step by step in [docs/DEPLOY.md](docs/DEPLOY.md): the engine and the TA server on
Railway, the web app on Vercel, and the GQ agent patch that brings the technical
analysis tools and `/ta link` to Telegram.

Run the TA server locally against a test database:

```bash
AUTH_MODE=dev DATABASE_URL=postgres://postgres@localhost:5433/postgres TA_API_SECRET=dev node server/index.mjs
npm run test:server      # end-to-end server test (needs that local database with an engine run)
```

---

## What is where

| Area | Path |
|---|---|
| Calculation engine (shared by batch + browser) | `engine/` |
| Index engine (CW/EW, local/USD, levels 1–6) | `engine/indexEngine.js` |
| Weight Watcher | `engine/weightWatcher.js` |
| Indicators (RSI, nested RSI, EMA, RSC, MMA, …) | `engine/indicators.js` |
| Per-stock signals, stages, events | `engine/signals.js` |
| Breadth, rotation, regime, EWCW | `engine/breadth.js`, `engine/analytics.js` |
| Scores, alerts, NL parser, briefs | `engine/scoring.js`, `engine/alerts.js`, `engine/nl.js`, `engine/briefs.js` |
| Methodology (every [C] default) | `engine/methodology.js`, `docs/METHODOLOGY.md` |
| Batch runner + Postgres source / sink | `cli/` |
| Database schema (tas_* only) | `supabase/migrations/` |
| Web app | `src/` (pages in `src/pages/`) |
| Requirement traceability (all 139) | `docs/REQUIREMENTS_TRACE.md`, in-app *Data centre → Requirement trace* |
| Alert rules, report card, chart read, chart styles | `engine/rules.js`, `engine/scorecard.js`, `engine/chartRead.js`, `engine/chartTools.js`, `engine/candles.js` |
| TA server (auth, alerts, digests, tasks, agent proxy) | `server/` (`server/index.mjs` lists every route) |
| Login, account sync, agent panel, push | `src/lib/server.js`, `src/components/Account.jsx`, `src/components/AgentPanel.jsx`, `public/sw.js` |
| Derivatives maths (pricing, chain, positioning, vol, futures, strategies, screens) | `engine/deriv/` |
| NSE F&O collector (runs inside the server) | `server/lib/fo.mjs`, parsers in `engine/deriv/nse.js` |
| Derivatives pages | `src/pages/deriv/` |
| User-built indices, cross-asset context | `engine/customIndex.js`, `engine/crossAsset.js`, `cli/xassetJob.mjs` |

## Not yet connected (by design)

Finxray feed, IMB framework, LOCOM (and the GLOCOM formula itself) need definitions
or credentials. Each has a documented plug-in point — see *Data centre → Integrations*.
Without the TA server the app still works: watchlists, notes and alerts stay in the
browser and alerts are previewed in the app instead of sent on Telegram.
