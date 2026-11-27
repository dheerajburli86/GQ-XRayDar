// GLOCOM / LOCOM category portfolios (owner's spec, 2026-11-27): hold the indices / ETFs of a universe that sit in
// chosen GLOCOM categories, equal weight across categories and then across the indices inside each category,
// re-rated and re-weighted at every weekly or monthly rebalance. Pure maths, no I/O.
//
// Point in time: the rating at a rebalance date uses only prices up to that date (calendar look-backs of 1 week, 6
// months and 1 year, percentile among the universe's own members that have all three), the position is opened at that
// date's close and held to the next rebalance. Nothing later is read. Prices are price returns (no dividends): the
// exchange total-return series are not held, so every figure is a price-return figure.
import { checkpointReturns, rateGlocom, GLOCOM_LABELS } from "./glocom.js";

export const GP_VERSION = "1.0.0";

/** The three portfolios of the spec. The weak list is the confirmed pair; the spec repeats "UW 30 30" and says the
 *  intended category is to be confirmed, so the other two red categories are offered as optional extras. */
export const PORTFOLIOS = {
  strong: { label: "Strong", categories: ["US 80 80", "LTS 80", "US 60 60"], optional: [] },
  weak: { label: "Weak (long only)", categories: ["UW 30 30", "LTW 30", "UW 40 40"], optional: [] },
  neutral: { label: "Neutral", categories: ["Neutral 40 60"], optional: [] },
};

export const MIN_PEERS = 8;
const DAY = 864e5;
const shift = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** Last calendar date of each period ("W" Monday-based week, "M" month) present in `dates`, optionally from a date. */
export function periodEnds(dates, freq, from = null) {
  const key = freq === "M" ? (d) => d.slice(0, 7) : (d) => Math.floor((Date.parse(`${d}T00:00:00Z`) / DAY + 3) / 7);
  const out = [];
  for (let i = 0; i < dates.length; i++) {
    if (from && dates[i] < from) continue;
    if (i === dates.length - 1 || key(dates[i + 1]) !== key(dates[i])) out.push(i);
  }
  return out; // indices into `dates`
}

/** Union calendar and forward-filled price matrix. Each series is carried at most `stale` days past its last bar. */
export function buildGrid(seriesList, { from = null, to = null, stale = 10 } = {}) {
  const set = new Set();
  for (const s of seriesList) for (const d of s.dates) if ((!from || d >= from) && (!to || d <= to)) set.add(d);
  const dates = [...set].sort();
  const px = seriesList.map((s) => {
    const out = new Array(dates.length).fill(null);
    let k = 0, last = null, lastDate = null;
    for (let i = 0; i < dates.length; i++) {
      while (k < s.dates.length && s.dates[k] <= dates[i]) { if (s.close[k] > 0) { last = s.close[k]; lastDate = s.dates[k]; } k++; }
      if (last != null && lastDate >= shift(dates[i], -stale)) out[i] = last;
    }
    return out;
  });
  return { dates, px };
}

/**
 * Category of every member at each checkpoint (index into `dates`). Returns [checkpoint][member] = label | null.
 * A member is rated only when it has the 1W, 6M and 1Y returns and at least `minPeers` members do.
 */
export function classifyAt(seriesList, checkpointDates, minPeers = MIN_PEERS) {
  const rets = seriesList.map((s) => checkpointReturns(s.dates, s.close, checkpointDates));
  return checkpointDates.map((_, t) => {
    const items = [];
    seriesList.forEach((s, i) => { const r = rets[i][t]; if (r && r.w != null && r.m6 != null && r.y != null) items.push({ key: i, w: r.w, m6: r.m6, y: r.y }); });
    const out = new Array(seriesList.length).fill(null);
    if (items.length < minPeers) return out;
    for (const r of rateGlocom(items)) out[r.key] = r.label;
    return out;
  });
}

/** Target weights {memberIndex: weight} for a rating row. catWeights {label: w} (default equal); idxWeights {key: w} within a category. */
export function targetWeights(rating, keys, categories, { catWeights = null, idxWeights = null } = {}) {
  const groups = new Map();
  for (const c of categories) groups.set(c, []);
  rating.forEach((lab, i) => { if (lab && groups.has(lab)) groups.get(lab).push(i); });
  const live = [...groups.entries()].filter(([, m]) => m.length);
  if (!live.length) return { w: {}, cats: {} };
  // a category with no qualifying index drops out and the rest are re-normalised ("recalculate at every rebalance")
  let rawCat = live.map(([c]) => (catWeights && catWeights[c] != null ? Math.max(0, +catWeights[c] || 0) : 1));
  if (!rawCat.some((x) => x > 0)) rawCat = live.map(() => 1);
  const sumCat = rawCat.reduce((a, b) => a + b, 0);
  const w = {}, cats = {};
  live.forEach(([c, members], k) => {
    const cw = rawCat[k] / sumCat;
    const raw = members.map((i) => (idxWeights && idxWeights[keys[i]] != null ? Math.max(0, +idxWeights[keys[i]] || 0) : 1));
    const s = raw.reduce((a, b) => a + b, 0);
    cats[c] = cw;
    members.forEach((i, j) => { if (s > 0) w[i] = cw * raw[j] / s; });
  });
  return { w, cats };
}

/**
 * Run one portfolio.
 *   seriesList  [{key,label,dates,close}]   the universe
 *   bench       {dates,close}                benchmark (not a member)
 *   opts        { freq:"W"|"M", categories, catWeights, idxWeights, costBps, from, minPeers, ratings? }
 * Returns { dates, nav, bench, holdings, turnover, catContribution, startDate } with NAV = 1 at the first rebalance.
 */
export function runPortfolio(seriesList, bench, opts) {
  const { freq = "W", categories, catWeights = null, idxWeights = null, costBps = 10, from = null, minPeers = MIN_PEERS } = opts;
  const all = bench ? [...seriesList, bench] : seriesList;
  const { dates, px } = buildGrid(all, { from });
  const n = seriesList.length, keys = seriesList.map((s) => s.key);
  const pxM = px.slice(0, n), pxB = bench ? px[n] : null;
  const ends = periodEnds(dates, freq);
  const ratingAt = opts.ratings || classifyAt(seriesList, ends.map((i) => dates[i]), minPeers);
  const rateRow = new Map(ends.map((di, t) => [di, ratingAt[t]]));
  const firstRated = ends.find((di) => rateRow.get(di).some(Boolean));
  if (firstRated == null) return { dates: [], nav: [], bench: [], holdings: [], turnover: 0, catContribution: {}, startDate: null, ratings: ratingAt, ratingDates: ends.map((i) => dates[i]) };

  const holdings = [], navD = [], dd = [], benchNav = [];
  const cats = categories;
  const contrib = Object.fromEntries(cats.map((c) => [c, []]));
  const catOf = new Array(n).fill(null);
  let V = 1, cash = 1, units = new Array(n).fill(0), prevW = {}, turnoverSum = 0, started = false, b0 = null;
  let curCats = {};
  for (let di = firstRated; di < dates.length; di++) {
    // value at today's close and today's contribution by category
    let val = cash;
    const dayC = Object.fromEntries(cats.map((c) => [c, 0]));
    for (let i = 0; i < n; i++) if (units[i] && pxM[i][di] != null) {
      const pPrev = di > firstRated ? pxM[i][di - 1] ?? pxM[i][di] : pxM[i][di];
      val += units[i] * pxM[i][di];
      if (catOf[i] && started) dayC[catOf[i]] += units[i] * (pxM[i][di] - pPrev) / V;
    } else if (units[i]) val += units[i] * (lastPx(pxM[i], di) ?? 0);
    if (started) for (const c of cats) contrib[c].push(dayC[c]);
    else for (const c of cats) contrib[c].push(0);
    V = val;
    if (rateRow.has(di)) {
      const row = rateRow.get(di);
      const { w, cats: cw } = targetWeights(row, keys, cats, { catWeights, idxWeights });
      // trading cost on the weight change against where the weights have drifted to
      let turn = 0;
      const drift = {};
      for (let i = 0; i < n; i++) if (units[i]) drift[i] = units[i] * (pxM[i][di] ?? lastPx(pxM[i], di) ?? 0) / V;
      for (const i of new Set([...Object.keys(w), ...Object.keys(drift)])) turn += Math.abs((w[i] || 0) - (drift[i] || 0));
      if (!started) turn = Object.values(w).reduce((a, b) => a + b, 0);
      const cost = V * turn * costBps / 1e4;
      V -= cost; turnoverSum += turn / 2;
      units = new Array(n).fill(0); catOf.fill(null);
      let invested = 0;
      for (const [iS, wi] of Object.entries(w)) {
        const i = +iS;
        if (pxM[i][di] > 0) { units[i] = V * wi / pxM[i][di]; invested += wi; catOf[i] = row[i]; }
      }
      cash = V * (1 - invested);
      curCats = cw;
      holdings.push({ date: dates[di], cash: 1 - invested, turnover: turn / 2, cats: cw, members: Object.entries(w).map(([i, wi]) => ({ key: keys[+i], label: seriesList[+i].label, category: row[+i], w: wi })) });
      started = true; prevW = w;
    }
    navD.push(V);
    if (pxB) { if (b0 == null && pxB[di] != null) b0 = pxB[di]; benchNav.push(b0 != null && pxB[di] != null ? pxB[di] / b0 : benchNav.at(-1) ?? 1); }
  }
  void prevW; void curCats; void dd;
  const d = dates.slice(firstRated);
  const years = Math.max(1 / 365, (Date.parse(`${d.at(-1)}T00:00:00Z`) - Date.parse(`${d[0]}T00:00:00Z`)) / DAY / 365.25);
  const cum = {};
  for (const c of cats) { let s = 0; cum[c] = contrib[c].map((x) => (s += x)); }
  return { dates: d, nav: navD, bench: benchNav, holdings, turnover: turnoverSum / years, catContribution: cum, startDate: d[0], ratings: ratingAt, ratingDates: ends.map((i) => dates[i]) };
}

function lastPx(arr, di) { for (let k = di; k >= 0; k--) if (arr[k] != null) return arr[k]; return null; }

/** Cut a run to start on `start` (NAV and benchmark re-based to 1, holdings and turnover re-counted), so weekly and monthly share one window. */
export function sliceRun(run, start) {
  if (!run.dates.length || start <= run.dates[0]) return run;
  const k = run.dates.findIndex((d) => d >= start);
  if (k < 0) return { ...run, dates: [], nav: [], bench: [], holdings: [], turnover: 0, catContribution: {}, startDate: null };
  const n0 = run.nav[k], b0 = run.bench[k];
  const holdings = run.holdings.filter((h) => h.date >= start);
  const years = Math.max(1 / 365, dayDiff(run.dates[k], run.dates.at(-1)) / 365.25);
  const cc = {};
  for (const [c, a] of Object.entries(run.catContribution)) { const base = a[k]; cc[c] = a.slice(k).map((x) => x - base); }
  return {
    ...run, dates: run.dates.slice(k), nav: run.nav.slice(k).map((v) => v / n0), bench: run.bench.length ? run.bench.slice(k).map((v) => v / b0) : [],
    holdings, turnover: holdings.slice(1).reduce((a, h) => a + h.turnover, 0) / years, catContribution: cc, startDate: run.dates[k],
  };
}

// ---- statistics ------------------------------------------------------------------------------

const dayDiff = (a, b) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY;
function at(dates, nav, d) { // nav at or before d
  let lo = 0, hi = dates.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (dates[m] <= d) lo = m + 1; else hi = m; }
  return lo ? nav[lo - 1] : null;
}
export const trailing = (dates, nav, days) => {
  if (!dates.length) return null;
  const end = dates.at(-1), start = shift(end, -days);
  if (dates[0] > start) return null;
  const a = at(dates, nav, start);
  return a > 0 ? nav.at(-1) / a - 1 : null;
};
export function cagr(dates, nav, years) {
  if (dates.length < 2) return null;
  const end = dates.at(-1);
  const startD = years == null ? dates[0] : shift(end, -Math.round(years * 365.25));
  if (years != null && dates[0] > startD) return null;
  const a = years == null ? nav[0] : at(dates, nav, startD);
  const span = dayDiff(years == null ? dates[0] : startD, end) / 365.25;
  return a > 0 && span > 0.25 ? Math.pow(nav.at(-1) / a, 1 / span) - 1 : null;
}
export function drawdown(nav) {
  let peak = -Infinity; return nav.map((v) => { peak = Math.max(peak, v); return v / peak - 1; });
}
export function dailyReturns(nav) { const r = []; for (let i = 1; i < nav.length; i++) r.push(nav[i - 1] > 0 ? nav[i] / nav[i - 1] - 1 : 0); return r; }
export function annVol(nav) {
  const r = dailyReturns(nav); if (r.length < 20) return null;
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  return Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1)) * Math.sqrt(252);
}
/** Annualised mean daily return over annualised volatility, rf as an annual rate. */
export function sharpe(nav, rf = 0) {
  const r = dailyReturns(nav); const v = annVol(nav); if (!v || r.length < 20) return null;
  return ((r.reduce((a, b) => a + b, 0) / r.length) * 252 - rf) / v;
}
/** Share of rebalance periods in which the portfolio beat the benchmark (a period with no holding counts as a miss). */
export function hitRatio(dates, nav, benchNav, rebalDates) {
  if (!benchNav?.length || rebalDates.length < 2) return null;
  let hit = 0, n = 0;
  for (let k = 1; k < rebalDates.length; k++) {
    const a = rebalDates[k - 1], b = rebalDates[k];
    const p0 = at(dates, nav, a), p1 = at(dates, nav, b), q0 = at(dates, benchNav, a), q1 = at(dates, benchNav, b);
    if (!(p0 > 0 && q0 > 0)) continue;
    n++; if (p1 / p0 > q1 / q0) hit++;
  }
  return n ? hit / n : null;
}
export function rolling(dates, nav, days) {
  const out = new Array(dates.length).fill(null);
  for (let i = 0; i < dates.length; i++) { const s = shift(dates[i], -days); if (dates[0] > s) continue; const a = at(dates, nav, s); if (a > 0) out[i] = nav[i] / a - 1; }
  return out;
}

/** The comparison-table row set for one NAV (and its benchmark). */
export function stats(run, rf = 0) {
  const { dates, nav, bench, holdings, turnover } = run;
  if (!dates.length) return null;
  const dd = drawdown(nav);
  const mk = (n) => ({
    r1m: trailing(dates, n, 30), r3m: trailing(dates, n, 91), r6m: trailing(dates, n, 182), r1y: trailing(dates, n, 365),
    cagr2: cagr(dates, n, 2), cagr3: cagr(dates, n, 3), cagrAll: cagr(dates, n, null),
    total: n.at(-1) / n[0] - 1, maxDD: Math.min(...drawdown(n)), vol: annVol(n), sharpe: sharpe(n, rf),
  });
  const s = mk(nav);
  void dd;
  s.hit = hitRatio(dates, nav, bench, holdings.map((h) => h.date));
  s.turnover = turnover;
  s.excessCagr = bench?.length && s.cagrAll != null ? s.cagrAll - cagr(dates, bench, null) : null;
  s.bench = bench?.length ? mk(bench) : null;
  s.from = dates[0]; s.to = dates.at(-1); s.rebalances = holdings.length;
  return s;
}

/** Category weights normalised to 100, equal when none given. Throws nothing; returns {ok, total, w}. */
export function normaliseWeights(map, labels) {
  const raw = labels.map((l) => Math.max(0, +map?.[l] || 0));
  const total = raw.reduce((a, b) => a + b, 0);
  return { ok: Math.abs(total - 100) < 0.01, total, w: Object.fromEntries(labels.map((l, i) => [l, total ? raw[i] / total : 1 / labels.length])) };
}

export { GLOCOM_LABELS };
