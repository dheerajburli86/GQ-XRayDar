# Requirement traceability

Generated from `src/requirements.js` (`npm run trace`). Also shown in the app: *Data centre → Requirement trace*.

**Built, with a stated limit:** 12 · **Built:** 95 · **Enhancement, not started:** 1 · **Built on a default awaiting confirmation [C]:** 4 · **Needs an external input:** 4

| # | Tag | Requirement | Status | Where / notes |
|---|---|---|---|---|
| 1 | M | Unified AI technical-analysis platform | Built, with a stated limit | Technical, relative, absolute, fundamental, index, Weight Watcher and GLOCOM in one app. IMB and Finxray plug in once their definitions / feed exist (#93, #95). |
| 2 | M | Global equity coverage | Built | Stocks, GICS sectors / industry groups, countries, regions and DM/EM classifications across US, India and the 39-country global universe. |
| 3 | M | Top-down and bottom-up navigation | Built | Top-down explorer (global → region → country → cap → sector → industry group → stock); stock page breadcrumbs go back up. |
| 4 | M | Absolute and relative views | Built | Absolute / relative-to-parent toggle in the explorer and heatmap; relative-strength pages. |
| 5 | M | Rapid timeframe selector | Built | Candle interval D/W/M/Q/Y per chart window; trailing horizons 1W/1M/3M/6M/12M are a separate control. |
| 6 | M | Voice commands | Built | Microphone in the command bar and the assistant (Web Speech API, Chrome / Edge). Spoken text runs through the same command parser. |
| 7 | M | Natural-language commands | Built | engine/nl.js: deterministic parser that shows how it read the sentence; the spec's example query is a unit test. |
| 8 | M | Responsive modern interface | Built | Dark / light mode, saved chart layouts and workspaces, no page reloads (hash routing). |
| 9 | M | Common search and filtering | Built | Command bar search over stocks, countries and pages; region / class / country / sector / cap filters; index search. |
| 10 | E | Global market command centre | Built | Command centre page. |
| 11 | E | Multi-asset context | Enhancement, not started | Fixed income / commodities / REITs heatmaps and cross-asset correlation. |
| 12 | M | Independent CW and EW index families | Built | engine/indexEngine.js; every scope has both. |
| 13 | M | Level 1: country sector-by-cap indices | Built | C:<country>\|S:<sector>\|K:<cap>, CW and EW, local and USD. |
| 14 | M | Level 2: country cap-segment indices | Built | C:<country>\|K:<cap>. |
| 15 | M | Level 3: overall country indices | Built | C:<country>. |
| 16 | M | Level 4: regional indices | Built | US, Asia, Europe, Africa, LATAM (+ Other Americas for Canada, to confirm). |
| 17 | M | Level 5: market-classification indices | Built | US, Emerging, European Developed, Other Developed. |
| 18 | M | Level 6: global equity index | Built | Each constituent sits in exactly one cell: no double counting. |
| 19 | M | Local-currency-first country calculation | Built | Country-level indices are computed in the country currency (cross rates for foreign-currency listings). |
| 20 | M | USD country index histories | Built | Date-matched FX from tas_fx_history; without history the series is labelled estimated. |
| 21 | M | Preserve both currency representations | Built | LCL and USD series stored side by side; neither replaces the other. |
| 22 | M | Historical FX mapping | Built | tas_fx_history (pair, inversion, source, fetched_at) + per-run stale / estimated flags in tas_fx. |
| 23 | M | USD regional / global comparability | Built | All cross-country indices in USD. |
| 24 | M | Correct index FX conversion mathematics | Built | USD return = price relative × FX relative from the same base date; unit-tested. |
| 25 | M | CW weighting policy | Built on a default awaiting confirmation [C] | Full market cap with constant latest share counts (estimated). Free-float and share-count history need a data source. |
| 26 | M | EW rebalancing policy | Built | Quarterly; drift between rebalances; delisted value reinvested within the cell; new listings wait for the next rebalance. |
| 27 | M | Higher-level aggregation consistency | Built | Aggregation of constituent returns via additive cap / value weights; never sums of index levels. |
| 28 | M | Historical index persistence | Built | tas_index_values (per index-year); changed history logged in tas_index_revision before any rewrite. |
| 29 | M | Index constituent-level database | Built | tas_index (meta), tas_membership (point-in-time members, caps, segments), counts and cap per day. |
| 30 | M | Comparable CW/EW universes | Built | CW and EW share identical eligibility and members (a stock without a cap joins neither). |
| 31 | M | Market calendars and data provenance | Built, with a stated limit | Holidays and missing bars carried at last close and counted; FX staleness counted. Exchange close-time alignment is by date, not intraday time. |
| 32 | C | Index base and return policy | Built on a default awaiting confirmation [C] | Base 1000 at the first quarter-end, price return, quarterly rebalance — in Methodology. |
| 33 | M | EWCW relative strength engine | Built | EWCW page; ratio EW/CW per scope. |
| 34 | M | EWCW across index hierarchy | Built | Computed for every CW/EW pair (sector, cap, country, region, classification, global). |
| 35 | M | GLOCOM integration | Built, with a stated limit | GLOCOM is read as computed by the heatmap (glocom_latest) and used in heatmap colour, screens and stock pages; its formula is not re-implemented (#37). |
| 36 | M | LOCOM integration | Needs an external input | Needs the LOCOM definition (#37). |
| 37 | C | GLOCOM / LOCOM definitions | Needs an external input | Formulas, parameters and thresholds to be supplied; nothing is invented. |
| 38 | M | CW Weight Watcher | Built | engine/weightWatcher.js; Weight Watcher page. |
| 39 | M | Stock WW | Built | Stocks in a country sector, one line each. |
| 40 | M | Sector and industry WW | Built | Sectors and industry groups in a country; sectors in regions / global. |
| 41 | M | Cap-segment WW | Built | Large / Mid / Small in a country and globally. |
| 42 | M | Country, regional and global WW | Built | Countries in regions and globally, regions in global, DM/EM in global. |
| 43 | M | WW quarterly chart behaviour | Built | Quarter-end observations, weight % on y, latest (partial quarter) at the far right. |
| 44 | M | WW line isolation | Built | Select / deselect, isolate, top-10 / all / none. |
| 45 | M | WW turning-point detection | Built | Rising, falling, turning up from a prolonged low, turning down from a high, sideways — with markers. |
| 46 | M | WW leadership drill-down | Built | Region → country → sector → stock drill. |
| 47 | M | WW export | Built | Excel export of weights and trends. |
| 48 | M | WW vs EW context | Built | WW is CW-only; EW/CW context on the EWCW page and in the explorer. |
| 49 | M | WW weight calculation integrity | Built, with a stated limit | Cap / parent cap over the parent's own constituents. Share-count changes need share history (constant shares, estimated). |
| 50 | M | RSIACC screen | Built | Charts → RSIACC. |
| 51 | M | RSIACC EMA overlay | Built | EMA 4 / 14 / 26 / 39, distinct colours. |
| 52 | M | RSCACC screen | Built | Charts → RSCACC. |
| 53 | M | RSCACC EMA overlay | Built | EMA 4 / 14 / 26 / 39. |
| 54 | M | RSIMMA screen | Built | Charts → RSIMMA. |
| 55 | M | RSIMMA short/long EMA groups | Built | Short 3-15 yellow, long 30-60 red. |
| 56 | M | RSCMMA screen | Built | Charts → RSCMMA. |
| 57 | M | RSCMMA short/long EMA groups | Built | Short 3-15 yellow, long 30-60 red. |
| 58 | M | Per-window timeframe control | Built | Each of the four windows has its own D/W/M/Q/Y selector. |
| 59 | M | Cross-panel alignment | Built | Same instrument and endpoint; scroll / zoom synced by date; shared crosshair. |
| 60 | M | RSC comparison selection | Built | Any stock or index as benchmark; applied to every RSC window; currencies aligned. |
| 61 | M | Indicator visibility controls | Built | Hide the underlying line, keep its EMAs; toggle each EMA. |
| 62 | M | MMA group visibility controls | Built | Short / long group toggles and individual lines. |
| 63 | M | True timeframe EMA calculation | Built | Bars are aggregated to the timeframe first; EMA14 weekly = 14 weekly candles. |
| 64 | M | Latest available trading date | Built | Charts end on the newest stored session; 'Latest' button; data refresh button reloads without a page reload. |
| 65 | C | Indicator calculation specification | Built on a default awaiting confirmation [C] | House RSI (= heatmap), nested RSI, EMA warm-up hidden — in Methodology. |
| 66 | M | Pattern recognition | Built, with a stated limit | Consolidation, breakout / breakdown, trend reversal, MMA compression / expansion, emerging setups. Classical shape patterns (head & shoulders, flags) are not implemented. |
| 67 | M | Crossovers and agreement | Built | EMA / MACD / RSI crosses; multi-indicator agreement and conflict. |
| 68 | M | Absolute performance filters | Built | Returns (local / USD), price levels, trend states. |
| 69 | M | New high / low screeners | Built | 20-day, 3-month, 52-week, all-time. |
| 70 | M | Relative strength ranking | Built | Stocks vs country / sector / region / global; sectors, countries, cap segments vs their market. |
| 71 | M | RSC pair matrix | Built | Stock vs sector / country / region / global, sector vs country / global, country vs region / global, EW vs CW, cap pairs. |
| 72 | M | RSC signal detection | Built | Rising / falling, 52-bar RSC high / low, upward inflection, price-RSC divergence. |
| 73 | M | MMA pattern detection | Built | Bullish / bearish alignment, compression, expansion, post-consolidation break, timeframe shift. |
| 74 | M | Early-stage opportunity scanner | Built | Eight stages with evidence. |
| 75 | M | Sector rotation dashboard | Built | Leading / Improving / Weakening / Lagging with tails and transitions. |
| 76 | M | Market breadth dashboard | Built | A/D, % above 20/50/200, new highs / lows, EW/CW, bullish MMA %, sector participation. |
| 77 | M | Breadth divergence alert | Built | Flagged on the breadth page, command centre and briefs. |
| 78 | M | Price-volume analysis | Built | Volume breakouts, unusual volume, price-volume divergence, accumulation / distribution. |
| 79 | E | Liquidity screening | Built, with a stated limit | 20-day average traded value (USD). Turnover needs share history. |
| 80 | E | Historical pattern library | Built, with a stated limit | Past occurrences of the same signal in the stock and its peers, with outcomes; no shape-similarity search. |
| 81 | E | Backtesting engine | Built | 1/3/6/12-month forward returns, hit rate, MFE / MAE, excess vs the country index. |
| 82 | M | Bias-controlled research | Built, with a stated limit | Point-in-time index members, delisted names kept, split adjustment, next-session entry. Classification and fundamentals are current, not point-in-time. |
| 83 | M | Primary multi-level heatmap | Built | Regions, DM/EM, countries, sectors, caps, stocks. |
| 84 | M | Heatmap sizing | Built | Market cap, index weight, equal. |
| 85 | M | Heatmap colouring | Built | Return, RSC, RSI, MMA, GLOCOM, fundamentals, WW, EWCW, score. |
| 86 | M | Heatmap view switches | Built | CW/EW, local/USD, relative/absolute, horizon, cap segment. |
| 87 | M | Heatmap drill-down and hover | Built | Click to drill; hover shows name, price, cap, weight, return, RSC. |
| 88 | E | Multi-chart workspace | Built | Workspace page with saved layouts. |
| 89 | E | Custom benchmarks | Built | Any stock or index as the RSC benchmark. |
| 90 | E | Watchlists and portfolio overlay | Built | Watchlists with weights, exposures and overlays. |
| 91 | E | Research notes and export | Built | Notes on stocks / sectors / countries / indices; CSV / Excel export everywhere. |
| 92 | E | Global opportunity funnel | Built | Funnel page, automatic with manual overrides. |
| 93 | M | Finxray feed integration | Needs an external input | Needs endpoint, credentials, permitted use and mapping. |
| 94 | M | Fundamental filters | Built | Growth, margins, ROE, leverage, FCF, P/E from the heatmap's fundamentals table. |
| 95 | M | IMB framework integration | Needs an external input | Needs the IMB inputs / outputs definition. |
| 96 | M | Technical-fundamental confluence | Built | Fundamentals-improving flag combined with breakout / RSC / WW in screens, alerts and score conflicts. |
| 97 | M | AI setup scoring | Built, with a stated limit | Technical, relative, participation, fundamentals, timeframe. Catalysts await Finxray (excluded, weight re-spread). |
| 98 | M | Explainable scoring | Built | Component scores, weights in force, thresholds, evidence and conflicts. |
| 99 | M | AI research assistant | Built | Answers from stored calculations with dates and chart links; ready for the GQ agent to call as tools. |
| 100 | M | Multi-condition alerts | Built | RSC+MMA, WW+RSC, 52W high+volume, sector RSC+EWCW, fundamental+breakout, custom. |
| 101 | E | Earnings event overlay | Built, with a stated limit | Result filing dates with revenue YoY on the stock chart; management commentary needs Finxray. |
| 102 | E | Historical inflection database | Built | RSC, MMA, WW, breakout, high and cross events with subsequent performance. |
| 103 | E | AI market briefs | Built | Daily / weekly / monthly briefs. |
| 104 | E | Custom screening workflow builder | Built | Screener with saved screens. |
| 105 | E | Market regime detection | Built | Trending / consolidating / high-volatility with efficiency ratio and volatility percentile. |
| 106 | M | Unified security master | Built | tas_security: canonical country, region, class, currency, GICS, cap segment, status. |
| 107 | M | Historical universe and membership | Built, with a stated limit | Point-in-time index membership at every rebalance, delisted kept. Historical classification changes are not available. |
| 108 | M | Corporate action engine | Built, with a stated limit | Splits / bonuses / consolidations from tas_corporate_action; split candidates detected. Dividends (total return) need a feed. |
| 109 | M | Reliable data ingestion | Built | Stale prices, missing sessions, splits, OHLC errors, missing caps, unclassified sectors, unmapped geography, FX gaps. |
| 110 | M | Calculation audit trail | Built | tas_calc_run with methodology version + hash; revisions log. |
| 111 | M | Rebuild / replay capability | Built | Re-running the engine recomputes history deterministically and logs every change. |
| 112 | M | Actual vs estimated data labels | Built | Estimated caps, carried FX, stale constituents and demo data are labelled. |
| 113 | M | Reusable calculation services | Built | One engine (engine/) for indices, RSC, WW, FX, charts and heatmaps, in batch and in the browser. |
| 114 | E | APIs and structured exports | Built | CSV / Excel / PDF / PNG exports; Supabase REST on tas_* tables and tas_index_series(); the TA server's authenticated /api (login or agent secret) for analysis, screens, alerts, tasks and watchlists. |
| 115 | E | Performance and caching | Built | Precomputed batch results, compact screen rows, cached series, Web Worker in demo. |
| 116 | C | Integration feasibility | Built on a default awaiting confirmation [C] | Checklist in Data centre → Integrations and docs/METHODOLOGY.md. |
