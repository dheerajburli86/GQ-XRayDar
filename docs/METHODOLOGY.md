# Methodology

Source of truth: `engine/methodology.js`. Every run stores the full methodology
object and its hash in `tas_calc_run`, so any published number can be traced to the
rules that produced it. Items marked **[C]** are defaults awaiting sign-off.

## Universe and classification

- Stocks only: `us_stocks` (CS, ADRC), `global` (stock), `india_stocks` (stock).
  Rows the heatmap marks as non-companies (ETF, INDEX, SGB, G-Sec, debt, InvIT,
  pre-merger SPAC, no-recent-trades) are excluded.
- Inactive US and global rows are **kept** (delisted companies; no survivorship bias).
  Inactive India rows are excluded, because the heatmap also uses `is_active=false`
  to mute fund codes and bonds in that universe.
- Sector = GICS sector (11) / industry group (25) via the heatmap's own crosswalk
  (vendored in `engine/reference/`), identical in every market.
- Country names are canonicalised (`Hong_kong` → Hong Kong). Region and market
  classification are **derived** from the country, never read from the row. **[C]**
  Regions: US, Asia (incl. Japan, Australia/NZ, Israel, Gulf), Europe (incl. Turkey,
  Poland, Greece), Africa, LATAM, *Other Americas* (Canada). Classification: US,
  Emerging, European Developed, Other Developed.

## Index construction (CW and EW)

- Calendar: every date on which at least 50 instruments traded, from the start date.
- Rebalance: last session of each calendar quarter. **[C]**
- Eligibility at a rebalance: ≥ 60 sessions of history, traded within the last 10
- Minimum market cap at each rebalance (owner, 2026-11-19): USD 1B for developed markets, USD 200M for emerging (`eligibility.minCapUsd`; caps are estimated from the latest share count). Not applied to India, which has no reliable cap yet (equal-weight indices, no size filter, until a cap source exists). Methodology 1.1.0.
  sessions, market cap known. A stock without a cap joins **neither** CW nor EW, so the
  two families always hold identical constituents.
- Cap segments per country at each rebalance, by cumulative market cap sorted
  descending: Large to 70%, Mid to 85%, Small to 99%; the last 1% (micro) is excluded
  from every index. **[C]**
- Cell = country × sector × cap segment. Every index is an exact aggregation of cells:
  - CW: `r = Σ cap(t-1)·r_i / Σ cap(t-1)` over constituents alive at *t*.
  - EW: each constituent starts at value 1 at the rebalance and drifts; a cell's value
    is `n · G` (G = its EW growth since the rebalance); `r = Σ n·G(t-1)·r_cell / Σ n·G(t-1)`.
- Market cap history = latest share count × historical price (**estimated**: no share
  history exists). Shares = latest market cap ÷ latest close. **[C]** Free float not applied.
- Delisted: leaves on its last bar; EW value reinvested pro rata within its cell.
  New listings wait for the next rebalance.
- Holidays / missing bars: constituent carried at its last close (return 0 that day) and
  counted in `n_stale`.
- Split guard **[C]**: a one-day ratio > 40% that lies within 3% of a split factor
  (2, 3, 4, 5, 10, 20 or inverse) is treated as an unadjusted corporate action — its
  return is zeroed in the indices only and reported in data health until the action is
  recorded in `tas_corporate_action` (which then adjusts the stock's history).
- Base 1000 at the first rebalance date; price return. **[C]**

### Currency

- Rates are stored as **USD per one unit** (`tas_fx_history`), with the provider pair
  and whether it was inverted. Minor units (GBX, ZAC, ILA) use the major rate ÷ 100.
- Constituent returns: `r_usd = (P_t/P_{t-1})·(fx_t/fx_{t-1}) − 1`; country-currency
  returns use the cross rate, so a UK stock quoted in USD lands correctly in a GBP index.
- Country indices are published in the country currency **and** in USD; both are kept.
  Regional, classification and global indices are USD only.
- Missing fixings carry the previous rate forward (counted as stale); a currency with no
  history uses its latest rate as a constant and every USD series using it is labelled
  estimated.

### Persistence

`tas_index_values` stores one row per index per year. A year row is rewritten only if
its content hash changed; every historical date whose level changed is first logged in
`tas_index_revision` with the run that changed it.

## Weight Watcher

Weight = constituent cap ÷ parent aggregate cap over the parent CW index's own
constituents, at every quarter-end rebalance, plus the latest date (partial quarter).
Parents: stock in country-sector; sector / industry group / cap segment in country;
country and sector in region; country in classification; region, classification,
country, sector and cap segment in global. Turning points: rising / falling (two
consecutive moves), turn up from a prolonged low / turn down from a high (prior
observation is the extreme of the last 8 quarters), sideways (±5% over 4 observations).

## Indicators

- EMA: pandas `ewm(span=N, adjust=False)`, seeded with the first value; values before
  the N-th candle are warm-up and hidden.
- RSI(14) **[C]** "house": `ewm(alpha=1/14)` of gains and losses seeded on the first change
  (identical to the heatmap). "wilder" (SMA seed) is available in the methodology.
- RSI of RSI = the same RSI applied to the RSI series (each level needs 14 more candles).
- **True timeframe**: bars are aggregated to the chosen timeframe first (weekly candle =
  the week's sessions, stamped with its last session); EMA 14 weekly = 14 weekly candles.
- RSC = instrument ÷ benchmark on the same candle key, both in one currency (USD when
  they differ), rebased to 100 at the first common candle.
- MMA: short 3,5,8,10,12,15; long 30,35,40,45,50,60. Bullish alignment = every short
  EMA above every long EMA and both fans ordered fastest-on-top. Compression = short-group
  spread below 2% (D) / 4% (W) / 8% (M) of price.

## Signals, stages, events

- Consolidation: 20-bar high-low range within 4 ATR(14). Breakout: close above the
  prior 20-bar high within 5 bars of a consolidation; volume-confirmed at ≥ 1.5× the
  50-bar average volume.
- Early stage (weekly): downtrend → slowing decline → consolidation → MMA compression →
  RSC turn → breakout → volume confirmation → established uptrend (≥ 8 weeks of bullish
  alignment). The most advanced satisfied stage wins; evidence is stored.
- Events (inflection database) carry forward returns from the **next** session's close at
  1/3/6/12 months, excess vs the country CW index, and MFE/MAE over 63 sessions. Each
  event type has a cooldown (20 daily / 8 weekly bars). The stored window is the last
  6 years; the backtest scorecard uses the full history.

## Breadth, rotation, regime, EWCW

- Breadth per scope and date: advancers/decliners (traded only), A/D line, % above
  20/50/200-day EMA, 52-week highs/lows, % with a bullish weekly MMA (last completed week).
- Divergence: index up ≥ 2% over 20 sessions while % above 50-day falls ≥ 5 pts, or the
  A/D line falls, or new lows outnumber new highs.
- Rotation **[C]** (GQ formula): RS-Ratio = 100 × RSC / SMA26w(RSC); RS-Momentum = 100 ×
  RS-Ratio / RS-Ratio 4 weeks earlier.
- Regime: high volatility if 20-day realised vol is in the top 20% of its 3-year history;
  trending if the 26-week efficiency ratio ≥ 0.35; otherwise consolidating.
- EWCW = EW level ÷ CW level × 100 for the same scope and currency.

## AI setup score

Components 0–100: technical, relative, participation (sector % above 50-day in the
stock's country), fundamentals (percentiles within the country), catalysts (no feed yet),
timeframe confirmation. Weights default 25/25/10/15/5/20 %; unavailable components are
excluded and weights re-spread. Evidence, thresholds and conflicts are stored per stock.

## Not decided / not available

GLOCOM and LOCOM formulas, IMB, Finxray, free-float, share-count history, dividends
(total return), point-in-time classifications. Each is listed in *Data centre →
Integrations / Methodology* and in `docs/REQUIREMENTS_TRACE.md`.
