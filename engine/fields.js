// One registry of every screenable / displayable field. Screens, tables,
import { ETI_CHARACTERISTICS } from "./eti.js";
// heatmap colouring, alerts and the natural-language parser all read fields
// through here, so a "3M return" means the same number everywhere.
//
// A ROW is { sec, snap, f, ww, glocom, score } -- security master, technical
// snapshot, fundamental metrics, weight-watcher trend, GLOCOM (when connected)
// and the AI setup score.

import { PATTERN_INFO } from "./patterns.js";
const g = (o, path) => path.split(".").reduce((x, k) => (x == null ? x : x[k]), o);

export const FIELD_GROUPS = ["Identity", "Returns", "Price levels", "Trend & MMA", "Momentum", "Relative strength", "Volume & liquidity", "Patterns", "Fundamentals", "Weight Watcher", "Scores", "GLOCOM", "IMB / ETI"];

const F = [];
const IDENT = new Set(["symbol", "name", "country", "region", "classification", "sector", "industryGroup", "industry", "cap", "capUsd", "currency", "assetClass"]);
// A row may carry `flat` (decoded screen row) instead of the full snapshot; a
// field then reads its precomputed value. Identity fields always read `sec`.
const add = (key, label, group, type, get, extra = {}) =>
  F.push({ key, label, group, type, get: IDENT.has(key) ? get : (r) => (r.flat ? r.flat[key] : get(r)), ...extra });

// identity
add("symbol", "Symbol", "Identity", "text", (r) => r.sec.symbol);
add("name", "Name", "Identity", "text", (r) => r.sec.name);
add("country", "Country", "Identity", "cat", (r) => r.sec.country);
add("region", "Region", "Identity", "cat", (r) => r.sec.region);
add("classification", "Market class", "Identity", "cat", (r) => r.sec.classification);
add("sector", "Sector", "Identity", "cat", (r) => r.sec.sector);
add("industryGroup", "Industry group", "Identity", "cat", (r) => r.sec.industryGroup);
add("industry", "Industry", "Identity", "cat", (r) => r.sec.industry);
add("cap", "Cap segment", "Identity", "cat", (r) => r.sec.capSegment);
add("capUsd", "Market cap (USD)", "Identity", "money", (r) => r.sec.capUsdNow ?? r.sec.capUsd);
add("currency", "Currency", "Identity", "cat", (r) => r.sec.currency);
add("assetClass", "Asset class", "Identity", "cat", (r) => r.sec.assetClass || "Stock", { values: ["Stock", "ETF", "Index", "Commodity", "Crypto", "Currency"] });

// returns
for (const h of ["1D", "1W", "1M", "3M", "6M", "12M", "YTD"]) {
  add(`ret${h}`, `Return ${h} (local)`, "Returns", "pct", (r) => r.snap?.ret?.[h]);
  if (h !== "YTD") add(`retUsd${h}`, `Return ${h} (USD)`, "Returns", "pct", (r) => r.snap?.retUsd?.[h]);
}

// price levels
add("close", "Close", "Price levels", "num", (r) => r.snap?.close);
add("closeUsd", "Close (USD)", "Price levels", "num", (r) => r.snap?.closeUsd);
add("pctFromHigh52", "% from 52W high", "Price levels", "pct", (r) => r.snap?.day?.pctFromHigh52);
add("pctFromLow52", "% above 52W low", "Price levels", "pct", (r) => r.snap?.day?.pctFromLow52);
add("pctFromAth", "% from all-time high", "Price levels", "pct", (r) => r.snap?.day?.pctFromAth);
add("atHigh52", "At 52W high", "Price levels", "bool", (r) => r.snap?.day?.atHigh52);
add("atLow52", "At 52W low", "Price levels", "bool", (r) => r.snap?.day?.atLow52);
add("nearHigh52", "Within 5% of 52W high", "Price levels", "bool", (r) => r.snap?.day?.nearHigh52);
add("athBreak", "All-time high break", "Price levels", "bool", (r) => r.snap?.day?.athBreak);
add("atlBreak", "All-time low break", "Price levels", "bool", (r) => r.snap?.day?.atlBreak);
add("newHigh20", "New 20-day high", "Price levels", "bool", (r) => r.snap?.day?.newHigh20);
add("newHigh63", "New 3-month high", "Price levels", "bool", (r) => r.snap?.day?.newHigh63);
add("newLow20", "New 20-day low", "Price levels", "bool", (r) => r.snap?.day?.newLow20);
add("newLow63", "New 3-month low", "Price levels", "bool", (r) => r.snap?.day?.newLow63);

// MMA on the longer timeframes (quarterly / yearly) for the squeeze & breakout scanner
for (const tf of ["Q", "Y"]) {
  const T = { Q: "Quarterly", Y: "Yearly" }[tf];
  add(`mma${tf}`, `MMA state (${T})`, "Trend & MMA", "cat", (r) => r.snap?.tf?.[tf]?.mma, { values: ["bull", "above", "mixed", "below", "bear"] });
  add(`mmaBull${tf}`, `MMA bullish alignment (${T})`, "Trend & MMA", "bool", (r) => r.snap?.tf?.[tf]?.mma === "bull");
  add(`compression${tf}`, `MMA compression (${T})`, "Trend & MMA", "bool", (r) => r.snap?.tf?.[tf]?.compression);
  add(`postConsBreak${tf}`, `Post-consolidation MMA break (${T})`, "Trend & MMA", "bool", (r) => r.snap?.tf?.[tf]?.postConsBreak);
  add(`rsi${tf}`, `RSI (${T})`, "Momentum", "num", (r) => r.snap?.tf?.[tf]?.rsi);
}
// trend & MMA per timeframe
for (const tf of ["D", "W", "M"]) {
  const T = { D: "Daily", W: "Weekly", M: "Monthly" }[tf];
  add(`rsiDivergence${tf}`, `RSI divergence (${T})`, "Momentum", "cat", (r) => r.snap?.tf?.[tf]?.rsiDivergence, { values: ["bullish", "bearish"] });
  if (tf !== "M") {
    add(`candleBull${tf}`, `Bullish candle pattern (${T})`, "Patterns", "bool", (r) => r.snap?.tf?.[tf]?.candleBull);
    add(`candleBear${tf}`, `Bearish candle pattern (${T})`, "Patterns", "bool", (r) => r.snap?.tf?.[tf]?.candleBear);
    add(`candles${tf}`, `Candle patterns (${T})`, "Patterns", "text", (r) => (r.snap?.tf?.[tf]?.candles || []).join(", ") || null);
    add(`chartPattern${tf}`, `Chart patterns (${T})`, "Patterns", "text", (r) => (r.snap?.tf?.[tf]?.chartPatterns || []).map((x) => `${PATTERN_INFO[x.k]?.label || x.k} (${x.s})`).join(", ") || null);
    add(`chartPatternBull${tf}`, `Bullish chart pattern (${T})`, "Patterns", "bool", (r) => (r.snap?.tf?.[tf]?.chartPatterns || []).some((x) => x.d > 0 || (x.d === 0 && x.s === "broke up")));
    add(`chartPatternBear${tf}`, `Bearish chart pattern (${T})`, "Patterns", "bool", (r) => (r.snap?.tf?.[tf]?.chartPatterns || []).some((x) => x.d < 0 || (x.d === 0 && x.s === "broke down")));
    add(`chartPatternConfirmed${tf}`, `Chart pattern confirmed by a break (${T})`, "Patterns", "bool", (r) => (r.snap?.tf?.[tf]?.chartPatterns || []).some((x) => x.s !== "forming"));
  }
  add(`mma${tf}`, `MMA state (${T})`, "Trend & MMA", "cat", (r) => r.snap?.tf?.[tf]?.mma, { values: ["bull", "above", "mixed", "below", "bear"] });
  add(`mmaBull${tf}`, `MMA bullish alignment (${T})`, "Trend & MMA", "bool", (r) => r.snap?.tf?.[tf]?.mma === "bull");
  add(`mmaBear${tf}`, `MMA bearish alignment (${T})`, "Trend & MMA", "bool", (r) => r.snap?.tf?.[tf]?.mma === "bear");
  add(`mmaNewBull${tf}`, `MMA just turned bullish (${T})`, "Trend & MMA", "bool", (r) => r.snap?.tf?.[tf]?.mmaNew === "bull");
  add(`compression${tf}`, `MMA compression (${T})`, "Trend & MMA", "bool", (r) => r.snap?.tf?.[tf]?.compression);
  add(`expansion${tf}`, `MMA expansion (${T})`, "Trend & MMA", "bool", (r) => r.snap?.tf?.[tf]?.expansion);
  add(`postConsBreak${tf}`, `Post-consolidation MMA break (${T})`, "Trend & MMA", "bool", (r) => r.snap?.tf?.[tf]?.postConsBreak);
  add(`shortSpread${tf}`, `Short-MMA spread % (${T})`, "Trend & MMA", "num", (r) => r.snap?.tf?.[tf]?.shortSpread);
  add(`rsi${tf}`, `RSI (${T})`, "Momentum", "num", (r) => r.snap?.tf?.[tf]?.rsi);
  add(`rsi2${tf}`, `RSI of RSI (${T})`, "Momentum", "num", (r) => r.snap?.tf?.[tf]?.rsi2);
  add(`macd${tf}`, `MACD above signal (${T})`, "Momentum", "bool", (r) => r.snap?.tf?.[tf]?.macd === "bull");
  add(`macdCross${tf}`, `MACD cross (${T})`, "Momentum", "cat", (r) => r.snap?.tf?.[tf]?.macdCross, { values: ["bull", "bear"] });
  add(`consolidation${tf}`, `Consolidation (${T})`, "Patterns", "bool", (r) => r.snap?.tf?.[tf]?.consolidation);
  add(`breakout${tf}`, `Breakout, last 5 bars (${T})`, "Patterns", "bool", (r) => r.snap?.tf?.[tf]?.breakoutRecent);
  add(`breakdown${tf}`, `Breakdown (${T})`, "Patterns", "bool", (r) => r.snap?.tf?.[tf]?.breakdown);
  add(`reversalUp${tf}`, `Trend reversal up (${T})`, "Patterns", "bool", (r) => r.snap?.tf?.[tf]?.reversalUp);
  add(`reversalDown${tf}`, `Trend reversal down (${T})`, "Patterns", "bool", (r) => r.snap?.tf?.[tf]?.reversalDown);
  add(`trendUp${tf}`, `Uptrend (${T})`, "Trend & MMA", "bool", (r) => r.snap?.tf?.[tf]?.trendUp);
}
// owner's multi-period consolidation -> breakout (engine/consolidation.js), on the price pane
// (as on his RSIMMA screen) and on the RSC pane against the country index (as on RSCMMA)
const BOX_STATES = ["consolidating", "fan_up", "fan_down"];
for (const tf of ["D", "W", "M", "Q"]) {
  const T = { D: "Daily", W: "Weekly", M: "Monthly", Q: "Quarterly" }[tf];
  const P = (r) => r.snap?.tf?.[tf]?.mmaBox, Q = (r) => r.snap?.tf?.[tf]?.rscBox;
  add(`boxState${tf}`, `Yellow/red averages: state (${T})`, "Trend & MMA", "cat", (r) => P(r)?.st, { values: BOX_STATES });
  add(`boxSince${tf}`, `Yellow/red averages: state since (${T})`, "Trend & MMA", "text", (r) => P(r)?.since);
  add(`boxBreakout${tf}`, `Breakout from consolidation, recent (${T})`, "Trend & MMA", "bool", (r) => P(r)?.rUp);
  add(`boxBreakdown${tf}`, `Breakdown from consolidation, recent (${T})`, "Trend & MMA", "bool", (r) => P(r)?.rDn);
  add(`boxBreakoutDate${tf}`, `Last breakout date (${T})`, "Trend & MMA", "text", (r) => P(r)?.upE);
  add(`boxStartDate${tf}`, `Last consolidation start (${T})`, "Trend & MMA", "text", (r) => P(r)?.upS);
  add(`boxAge${tf}`, `Candles since last breakout (${T})`, "Trend & MMA", "num", (r) => P(r)?.upAge);
  add(`boxTurn${tf}`, `Last breakout turned a downtrend (${T})`, "Trend & MMA", "bool", (r) => P(r)?.upTurn);
  add(`rscBoxState${tf}`, `RSC yellow/red averages: state (${T})`, "Relative strength", "cat", (r) => Q(r)?.st, { values: BOX_STATES });
  add(`rscBoxBreakout${tf}`, `RSC breakout from consolidation, recent (${T})`, "Relative strength", "bool", (r) => Q(r)?.rUp);
  add(`rscBoxBreakoutDate${tf}`, `RSC last breakout date (${T})`, "Relative strength", "text", (r) => Q(r)?.upE);
}
// how many of the six higher-timeframe screens (price and RSC on weekly, monthly, quarterly) show
// a recent breakout / are consolidating now. The owner: the more higher-timeframe screens confirm,
// the stronger. A count, not a score.
const HIGHER = ["W", "M", "Q"];
add("boxBreakoutScreens", "Breakouts on weekly / monthly / quarterly screens (of 6)", "Trend & MMA", "num",
  (r) => { const t = r.snap?.tf; if (!t) return null; let k = 0; for (const tf of HIGHER) { if (t[tf]?.mmaBox?.rUp) k++; if (t[tf]?.rscBox?.rUp) k++; } return k; });
add("boxConsolidatingScreens", "Consolidating on weekly / monthly / quarterly screens (of 6)", "Trend & MMA", "num",
  (r) => { const t = r.snap?.tf; if (!t) return null; let k = 0; for (const tf of HIGHER) { if (t[tf]?.mmaBox?.st === "consolidating") k++; if (t[tf]?.rscBox?.st === "consolidating") k++; } return k; });
// standard studies (owner's feature list, item 1), daily and weekly candles
for (const tf of ["D", "W"]) {
  const T = tf === "D" ? "Daily" : "Weekly";
  const S = (r) => r.snap?.tf?.[tf]?.studies;
  add(`stochK${tf}`, `Stochastic %K slow (${T})`, "Momentum", "num", (r) => S(r)?.stochK);
  add(`stochD${tf}`, `Stochastic %D slow (${T})`, "Momentum", "num", (r) => S(r)?.stochD);
  add(`adx${tf}`, `ADX (${T})`, "Momentum", "num", (r) => S(r)?.adx);
  add(`diBull${tf}`, `+DI above -DI (${T})`, "Momentum", "bool", (r) => S(r)?.diBull);
  add(`supertrendUp${tf}`, `Supertrend up (${T})`, "Trend & MMA", "bool", (r) => (S(r)?.st == null ? null : S(r).st > 0));
  add(`supertrendFlip${tf}`, `Supertrend changed direction on the last candle (${T})`, "Trend & MMA", "bool", (r) => S(r)?.stFlip);
  add(`sarUp${tf}`, `Parabolic SAR below price (${T})`, "Trend & MMA", "bool", (r) => (S(r)?.sar == null ? null : S(r).sar > 0));
  add(`ichimokuCloud${tf}`, `Price vs Ichimoku cloud (${T})`, "Trend & MMA", "cat", (r) => S(r)?.cloud, { values: ["above", "inside", "below"] });
  add(`cmf${tf}`, `Chaikin Money Flow x100 (${T})`, "Volume & liquidity", "num", (r) => S(r)?.cmf);
}
add("above20", "Above 20-day EMA", "Trend & MMA", "bool", (r) => r.snap?.day?.above20);
add("above50", "Above 50-day EMA", "Trend & MMA", "bool", (r) => r.snap?.day?.above50);
add("above200", "Above 200-day EMA", "Trend & MMA", "bool", (r) => r.snap?.day?.above200);
add("goldenCross", "50/200 EMA cross (3 days)", "Trend & MMA", "cat", (r) => r.snap?.day?.goldenCross, { values: ["bull", "bear"] });
add("priceCross50", "Price crossed 50-day EMA (3 days)", "Trend & MMA", "cat", (r) => r.snap?.day?.priceCross50, { values: ["bull", "bear"] });
add("agreement", "Indicator agreement", "Momentum", "cat", (r) => r.snap?.agreement, { values: ["strong_bull", "bull", "conflict", "bear", "strong_bear"] });
add("stage", "Early-stage classification", "Patterns", "cat", (r) => r.snap?.stage?.label);
add("stageId", "Stage number (0-7)", "Patterns", "num", (r) => r.snap?.stage?.id);
add("tfShift", "MMA timeframe shift", "Trend & MMA", "text", (r) => r.snap?.tfShift);

// relative strength
const BENCH = { country: "country", countrySector: "sector (in country)", region: "region", global: "global" };
for (const [bk, bl] of Object.entries(BENCH)) {
  for (const tf of ["D", "W"]) {
    const T = tf === "D" ? "daily" : "weekly";
    add(`rscRising_${bk}_${tf}`, `RSC vs ${bl} rising (${T})`, "Relative strength", "bool", (r) => r.snap?.rsc?.[bk]?.[tf]?.rising);
    add(`rscTurnUp_${bk}_${tf}`, `RSC vs ${bl} upward inflection (${T})`, "Relative strength", "bool", (r) => r.snap?.rsc?.[bk]?.[tf]?.turnUp);
    add(`rscHigh_${bk}_${tf}`, `RSC vs ${bl} at 52-bar high (${T})`, "Relative strength", "bool", (r) => r.snap?.rsc?.[bk]?.[tf]?.atHigh);
    add(`rscLow_${bk}_${tf}`, `RSC vs ${bl} at 52-bar low (${T})`, "Relative strength", "bool", (r) => r.snap?.rsc?.[bk]?.[tf]?.atLow);
  }
  for (const h of ["1M", "3M", "6M", "12M"]) add(`rscChg_${bk}_${h}`, `RSC vs ${bl} change ${h} %`, "Relative strength", "pct", (r) => r.snap?.rsc?.[bk]?.D?.chg?.[h]);
}
add("rscDivergence", "Price-RSC divergence (weekly, vs country)", "Relative strength", "cat", (r) => r.snap?.rsc?.country?.W?.divergence, { values: ["bullish", "bearish"] });
add("rsRank", "RS rank vs country (percentile)", "Relative strength", "num", (r) => r.rsRank);

// volume & liquidity
add("volRatio", "Volume / 50-day average", "Volume & liquidity", "num", (r) => r.snap?.day?.volRatio);
add("unusualVolume", "Unusual volume (>= 2x)", "Volume & liquidity", "bool", (r) => r.snap?.day?.unusualVolume);
add("breakoutVolume", "Volume-supported breakout", "Volume & liquidity", "bool", (r) => r.snap?.day?.breakoutVolume);
add("accumulation", "Accumulation (up/down volume)", "Volume & liquidity", "bool", (r) => r.snap?.day?.accumulation);
add("distribution", "Distribution (up/down volume)", "Volume & liquidity", "bool", (r) => r.snap?.day?.distribution);
add("pvDivergence", "Price-volume divergence", "Volume & liquidity", "cat", (r) => r.snap?.day?.pvDivergence, { values: ["rally_on_falling_volume", "decline_on_falling_volume"] });
add("tradedValueUsd", "Avg traded value 20d (USD)", "Volume & liquidity", "money", (r) => r.snap?.day?.tradedValue20Usd);

// fundamentals
add("revenueGrowthYoY", "Revenue growth YoY %", "Fundamentals", "pct", (r) => r.f?.revenueGrowthYoY);
add("revenueGrowthAccel", "Revenue growth acceleration (pts)", "Fundamentals", "num", (r) => r.f?.revenueGrowthAccel);
add("epsGrowthYoY", "EPS growth YoY %", "Fundamentals", "pct", (r) => r.f?.epsGrowthYoY);
add("grossMargin", "Gross margin %", "Fundamentals", "pct", (r) => r.f?.grossMargin);
add("operatingMargin", "Operating margin %", "Fundamentals", "pct", (r) => r.f?.operatingMargin);
add("operatingMarginChange", "Operating margin change (pts, YoY)", "Fundamentals", "num", (r) => r.f?.operatingMarginChange);
add("netMargin", "Net margin %", "Fundamentals", "pct", (r) => r.f?.netMargin);
add("roe", "ROE %", "Fundamentals", "pct", (r) => r.f?.roe);
add("debtToEquity", "Debt / equity", "Fundamentals", "num", (r) => r.f?.debtToEquity);
add("fcfMargin", "FCF margin %", "Fundamentals", "pct", (r) => r.f?.fcfMargin);
add("pe", "P/E (TTM)", "Fundamentals", "num", (r) => r.f?.pe);
add("fundImproving", "Fundamentals improving", "Fundamentals", "bool", (r) => r.f?.improving);

// weight watcher
add("wwTrend", "WW trend (weight in its sector)", "Weight Watcher", "cat", (r) => r.ww?.trend, { values: ["rising", "falling", "sideways", "turn_up_from_low", "turn_down_from_high"] });
add("wwWeight", "WW weight in sector %", "Weight Watcher", "num", (r) => r.ww?.last);
add("wwChange4", "WW weight change over 4 quarters %", "Weight Watcher", "pct", (r) => (r.ww?.change4 != null ? Math.round(r.ww.change4 * 10000) / 100 : null));

// scores
add("score", "AI setup score", "Scores", "num", (r) => r.score?.total);
for (const k of ["technical", "relative", "participation", "fundamentals", "timeframe"]) add(`score_${k}`, `Score: ${k}`, "Scores", "num", (r) => r.score?.components?.[k]?.score);

// GLOCOM / LOCOM (engine/glocom.js; a stock's GLOCOM is the heatmap's own where it has one)
// codes: 1 dark green (US/LTS 80), 2 light green (US/LTS 60), 3 neutral, 4 light red (UW/LTW 40), 5 dark red (UW/LTW 30)
add("glocom", "GLOCOM label", "GLOCOM", "cat", (r) => r.glocom?.label);
add("glocomCode", "GLOCOM code", "GLOCOM", "num", (r) => r.glocom?.code);
add("locom", "GLOCOM within industry (vs industry peers)", "GLOCOM", "cat", (r) => r.glocom?.locom?.label);
add("locomCode", "GLOCOM within industry, code", "GLOCOM", "num", (r) => r.glocom?.locom?.code);
add("industryGlocom", "Industry GLOCOM label", "GLOCOM", "cat", (r) => r.glocom?.industry?.label);
add("industryGlocomCode", "Industry GLOCOM code", "GLOCOM", "num", (r) => r.glocom?.industry?.code);
add("industryGlocomRank", "Industry GLOCOM rank (1 = best)", "GLOCOM", "num", (r) => r.glocom?.industry?.rank);
add("industryRankJump1D", "Industry rank change, 1 session (+ = up)", "GLOCOM", "num", (r) => r.glocom?.industry?.jump1D);
add("industryRankJump1W", "Industry rank change, 1 week (+ = up)", "GLOCOM", "num", (r) => r.glocom?.industry?.jump1W);
add("sectorGlocom", "Sector GLOCOM label", "GLOCOM", "cat", (r) => r.glocom?.sector?.label);
add("sectorGlocomCode", "Sector GLOCOM code", "GLOCOM", "num", (r) => r.glocom?.sector?.code);

// IMB / ETI characteristics (ETI project; yes / no / unknown, never scored)
for (const c of ETI_CHARACTERISTICS) add(`eti_${c.key}`, `${c.framework.toUpperCase()}: ${c.label}`, "IMB / ETI", "cat", (r) => (r.eti ? r.eti[c.key] || "unknown" : null));

export const FIELDS = F;
export const FIELD = Object.fromEntries(F.map((f) => [f.key, f]));
export const fieldValue = (key, row) => { const f = FIELD[key]; return f ? f.get(row) : g(row, key); };

export const OPS = {
  num: [">", ">=", "<", "<=", "between", "is set"],
  pct: [">", ">=", "<", "<=", "between", "is set"],
  money: [">", ">=", "<", "<=", "between", "is set"],
  bool: ["is true", "is false"],
  cat: ["is", "is not", "in", "is set"],
  text: ["contains", "is set"],
};

/** Evaluate one condition {field, op, value, value2}. Missing data never passes. */
/** Value of a drawn straight line on a date: linear in calendar days through a and b (extended). */
export function lineValueAt(a, b, date) {
  const d = (x) => Date.parse(`${x}T00:00:00Z`) / 86400000;
  const ta = d(a.time), tb = d(b.time), t = d(date);
  if (!Number.isFinite(ta) || !Number.isFinite(tb) || ta === tb || !Number.isFinite(t)) return null;
  return a.price + ((b.price - a.price) * (t - ta)) / (tb - ta);
}

/**
 * One condition. Besides field conditions ({field, op, value}) a rule can hold
 *   {kind: "level", price, side: "above"|"below"}            close vs a fixed price (a horizontal
 *                                                             line or a Fibonacci level)
 *   {kind: "line", a: {time, price}, b: {time, price}, side}  close vs a drawn trend line / channel
 *                                                             edge, extended to the latest date
 * Alerts fire on the change (the server records each match once), so "above" fires on the cross.
 * Only rules for one instrument (rule.universe.ids) should carry level / line conditions.
 */
export function testCondition(row, c, ctx = {}) {
  if (c.kind === "level" || c.kind === "line") {
    const close = row.flat ? row.flat.close : row.snap?.close;
    if (close == null) return false;
    const lvl = c.kind === "level" ? +c.price : lineValueAt(c.a, c.b, row.flat?.asOf || row.snap?.asOf || ctx.asOf);
    if (lvl == null || !Number.isFinite(lvl)) return false;
    return c.side === "below" ? close < lvl : close > lvl;
  }
  const f = FIELD[c.field];
  if (!f) return false;
  const v = f.get(row);
  switch (c.op) {
    case "is set": return v != null && v !== false && v !== "";
    case "is true": return v === true;
    case "is false": return v === false;
    case ">": return v != null && v > +c.value;
    case ">=": return v != null && v >= +c.value;
    case "<": return v != null && v < +c.value;
    case "<=": return v != null && v <= +c.value;
    case "between": return v != null && v >= +c.value && v <= +c.value2;
    case "is": return v != null && String(v) === String(c.value);
    case "is not": return v != null && String(v) !== String(c.value);
    case "in": return v != null && String(c.value).split(",").map((s) => s.trim()).includes(String(v));
    case "contains": return v != null && String(v).toLowerCase().includes(String(c.value).toLowerCase());
    default: return false;
  }
}

/** Screen: {conditions:[...], match:"all"|"any", scope:{country,region,sector,cap,...}} */
export function runScreen(rows, screen) {
  const conds = screen.conditions || [];
  const sc = screen.scope || {};
  return rows.filter((r) => {
    for (const [k, v] of Object.entries(sc)) if (v && fieldValue(k, r) !== v) return false;
    if (!conds.length) return true;
    return screen.match === "any" ? conds.some((c) => testCondition(r, c)) : conds.every((c) => testCondition(r, c));
  });
}
