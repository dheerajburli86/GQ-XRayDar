# Requirement traceability

Generated from `src/requirements.js` (`npm run trace`). Also shown in the app: *Data centre → Requirement trace*.

**Built, with a stated limit:** 17 · **Built:** 128 · **Built on a default awaiting confirmation [C]:** 4 · **Needs an external input:** 4

| # | Tag | Requirement | Status | Where / notes |
|---|---|---|---|---|
| 1 | M | Unified AI global market intelligence platform | Built, with a stated limit | Technical, relative, absolute, fundamental, index, Weight Watcher and GLOCOM in one app. IMB / ETI characteristics come from the ETI project; Finxray plugs in once its feed exists (#93). |
| 2 | M | Global coverage | Built, with a stated limit | Stocks, GICS sectors / industry groups, countries, regions and DM/EM classifications across US, India and the 39-country global universe; commodity, crypto and currency products as their own asset classes; REITs as the GICS Equity REITs group; fixed income on the Cross-asset page (bond funds from FMP, the heatmap carries none). Spot crypto pairs are inactive in the heatmap and stay out. |
| 3 | M | Top-down and bottom-up navigation | Built | Top-down explorer (global → region → country → cap → sector → industry group → stock); stock page breadcrumbs go back up. |
| 4 | M | Absolute and relative views | Built | Absolute / relative-to-parent toggle in the explorer and heatmap; relative-strength pages. |
| 5 | M | Rapid timeframe selector | Built | Candle interval D/W/M/Q/6M (half-yearly)/9M/Y per chart window; trailing horizons 1W/1M/3M/6M/12M are a separate control. |
| 6 | M | Voice commands | Built | Microphone in the command bar and the assistant (Web Speech API, Chrome / Edge). Spoken text runs through the same command parser. |
| 7 | M | Natural-language commands | Built | engine/nl.js: deterministic parser that shows how it read the sentence; the spec's example query is a unit test. |
| 8 | M | Responsive modern interface | Built | Dark / light mode, saved chart layouts and workspaces, no page reloads (hash routing). |
| 9 | M | Common search and filtering | Built | Command bar search over stocks, countries and pages; region / class / country / sector / cap filters; index search. |
| 10 | E | Global market command centre | Built | Command centre page. |
| 11 | E | Multi-asset context | Built | Cross-asset page: equities, REITs, commodities, crypto, currencies and fixed income in USD: returns heatmap, weekly-return correlation matrix, volatility and relative strength vs global equities (tas_xasset, refreshed daily by the server). |
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
| 35 | M | GLOCOM integration | Built | Heatmap rule sheet (1W / 6M / 1Y percentiles, 9 labels, 5 colour bands) in engine/glocom.js. Stocks use the heatmap's own glocom_latest where it exists; industries and sectors are rated per market and globally, with rank history and moves (GLOCOM / LOCOM page). |
| 36 | M | LOCOM integration | Built | Same rule sheet with a stock's own industry group as the peer set (3+ stocks). Interpretation of 'local' to be confirmed. |
| 37 | C | GLOCOM / LOCOM definitions | Built | Rule sheet supplied 2026-11-15; colours dark green / light green / yellow / light red / dark red. |
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
| 66 | M | Pattern recognition | Built | Consolidation, breakout / breakdown, trend reversal, MMA compression / expansion, emerging setups, and classical chart patterns (head & shoulders and inverse, double / triple tops and bottoms, triangles, wedges, rectangles, bull / bear flags) with their level, measured move and confirmation; screenable and drawn in the chart lab. |
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
| 95 | M | IMB framework integration | Built | IMB / ETI characteristics (6 IMB, 4 ETI gates) read from the ETI project, copied hourly into tas_eti_characteristic; page, screen fields, stock page, change log and alerts. Shown as yes / no / unknown only, never scored or ranked (sir's rule). |
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
| 114 | E | APIs and structured exports | Built | CSV / Excel / PDF / PNG exports; Supabase REST on tas_* tables and tas_index_series(); the TA server's authenticated /api (login or agent secret) for analysis, screens, alerts, tasks and watchlists; the token-based /v1 quant API and WebSocket stream (#150). |
| 115 | E | Performance and caching | Built | Precomputed batch results, compact screen rows, cached series, Web Worker in demo. |
| 116 | C | Integration feasibility | Built on a default awaiting confirmation [C] | Checklist in Data centre → Integrations and docs/METHODOLOGY.md. |
| 117 | M | Half-yearly and 9-month timeframes | Built | Every chart window (stacked screens, chart lab, workspace, stock page) offers 6M and 9M candles; 9-month candles run on a fixed 9-month grid from January 2000. |
| 118 | M | User-built indices with Weight Watcher | Built | Indices → My indices: any stocks, CW / EW / own weights, USD or local; history plus each member's weight quarter by quarter with trend flags (engine/customIndex.js). |
| 119 | M | Derivatives coverage: index and stock futures & options | Built | NSE end-of-day files collected nightly by the server (tas_fo_*): every listed expiry and strike, lot sizes, OI, volume, settlement. |
| 120 | M | Commodity, currency, interest-rate and international derivatives | Needs an external input | Adapters defined (engine/deriv/sources.js); need MCX / NSE CDS / BSE files or licensed feeds for CME, Eurex, CBOE, SGX, ICE. |
| 121 | M | Contract master and exchange-aware details | Built | Underlying, expiry, strike, type, lot, settlement style and last trading day from the bhavcopy; physical-settlement window flagged for stock contracts. |
| 122 | M | Option chain workstation | Built, with a stated limit | Chain with OI, change, volume, IV, Greeks, PCR by strike, moneyness by spot or synthetic forward, strike range, heat colouring, multi-expiry view, session time machine, CSV / Excel / JSON export. Bid / ask, live refresh and intraday series need a live feed. |
| 123 | M | PCR, IV metrics, IV rank and percentile | Built | Strike / expiry / overall PCR by OI and volume with history; strike IV, ATM IV history, IV rank and percentile with the look-back shown. |
| 124 | M | First, second and third-order Greeks | Built | Delta, gamma, theta, vega, rho, vanna, charm, vomma, speed, zomma, colour (unit-tested against finite differences), model audit panel. |
| 125 | M | Synthetic futures, parity and box-spread rates | Built | Per strike, with conversion / reversal gaps vs the future; labelled as indications (closes are not simultaneous). |
| 126 | M | OI analytics, writing vs buying, build-up classes | Built | Long / short build-up, short covering, long unwinding with evidence and confidence; option writing / buying / covering / unwinding per contract; OI walls, concentration (HHI, top-strike share), wall migration. |
| 127 | M | MWPL, F&O ban and participant-wise OI | Built | Exchange-published, labelled as fact; near-ban (80%) and ban (95%) flags; FII / DII / Pro / Client net positions with history. |
| 128 | M | Futures, basis, carry, rollover and continuous series | Built | Near / next / far, basis, annualised carry, implied dividend yield, fair value, rollover vs 3- and 6-cycle averages, roll cost, curve, five continuous-series roll methods, cash-futures arbitrage screen net of Indian charges. |
| 129 | M | Volatility suite | Built | Smile, 25 / 10-delta skew, SVI fit with an arbitrage check, surface grid, term structure and forward vol, realised vol (close-to-close, Parkinson, Garman-Klass, Yang-Zhang), cones, VRP, regimes, IV alerts, a statistical IV projection, results-date IV crush. |
| 130 | M | Pricing models | Built | Black-Scholes-Merton, Black-76, CRR binomial, trinomial, Barone-Adesi-Whaley, Bachelier. |
| 131 | M | Dealer gamma (GEX) and gamma flip | Built | By strike and across spot levels, with the dealer-positioning assumption stated. |
| 132 | M | Strategy builder and analyser | Built, with a stated limit | 53 templates in every listed group, free multi-leg builder, payoff at expiry and T+N, max profit / loss, breakevens, PoP, touch, EV, Greeks, scenario matrix, Indian costs and taxes, comparison, recommender, adjustments, saved positions with aggregated risk, trade journal. Margin is a labelled stress estimate: exchange SPAN needs the SPAN files. |
| 133 | M | Expiry & event war room | Built | Max pain and its drift, walls, expected moves (straddle and IV), probabilities, gamma flip, decay curve, written synthesis in probabilistic language, implied vs realised move audit. |
| 134 | M | Catalyst calendar | Built, with a stated limit | Expiries, results dates and corporate actions from data; macro / policy dates added by hand until a calendar feed is connected. |
| 135 | M | Unusual activity | Built, with a stated limit | End-of-day volume z-scores, volume / OI, OI jumps, premium, deep ITM / far OTM, flow attribution with confidence. Tape, sweeps, blocks and order-book depth need a live feed. |
| 136 | M | Derivatives & confluence screener | Built | Preset scans for every listed group, custom conditions, plain-English queries, saved scans with new-match alerts, technical + derivatives confluence and conflicts. |
| 137 | M | Derivatives research and backtests | Built | Forward returns and hit rates after each derivatives signal; participant positioning vs the index. |
| 138 | E | Live order flow, depth, footprint and time & sales | Needs an external input | Needs a dedicated live broker stream (not the heatmap's Kite session). |
| 139 | E | Order management | Needs an external input | Optional by design; needs a broker connection and explicit approval. Practice positions only. Freeze-quantity slicing rules are defined for when a broker is connected. |
| 140 | M | Portfolio risk & attribution | Built, with a stated limit | Derivatives → Portfolio risk: raw and beta-weighted Greeks, session P&L split into delta / gamma / theta / vega / rho and residual, stress grid (spot ±1-15% × IV −20% to +100%, beta-scaled and correlation breakdown), parametric / historical / Monte Carlo VaR and expected shortfall, hedge calculator. Multi-account / multi-broker books need broker connections. |
| 141 | M | Position sizing, risk limits and margin monitor | Built, with a stated limit | Fixed-fractional, volatility-target, Greek-budget and fractional-Kelly sizing; hard / soft limits on underlying and expiry concentration, net Greeks, daily loss and margin use, with logged overrides; margin use and a what-if with hedge benefit. Margin is a stress estimate, not SPAN. |
| 142 | M | Monte Carlo and jump-diffusion simulation | Built | Strategy P&L distribution under Merton jumps and Heston-type stochastic volatility, seeded and reproducible; correlated Monte Carlo VaR with a correlation-shift control. |
| 143 | M | Derivatives alerts and delivery | Built | 30 edge-triggered rules on futures price, OI spikes / flips, PCR extremes, MWPL near-ban / ban / exit, basis, IV rank / percentile, IV crush / expansion, skew shifts, term inversion, gamma-flip crossings, OI walls, price-OI divergence, and strategy P&L target / stop, breakeven, PoP, margin and physical-delivery alerts; priority tiers, cooldowns, Telegram, push, signed webhook, email (when configured) and searchable history. Intraday triggers need a live feed. |
| 144 | M | Walk-forward, sensitivity and calibration | Built | Anchored walk-forward of any alert rule's parameters with out-of-sample efficiency, parameter sensitivity grids, Brier score / log loss / calibration curve of the option market's probabilities, IV forecast audit, false-positive rate and feature-drift (PSI). |
| 145 | M | Trade journal and AI risk coach | Built | Structured journal (strategy tag, thesis, size, planned max loss, market snapshot at entry, adjustments, fees / STT, post-trade review); with consent, the coach flags losses past plan, holding losers, size before events, size after losses, cost drag and repeated adjustments, and the regimes and strategies that worked. |
| 146 | M | Evidence, counter-evidence and invalidation | Built | Every strategy recommendation carries supporting drivers, counter-evidence, a confidence score, the historical sample and hit rate of the same payoff, and explicit price / IV / OI invalidation triggers; outputs are tagged exchange fact, calculation or model estimate. |
| 147 | M | AI audit logging and model versioning | Built | Append-only tas_audit and tas_ai_audit (the database refuses edits): agent chats, recommender, Monte Carlo, coach and risk runs with model version, engine version, parameters, input snapshot and hash, output and timing; every calculation component has a version (engine/versions.js). |
| 148 | M | Quote hygiene | Built | Each contract is flagged (no trade, dead, stale, minimum tick, below intrinsic, locked, IV failure); IV and Greeks are suppressed on invalid quotes; counts shown on the chain and returned by the API. Crossed bid / ask needs a live feed. |
| 149 | M | Exchange capability matrix and rule engines | Built | Per-exchange matrix (NSE, BSE, NSE CDS, MCX, CME, Cboe, Eurex, SGX, ICE) of what is available, needs a feed or a licence; NSE / BSE rule engines (MWPL thresholds, freeze quantities, expiry and settlement rules) used by alerts and pages. |
| 150 | E | Quant REST and WebSocket API | Built | /v1 endpoints for derivatives summaries, chains with Greeks, surfaces, screens, participant data, index series and stock analysis; WebSocket stream of new sessions and own alerts; personal tokens (hashed), scopes, per-token rate limits, every call audited (docs/API.md). |
| 151 | E | Role-based access and compliance audit trail | Built | Roles admin / analyst / viewer / disabled enforced by the server, admin role management, audit trail of API queries, AI outputs, risk-limit overrides, role and token changes. |
| 152 | E | Operational observability | Built | Data centre → Operations: feed status and session age, missing contract masters, engine runs, alert volume, channel errors and Telegram delivery delay, failed tasks, API routes with p50 / p95 latency, token usage, stream clients. |
| 153 | M | Fibonacci and derivatives levels on charts | Built | Fibonacci retracements / extensions, call / put OI walls, max pain and the gamma-flip estimate drawn with support / resistance and volume profile in the chart lab. |
