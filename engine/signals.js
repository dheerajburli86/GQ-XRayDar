// Per-security technical analysis: the latest-state SNAPSHOT that screens,
// heatmaps, scores and alerts read, plus the historical EVENTS that the
// inflection database and the backtester read.
//
// Bias control: every state at bar i uses data up to and including bar i only.
// An event detected at the close of bar i is ENTERED at the close of the next
// daily session, so a forward return never includes the bar that produced the
// signal.

import { METHODOLOGY } from "./methodology.js";
import {
  aggregate, ema, emaStrict, rsi, macd, atr, rollingMax, rollingMin, mmaState, rsc, slopeSign, sma, isFiniteNum,
} from "./indicators.js";
import { HORIZONS, lowerBound } from "./calendar.js";

const num = isFiniteNum;
const r4 = (v) => (num(v) ? Math.round(v * 1e4) / 1e4 : null);
const r2 = (v) => (num(v) ? Math.round(v * 100) / 100 : null);
const pct = (a, b) => (num(a) && num(b) && b !== 0 ? (a / b - 1) * 100 : null);

const N52 = { D: 252, W: 52, M: 12 };
const TREND_EMA = { D: 50, W: 10, M: 6 };

/** Bars-per-timeframe analysis. Returns the per-bar arrays the snapshot and events need. */
export function analyzeTimeframe(daily, tf, m = METHODOLOGY) {
  const b = aggregate(daily, tf);
  const c = b.close, n = c.length;
  const ind = m.indicators;
  const r1 = rsi(c, ind.rsiPeriod, ind.rsiMethod);
  const r2_ = rsi(r1, ind.nestedRsiPeriod, ind.rsiMethod);
  const r3 = rsi(r2_, ind.nestedRsiPeriod, ind.rsiMethod);
  const shortL = ind.mmaShort.map((p) => emaStrict(c, p));
  const longL = ind.mmaLong.map((p) => emaStrict(c, p));
  const states = new Array(n);
  for (let i = 0; i < n; i++) states[i] = mmaState(shortL, longL, i);
  const md = macd(c);
  const at = atr(b.high, b.low, c, 14);
  const cb = m.signals.consolidationBars;
  const hh = rollingMax(b.high, cb), ll = rollingMin(b.low, cb);
  const consol = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    if (!num(hh[i]) || !num(at[i]) || i < cb) continue;
    consol[i] = (hh[i] - ll[i]) <= m.signals.consolidationAtrMult * at[i];
  }
  const breakout = new Array(n).fill(false), breakdown = new Array(n).fill(false);
  for (let i = 1; i < n; i++) {
    const recentConsol = consol.slice(Math.max(0, i - 5), i).some(Boolean);
    if (recentConsol && num(hh[i - 1]) && c[i] > hh[i - 1]) breakout[i] = true;
    if (recentConsol && num(ll[i - 1]) && c[i] < ll[i - 1]) breakdown[i] = true;
  }
  const vol = b.volume || new Array(n).fill(0);
  const vAvg50 = sma(vol, 50);
  const volRatio = vol.map((v, i) => (i > 0 && num(vAvg50[i - 1]) && vAvg50[i - 1] > 0 ? v / vAvg50[i - 1] : null));
  const trendE = ema(c, TREND_EMA[tf] || 50);
  const N = N52[tf] || 52;
  const hiN = rollingMax(c, N), loN = rollingMin(c, N);
  return { tf, b, c, n, r1, r2: r2_, r3, shortL, longL, states, md, at, hh, ll, consol, breakout, breakdown, vol, volRatio, trendE, hiN, loN };
}

function compressionAt(A, i, m) {
  const st = A.states[i];
  return !!(st && num(st.shortSpread) && st.shortSpread < (m.indicators.mmaCompressionPct[A.tf] ?? 2));
}

function bullRun(A, i) {
  let k = 0;
  while (i - k >= 0 && A.states[i - k] && A.states[i - k].bull) k++;
  return k;
}

/** RSC analysis of a series against a benchmark on one timeframe. */
export function analyzeRsc(times, closes, bench, tf, m = METHODOLOGY) {
  if (!bench || !bench.time || !bench.time.length) return null;
  const s = rsc(times, closes, bench.time, bench.close, tf, m.indicators.rscRebase);
  const n = s.value.length;
  if (n < 12) return null;
  const v = s.value, e = ema(v, m.indicators.rscEma);
  const i = n - 1;
  const N = N52[tf] || 52;
  const hi = rollingMax(v, N), lo = rollingMin(v, N);
  const slopes = e.map((_, k) => slopeSign(e, k, 1));
  const prevNeg = slopes.slice(Math.max(0, i - 8), i).filter((x) => x < 0).length;
  const prevPos = slopes.slice(Math.max(0, i - 8), i).filter((x) => x > 0).length;
  const rising = slopeSign(e, i, 3) > 0;
  const back = (k) => (i - k >= 0 ? pct(v[i], v[i - k]) : null);
  const per = tf === "D" ? HORIZONS : tf === "W" ? { "1M": 4, "3M": 13, "6M": 26, "12M": 52 } : { "3M": 3, "6M": 6, "12M": 12 };
  return {
    time: s.time, value: v, ema: e,
    last: r4(v[i]),
    rising, falling: slopeSign(e, i, 3) < 0,
    atHigh: num(hi[i]) && v[i] >= hi[i], atLow: num(lo[i]) && v[i] <= lo[i],
    turnUp: slopes[i] > 0 && prevNeg >= 6,
    turnDown: slopes[i] < 0 && prevPos >= 6,
    chg: Object.fromEntries(Object.entries(per).map(([k, b]) => [k, r2(back(b))])),
  };
}

/**
 * Full analysis of one security.
 *   daily: own trading bars {time[],open[],high[],low[],close[],volume[]} in trading currency
 *   usdClose / ccClose: close converted to USD / to the country currency, aligned to daily.time
 *   bench: { country, countrySector } in country currency; { region, global } in USD
 *          each {time:[], close:[]}
 *   ctx: { divisor } price unit divisor (100 for minor-unit quotes) for traded value
 */
export function analyzeSecurity(daily, usdClose, ccClose, bench, ctx = {}, m = METHODOLOGY) {
  const n = daily.time.length;
  if (n < 30) return null;
  const tfs = { D: analyzeTimeframe(daily, "D", m), W: analyzeTimeframe(daily, "W", m), M: analyzeTimeframe(daily, "M", m) };
  const D = tfs.D, i = n - 1, c = daily.close;

  // --- returns (local and USD) ---
  const ret = {}, retUsd = {};
  for (const [k, h] of Object.entries(HORIZONS)) {
    ret[k] = i - h >= 0 ? r2(pct(c[i], c[i - h])) : null;
    retUsd[k] = i - h >= 0 ? r2(pct(usdClose[i], usdClose[i - h])) : null;
  }
  ret.YTD = r2(pct(c[i], c[lastIndexBeforeYear(daily.time, daily.time[i].slice(0, 4))] ?? null));

  // --- per-timeframe states ---
  const tfState = {};
  for (const [tf, A] of Object.entries(tfs)) {
    const k = A.n - 1;
    if (k < 1) continue;
    const st = A.states[k], stPrev = A.states[k - 1];
    const comp = compressionAt(A, k, m);
    const wasComp = Array.from({ length: Math.min(10, k) }, (_, j) => compressionAt(A, k - 1 - j, m)).some(Boolean);
    const spreadBack = A.states[Math.max(0, k - 5)]?.shortSpread;
    const expansion = !!(st && num(st.shortSpread) && num(spreadBack) && st.shortSpread > spreadBack * 1.5 && (st.shortAboveLong || st.shortBelowLong));
    const allEmaMax = st ? Math.max(...A.shortL.map((l) => l[k]), ...A.longL.map((l) => l[k])) : null;
    const postConsBreak = !!(wasComp && !comp && st && st.shortAboveLong && A.c[k] > allEmaMax);
    const macdCross = A.md.line[k] > A.md.signal[k] && A.md.line[k - 1] <= A.md.signal[k - 1] ? "bull"
      : A.md.line[k] < A.md.signal[k] && A.md.line[k - 1] >= A.md.signal[k - 1] ? "bear" : null;
    const trendSlope = slopeSign(A.trendE, k, 5);
    const slopes20 = Array.from({ length: Math.min(20, k - 5) }, (_, j) => slopeSign(A.trendE, k - 1 - j, 5));
    const reversalUp = trendSlope > 0 && slopes20.filter((x) => x < 0).length >= 15 && A.c[k] > A.trendE[k];
    const reversalDown = trendSlope < 0 && slopes20.filter((x) => x > 0).length >= 15 && A.c[k] < A.trendE[k];
    tfState[tf] = {
      t: A.b.time[k],
      close: r4(A.c[k]),
      rsi: r2(A.r1[k]), rsi2: r2(A.r2[k]), rsi3: r2(A.r3[k]),
      rsiPrev: r2(A.r1[k - 1]),
      mma: st ? (st.bull ? "bull" : st.bear ? "bear" : st.shortAboveLong ? "above" : st.shortBelowLong ? "below" : "mixed") : null,
      mmaNew: st && stPrev && st.bull && !stPrev.bull ? "bull" : st && stPrev && st.bear && !stPrev.bear ? "bear" : null,
      bullBars: bullRun(A, k),
      shortSpread: r2(st?.shortSpread), longSpread: r2(st?.longSpread), gap: r2(st?.gapPct),
      compression: comp, expansion, postConsBreak,
      macd: A.md.line[k] > A.md.signal[k] ? "bull" : "bear", macdCross,
      consolidation: A.consol[k], breakout: A.breakout[k], breakdown: A.breakdown[k],
      breakoutRecent: A.breakout.slice(Math.max(0, k - 4), k + 1).some(Boolean),
      reversalUp, reversalDown,
      trendUp: A.c[k] > A.trendE[k] && trendSlope > 0, trendDown: A.c[k] < A.trendE[k] && trendSlope < 0,
      atHighN: num(A.hiN[k]) && A.c[k] >= A.hiN[k], atLowN: num(A.loN[k]) && A.c[k] <= A.loN[k],
      volRatio: r2(A.volRatio[k]),
    };
  }

  // --- daily-only measures ---
  const e20 = ema(c, 20), e50 = ema(c, 50), e200 = ema(c, 200);
  const hi52 = rollingMax(c, 252), lo52 = rollingMin(c, 252);
  let ath = -Infinity, atl = Infinity;
  for (let k = 0; k < i; k++) { if (c[k] > ath) ath = c[k]; if (c[k] < atl) atl = c[k]; }
  const cross = (a, b) => {
    for (let k = i; k > Math.max(0, i - 3); k--) {
      if (a[k] > b[k] && a[k - 1] <= b[k - 1]) return "bull";
      if (a[k] < b[k] && a[k - 1] >= b[k - 1]) return "bear";
    }
    return null;
  };
  const v = daily.volume || [];
  let upV = 0, dnV = 0;
  for (let k = Math.max(1, i - 49); k <= i; k++) { if (c[k] > c[k - 1]) upV += v[k] || 0; else if (c[k] < c[k - 1]) dnV += v[k] || 0; }
  const udRatio = dnV > 0 ? upV / dnV : null;
  const avgV = (a, b) => { let s = 0, q = 0; for (let k = Math.max(0, i - b + 1); k <= i - a; k++) { s += v[k] || 0; q++; } return q ? s / q : null; };
  const v20 = avgV(0, 20), v50 = avgV(0, 50);
  const chg20 = i >= 20 ? pct(c[i], c[i - 20]) : null;
  const pvDiv = num(chg20) && num(v20) && num(v50) && v50 > 0
    ? (chg20 > 5 && v20 < 0.8 * v50 ? "rally_on_falling_volume" : chg20 < -5 && v20 < 0.8 * v50 ? "decline_on_falling_volume" : null) : null;
  const div = ctx.divisor || 1;
  let tv = 0, tvUsd = 0, tq = 0;
  for (let k = Math.max(0, i - 19); k <= i; k++) {
    const val = (c[k] / div) * (v[k] || 0);
    tv += val; tvUsd += c[k] > 0 ? val * (usdClose[k] / c[k]) * div : 0; tq++;
  }
  const dayState = {
    above20: c[i] > e20[i], above50: c[i] > e50[i], above200: i >= 199 && c[i] > e200[i],
    ema20: r4(e20[i]), ema50: r4(e50[i]), ema200: i >= 199 ? r4(e200[i]) : null,
    priceCross50: cross(c, e50), priceCross200: i >= 200 ? cross(c, e200) : null,
    goldenCross: i >= 200 ? cross(e50, e200) : null,
    high52: r4(hi52[i]), low52: r4(lo52[i]),
    pctFromHigh52: r2(pct(c[i], hi52[i])), pctFromLow52: r2(pct(c[i], lo52[i])),
    atHigh52: i >= 251 && c[i] >= hi52[i], atLow52: i >= 251 && c[i] <= lo52[i],
    nearHigh52: num(hi52[i]) && c[i] >= hi52[i] * 0.95,
    newHigh20: i >= 20 && c[i] > Math.max(...c.slice(i - 20, i)), newLow20: i >= 20 && c[i] < Math.min(...c.slice(i - 20, i)),
    newHigh63: i >= 63 && c[i] > Math.max(...c.slice(i - 63, i)), newLow63: i >= 63 && c[i] < Math.min(...c.slice(i - 63, i)),
    ath: num(ath) && ath > -Infinity ? r4(Math.max(ath, c[i])) : null, atl: atl < Infinity ? r4(Math.min(atl, c[i])) : null,
    athBreak: ath > -Infinity && c[i] > ath, atlBreak: atl < Infinity && c[i] < atl,
    pctFromAth: ath > -Infinity ? r2(pct(c[i], Math.max(ath, c[i]))) : null,
    volRatio: tfs.D.volRatio[i] != null ? r2(tfs.D.volRatio[i]) : null,
    unusualVolume: (tfs.D.volRatio[i] || 0) >= m.signals.unusualVolume,
    breakoutVolume: tfs.D.breakout[i] && (tfs.D.volRatio[i] || 0) >= m.signals.breakoutVolume,
    udRatio: r2(udRatio),
    accumulation: udRatio != null && udRatio >= m.signals.accumulationRatio,
    distribution: udRatio != null && udRatio <= m.signals.distributionRatio,
    pvDivergence: pvDiv,
    tradedValue20: tq ? Math.round(tv / tq) : null, tradedValue20Usd: tq ? Math.round(tvUsd / tq) : null,
  };

  // --- RSC against every benchmark, daily + weekly + monthly ---
  const rscOut = {};
  for (const [bk, bser] of Object.entries(bench || {})) {
    if (!bser) continue;
    const own = bk === "region" || bk === "global" ? usdClose : ccClose;
    const per = {};
    for (const tf of ["D", "W", "M"]) {
      const a = analyzeRsc(daily.time, own, bser, tf, m);
      if (!a) continue;
      per[tf] = { last: a.last, rising: a.rising, falling: a.falling, atHigh: a.atHigh, atLow: a.atLow, turnUp: a.turnUp, turnDown: a.turnDown, chg: a.chg };
      if (tf === "W") {
        // price vs RSC divergence on the weekly
        const W = tfs.W, k = W.n - 1;
        const vv = a.value, j = vv.length - 1;
        const rHi = Math.max(...vv.slice(Math.max(0, j - 51), j + 1)), rLo = Math.min(...vv.slice(Math.max(0, j - 51), j + 1));
        per.W.divergence = W.c[k] >= W.hiN[k] && vv[j] < rHi * 0.97 ? "bearish" : W.c[k] <= W.loN[k] && vv[j] > rLo * 1.03 ? "bullish" : null;
      }
    }
    rscOut[bk] = per;
  }

  // --- multi-indicator agreement (daily) ---
  const DS = tfState.D || {};
  const bullList = [], bearList = [];
  const vote = (cond, name, bear) => { if (cond === true) bullList.push(name); else if (bear === true) bearList.push(name); };
  vote(dayState.above50, "Price above 50-day EMA", !dayState.above50);
  vote(c[i] > e200[i] && i >= 199, "Price above 200-day EMA", i >= 199 && c[i] < e200[i]);
  vote(e50[i] > e200[i] && i >= 199, "50-day EMA above 200-day", i >= 199 && e50[i] < e200[i]);
  vote(DS.macd === "bull", "MACD above signal", DS.macd === "bear");
  vote(DS.rsi > 50, "RSI above 50", DS.rsi < 50);
  vote(DS.mma === "bull" || DS.mma === "above", "Short MMA above long MMA", DS.mma === "bear" || DS.mma === "below");
  const rc = rscOut.country?.D;
  if (rc) vote(rc.rising, "RSC vs country rising", rc.falling);
  const agreement = bullList.length >= 6 ? "strong_bull" : bearList.length >= 6 ? "strong_bear"
    : bullList.length >= 2 && bearList.length >= 2 ? "conflict" : bullList.length > bearList.length ? "bull" : "bear";

  // --- early-stage classification (weekly) ---
  const stage = classifyStage(tfs, tfState, rscOut, m);

  // --- timeframe shift ---
  const mm = (s) => (s === "bull" || s === "above" ? "bull" : s === "bear" || s === "below" ? "bear" : "mixed");
  const tfm = { D: mm(tfState.D?.mma), W: mm(tfState.W?.mma), M: mm(tfState.M?.mma) };
  let tfShift = null;
  if (tfm.D === "bull" && tfm.W !== "bull") tfShift = "Daily bullish ahead of weekly";
  else if (tfm.D === "bear" && tfm.W === "bull") tfShift = "Daily turned bearish inside a weekly uptrend";
  else if (tfm.W === "bull" && tfm.M !== "bull") tfShift = "Weekly bullish ahead of monthly";
  else if (tfm.W === "bear" && tfm.M === "bull") tfShift = "Weekly turned bearish inside a monthly uptrend";

  const snapshot = {
    asOf: daily.time[i], bars: n, close: r4(c[i]), closeUsd: r4(usdClose[i]),
    ret, retUsd, tf: tfState, day: dayState, rsc: rscOut,
    agreement, bullSignals: bullList, bearSignals: bearList,
    stage, mmaTf: tfm, tfShift,
  };
  return { snapshot, tfs, dayEma: { e20, e50, e200, hi52, lo52 } };
}

function lastIndexBeforeYear(times, year) {
  const k = lowerBound(times, `${year}-01-01`) - 1;
  return k >= 0 ? k : null;
}

export const STAGES = [
  { id: 0, key: "downtrend", label: "Downtrend" },
  { id: 1, key: "slowing", label: "Slowing decline" },
  { id: 2, key: "consolidation", label: "Consolidation" },
  { id: 3, key: "compression", label: "MMA compression" },
  { id: 4, key: "rsc_turn", label: "RSC turn" },
  { id: 5, key: "breakout", label: "Breakout" },
  { id: 6, key: "volume_confirmed", label: "Volume-confirmed breakout" },
  { id: 7, key: "uptrend", label: "Established uptrend" },
];

function classifyStage(tfs, st, rscOut, m) {
  const W = tfs.W, k = W.n - 1, ws = st.W || {}, ds = st.D || {};
  const ev = [];
  if (k < 20) return { id: null, key: "insufficient", label: "Not enough history", evidence: [] };
  const roc = (j) => (j - 13 >= 0 ? pct(W.c[j], W.c[j - 13]) : null);
  const downtrend = ws.mma === "bear" || (W.c[k] < W.trendE[k] && slopeSign(W.trendE, k, 4) < 0);
  const slowing = downtrend && num(roc(k)) && num(roc(k - 4)) && roc(k) > roc(k - 4) && W.r1[k] > W.r1[k - 4];
  const consolidation = !!ws.consolidation;
  const compression = !!ws.compression;
  const rw = rscOut.country?.W;
  const rscTurn = !!(rw && (rw.turnUp || (rw.rising && rscOut.country?.M?.falling)));
  const breakout = !!(ws.breakoutRecent || ds.breakoutRecent || ws.postConsBreak);
  const volConfirm = breakout && ((tfs.D.volRatio.slice(-5).some((x) => (x || 0) >= m.signals.breakoutVolume)) || (ws.volRatio || 0) >= m.signals.breakoutVolume);
  const established = (ws.bullBars || 0) >= 8;
  let id;
  if (established) { id = 7; ev.push(`Weekly MMA bullish for ${ws.bullBars} weeks`); }
  else if (volConfirm) { id = 6; ev.push("Breakout within the last 5 sessions on volume >= 1.5x its 50-bar average"); }
  else if (breakout) { id = 5; ev.push("Close above the prior consolidation range"); }
  else if (rscTurn && (compression || consolidation)) { id = 4; ev.push("Weekly RSC vs country turned up while price is basing"); }
  else if (compression) { id = 3; ev.push(`Weekly short-MMA spread ${ws.shortSpread}%`); }
  else if (consolidation) { id = 2; ev.push("20-week range within 4 ATRs"); }
  else if (slowing) { id = 1; ev.push("13-week rate of change improving with RSI rising"); }
  else if (downtrend) { id = 0; ev.push("Weekly MMA bearish or price below a falling trend EMA"); }
  else if (W.c[k] > W.trendE[k]) return { id: null, key: "uptrend_unaligned", label: "Rising, MMA not yet aligned", evidence: ["Price above its weekly trend EMA without a full bullish MMA fan"], flags: { downtrend, slowing, consolidation, compression, rscTurn, breakout, volConfirm, established } };
  else return { id: null, key: "none", label: "No stage (trend not defined)", evidence: [], flags: { downtrend, slowing, consolidation, compression, rscTurn, breakout, volConfirm, established } };
  const s = STAGES[id];
  return { id, key: s.key, label: s.label, evidence: ev, flags: { downtrend, slowing, consolidation, compression, rscTurn, breakout, volConfirm, established } };
}

/**
 * Historical events for the inflection database / backtester.
 * Returns [{type, tf, date, entryDate, fwd:{1M,3M,6M,12M}, excess:{...}, mfe, mae}]
 * bench: {time, close} in the same currency as daily.close (country index, local)
 */
export function detectEvents(analysis, daily, benchCountry, ccClose, m = METHODOLOGY) {
  const { tfs } = analysis;
  const out = [];
  const D = tfs.D, W = tfs.W, c = daily.close;
  // Each type has a cooldown (in its own bars) so one choppy stretch does not
  // produce a cluster of near-identical events that would dominate a backtest.
  const COOLDOWN = { D: 20, W: 8 };
  const lastAt = new Map();
  const push = (type, tf, date, bar) => {
    const k = lastAt.get(type);
    if (k != null && bar - k < COOLDOWN[tf]) return;
    lastAt.set(type, bar);
    out.push({ type, tf, date });
  };
  // daily events
  const hi = rollingMax(c, 252);
  const e50 = ema(c, 50), e200 = ema(c, 200);
  for (let i = 252; i < D.n; i++) {
    if (c[i] > hi[i - 1]) push("high52_break", "D", daily.time[i], i);
    if (D.breakout[i]) push((D.volRatio[i] || 0) >= m.signals.breakoutVolume ? "breakout_volume" : "breakout_consolidation", "D", daily.time[i], i);
    if (D.r1[i] > 30 && D.r1[i - 1] <= 30) push("rsi_oversold_exit", "D", daily.time[i], i);
    if (e50[i] > e200[i] && e50[i - 1] <= e200[i - 1]) push("golden_cross", "D", daily.time[i], i);
  }
  // weekly events
  for (let k = 60; k < W.n; k++) {
    const st = W.states[k], p = W.states[k - 1];
    if (st && p && st.bull && !p.bull) push("mma_bull_align", "W", W.b.time[k], k);
    if (st && p && st.bear && !p.bear) push("mma_bear_align", "W", W.b.time[k], k);
    if (compressionAt(W, k, m) && !compressionAt(W, k - 1, m)) push("mma_compression", "W", W.b.time[k], k);
  }
  if (benchCountry && benchCountry.time?.length) {
    const r = analyzeRsc(daily.time, ccClose, benchCountry, "W", m);
    if (r) {
      const e = r.ema;
      for (let k = 10; k < e.length; k++) {
        const s0 = slopeSign(e, k, 1);
        const prev = Array.from({ length: 8 }, (_, j) => slopeSign(e, k - 1 - j, 1));
        if (s0 > 0 && prev.filter((x) => x < 0).length >= 7) push("rsc_turn_up", "W", r.time[k], k);
        if (s0 < 0 && prev.filter((x) => x > 0).length >= 7) push("rsc_turn_down", "W", r.time[k], k);
      }
    }
  }
  return withForwardReturns(out, daily, benchCountry, ccClose, m);
}

/** Attach forward performance. Entry = close of the session AFTER the event date. */
export function withForwardReturns(events, daily, bench, ccClose, m = METHODOLOGY) {
  const t = daily.time, c = daily.close, n = t.length;
  const bt = bench?.time || [], bc = bench?.close || [];
  const benchAt = (d) => { const j = lowerBound(bt, d); const k = j < bt.length && bt[j] === d ? j : j - 1; return k >= 0 ? bc[k] : null; };
  const ex = m.events.excursionBars;
  for (const e of events) {
    const di = lowerBound(t, e.date);
    const j = (di < n && t[di] === e.date ? di : di - 1) + 1;
    e.fwd = {}; e.excess = {};
    if (j <= 0 || j >= n) { e.entryDate = null; continue; }
    e.entryDate = t[j];
    for (const [h, bars] of Object.entries(m.events.horizons)) {
      if (j + bars >= n) { e.fwd[h] = null; e.excess[h] = null; continue; }
      const r = (c[j + bars] / c[j] - 1) * 100;
      e.fwd[h] = r2(r);
      const b0 = benchAt(t[j]), b1 = benchAt(t[j + bars]);
      // stock in country currency vs the country index, same dates
      const rcc = ccClose ? (ccClose[j + bars] / ccClose[j] - 1) * 100 : r;
      e.excess[h] = num(b0) && num(b1) && b0 > 0 ? r2(rcc - (b1 / b0 - 1) * 100) : null;
    }
    if (j + 1 < n) {
      let mx = -Infinity, mn = Infinity;
      for (let k = j + 1; k <= Math.min(n - 1, j + ex); k++) { const hh = daily.high[k], lw = daily.low[k]; if (hh > mx) mx = hh; if (lw < mn) mn = lw; }
      e.mfe = r2((mx / c[j] - 1) * 100); e.mae = r2((mn / c[j] - 1) * 100);
      e.complete = j + ex < n;
    }
  }
  return events;
}

export const EVENT_LABEL = {
  high52_break: "New 52-week high", breakout_consolidation: "Breakout from consolidation", breakout_volume: "Breakout on volume",
  rsi_oversold_exit: "RSI back above 30", golden_cross: "Golden cross (50/200 EMA)", mma_bull_align: "Weekly MMA turns bullish",
  mma_bear_align: "Weekly MMA turns bearish", mma_compression: "Weekly MMA compression", rsc_turn_up: "Weekly RSC turns up",
  rsc_turn_down: "Weekly RSC turns down", ww_turn_up: "WW weight turns up from a low", ww_turn_down: "WW weight turns down from a high",
};
