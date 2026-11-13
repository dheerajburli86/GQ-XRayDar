// Index-level analytics built on stored index series: sector rotation,
// market regime and EW-vs-CW participation (EWCW).
//
// Rotation uses a transparent GQ formula (the JdK RRG formula is proprietary):
//   RSC       = sector index / scope index, weekly closes
//   RS-Ratio  = 100 * RSC / SMA(RSC, smaWeeks)          -> above 100 = outperforming its own trend
//   RS-Mom    = 100 * RS-Ratio_t / RS-Ratio_{t-k weeks} -> above 100 = relative strength improving
//   Leading (>=100, >=100) | Weakening (>=100, <100) | Lagging (<100, <100) | Improving (<100, >=100)

import { METHODOLOGY } from "./methodology.js";
import { aggregateCloses, sma, efficiencyRatio, realisedVol } from "./indicators.js";

export const QUADRANTS = ["Leading", "Weakening", "Lagging", "Improving"];
export const quadrantOf = (ratio, mom) => (ratio >= 100 ? (mom >= 100 ? "Leading" : "Weakening") : (mom >= 100 ? "Improving" : "Lagging"));

/** series: {dates, level} -> weekly {time, close, key} */
const weekly = (s) => aggregateCloses(s.dates, s.level, "W");

export function rotation(sectorSeries, scopeSeries, m = METHODOLOGY.rotation) {
  const B = weekly(scopeSeries);
  const bmap = new Map(B.key.map((k, i) => [k, B.close[i]]));
  const out = [];
  for (const s of sectorSeries) {
    const A = weekly(s.series);
    const time = [], rscV = [];
    for (let i = 0; i < A.key.length; i++) {
      const b = bmap.get(A.key[i]);
      if (b > 0 && A.close[i] > 0) { time.push(A.time[i]); rscV.push(A.close[i] / b); }
    }
    const avg = sma(rscV, m.smaWeeks);
    const ratio = rscV.map((v, i) => (avg[i] ? (100 * v) / avg[i] : null));
    const mom = ratio.map((v, i) => (v != null && i >= m.momentumWeeks && ratio[i - m.momentumWeeks] ? (100 * v) / ratio[i - m.momentumWeeks] : null));
    const tail = [];
    for (let i = Math.max(0, time.length - m.tailWeeks); i < time.length; i++) {
      if (ratio[i] == null || mom[i] == null) continue;
      tail.push({ date: time[i], ratio: round(ratio[i]), mom: round(mom[i]), quadrant: quadrantOf(ratio[i], mom[i]) });
    }
    if (!tail.length) continue;
    const last = tail[tail.length - 1];
    const transitions = [];
    for (let i = 1; i < tail.length; i++) if (tail[i].quadrant !== tail[i - 1].quadrant) transitions.push({ date: tail[i].date, from: tail[i - 1].quadrant, to: tail[i].quadrant });
    out.push({ key: s.key, name: s.name, quadrant: last.quadrant, ratio: last.ratio, mom: last.mom, tail, transitions });
  }
  return out;
}

/**
 * Regime of an index on its latest date, with the metrics that decide it:
 *   High volatility  realised 20-day vol in the top `volPctHigh` percentile of its own history
 *   Trending up/down efficiency ratio over erWeeks weekly closes >= trendER
 *   Consolidating    otherwise
 */
export function regime(series, m = METHODOLOGY.regime) {
  const lv = series.level, n = lv.length;
  if (n < 260) return null;
  const vols = [];
  for (let i = Math.max(21, n - m.volLookbackDays); i < n; i += 5) vols.push(realisedVol(lv, 20, i));
  const volNow = realisedVol(lv, 20, n - 1);
  const pctile = vols.length ? (vols.filter((v) => v <= volNow).length / vols.length) * 100 : null;
  const W = weekly(series);
  const er = efficiencyRatio(W.close, m.erWeeks);
  const dir = W.close.length > m.erWeeks ? Math.sign(W.close[W.close.length - 1] - W.close[W.close.length - 1 - m.erWeeks]) : 0;
  let label;
  if (pctile != null && pctile >= m.volPctHigh) label = "High volatility";
  else if (er != null && er >= m.trendER) label = dir > 0 ? "Trending up" : "Trending down";
  else label = "Consolidating";
  // weekly regime history (last 104 weeks) for the chart strip
  const hist = [];
  for (let k = Math.max(m.erWeeks, W.close.length - 104); k < W.close.length; k++) {
    const e = efficiencyRatio(W.close, m.erWeeks, k);
    const d = Math.sign(W.close[k] - W.close[k - m.erWeeks]);
    hist.push({ date: W.time[k], er: round(e, 3), label: e >= m.trendER ? (d > 0 ? "Trending up" : "Trending down") : "Consolidating" });
  }
  return { label, asOf: series.dates[n - 1], volNow: round(volNow), volPctile: round(pctile), er: round(er, 3), direction: dir, history: hist };
}

/** EW/CW participation for a matched pair (same scope, currency). */
export function ewcw(ewSeries, cwSeries) {
  const cmap = new Map(cwSeries.dates.map((d, i) => [d, cwSeries.level[i]]));
  const dates = [], ratio = [];
  for (let i = 0; i < ewSeries.dates.length; i++) {
    const c = cmap.get(ewSeries.dates[i]);
    if (c > 0) { dates.push(ewSeries.dates[i]); ratio.push((ewSeries.level[i] / c) * 100); }
  }
  const n = ratio.length;
  if (n < 30) return { dates, ratio, summary: null };
  const back = (k) => (n - 1 - k >= 0 ? round((ratio[n - 1] / ratio[n - 1 - k] - 1) * 100) : null);
  const avg = sma(ratio, 126);
  const chg = { "1M": back(21), "3M": back(63), "6M": back(126), "12M": back(252) };
  const above = avg[n - 1] ? ratio[n - 1] > avg[n - 1] : null;
  const label = chg["3M"] == null ? "Insufficient history"
    : chg["3M"] > 1 && above ? "Broadening participation (EW leading)"
      : chg["3M"] < -1 && !above ? "Narrowing - large-cap led (CW leading)" : "Balanced";
  return { dates, ratio, summary: { asOf: dates[n - 1], ratio: round(ratio[n - 1]), chg, aboveTrend: above, label } };
}

const round = (v, d = 2) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
