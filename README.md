# GQ AI-Powered Technical Analysis Software

A standalone dashboard and calculation engine for global equity technical analysis:
CW / EW index hierarchy (local currency and USD), EWCW, Weight Watcher, the four
stacked RSIACC / RSCACC / RSIMMA / RSCMMA screens, relative strength, early-stage
scanning, sector rotation, market breadth, heatmaps, explainable AI setup scores,
a natural-language and voice command layer, alerts, backtesting and briefs.

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
        └────────────────┘                        └─────────────────────┘
```

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

## 4. Deploy the web app

Any static host. On Vercel: import the repo, framework *Vite*, add the two
`VITE_SUPABASE_*` variables, deploy. `vercel.json` is included.

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
| Requirement traceability (all 116) | `docs/REQUIREMENTS_TRACE.md`, in-app *Data centre → Requirement trace* |

## Not yet connected (by design)

Finxray feed, IMB framework, LOCOM (and the GLOCOM formula itself) need definitions
or credentials; Telegram and the GQ agent come next. Each has a documented plug-in
point — see *Data centre → Integrations*. Watchlists, notes, saved screens, layouts
and alerts are stored in the browser until user accounts are added.
