# Architecture

## One engine, two hosts

`engine/` is plain ES modules with no I/O. It runs:

- **in Node** (`cli/run.mjs`) against the heatmap's Postgres, writing `tas_*` tables;
- **in a browser Web Worker** (`src/data/demo.worker.js`) against the synthetic demo.

Both call `runPipeline(source, sink)`, so the demo exercises exactly the code that
produces production numbers.

### Source interface

```
calendar(startDate)        -> ["YYYY-MM-DD", ...]
securities()               -> instruments-shaped rows
indiaMap?()                -> { SYMBOL: industry label }
countryBars(ids, country)  -> Map id -> {time[], open[], high[], low[], close[], volume[]}
fxHistory()                -> { history: {CCY: {dates, usd, source}}, latest: {CCY: usd} }
fundamentals?(ids)         -> Map id -> FMP statements
corporateActions?()        -> Map id -> [{exDate, factor, type}]
glocom?()                  -> Map id -> {code, label, ...}
```

### Pipeline

1. **Pass 1 (per country)** — load bars, apply corporate actions, align to the master
   calendar, build cells and every country-level index (CW/EW × LCL/USD); feed the
   additive accumulators of the regional / classification / global indices.
2. **Finish** — cross-country indices; Weight Watcher from the rebalance memberships.
3. **Pass 2 (per country)** — per-stock analysis (D/W/M states, RSC vs country / sector /
   region / global, levels, volume, stage), events with forward returns, breadth
   accumulation, data-health checks, scores and the flat screen row.
4. **Post** — breadth series, rotation, regimes, EWCW, backtest scorecard, FX provenance.

Memory stays bounded: a country is loaded, processed and released; only the retained
benchmark series and small per-stock records survive between passes.

## Storage (tas_* tables, written by the engine only)

| Table | Content |
|---|---|
| `tas_calc_run` | run id, methodology + hash, stats, status, screen-row key list |
| `tas_index`, `tas_index_values`, `tas_index_revision` | index catalogue, values per index-year, revision log |
| `tas_membership` | point-in-time constituents per country per rebalance |
| `tas_ww` | Weight Watcher series per parent / child type |
| `tas_security` | normalised security master |
| `tas_snapshot` | full per-stock analysis (`snap`, `f`, `ww`, `glocom`, `score`) + compact `flat` row |
| `tas_events`, `tas_backtest` | inflection events (compact), backtest scorecard |
| `tas_breadth`, `tas_rotation`, `tas_regime`, `tas_ewcw` | market analytics |
| `tas_fx_history`, `tas_fx` | raw historical FX, FX as used by the run |
| `tas_corporate_action` | input: split / bonus factors |
| `tas_data_issue` | data-health findings per run |

All have RLS with a public SELECT policy (anon key reads them); writes need the database
connection string, which only the engine holds.

## Web app

- `src/data/api.js` picks the data source; `supabaseApi.js` and the demo worker expose the
  same methods (`info`, `securities`, `screenRows`, `snapshot`, `indexSeries`, `bars`, ...).
- `src/data/store.jsx` loads the security master, flat screen rows, index catalogue and
  regimes once; everything else loads per page and is cached (`src/lib/series.js`).
- Screens, heatmaps, alerts and the NL parser all read fields through
  `engine/fields.js`, so a "3M return" means the same number everywhere.
- Charts: lightweight-charts; one chart per window, synced by time (`ChartSync`).
- User state (watchlists, notes, screens, layouts, alerts) is in localStorage
  (`src/lib/storage.js`) until accounts are added.
