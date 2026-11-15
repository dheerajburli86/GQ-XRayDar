// User-built indices. A user picks any set of securities and a weighting rule;
// the index is calculated here, in the same engine as every other number, and
// its Weight Watcher series comes out of the same calculation.
//
// Inputs are already in ONE currency (the caller converts to USD when the
// members trade in different currencies). Weighting:
//   CW     : weight = estimated market cap = constant latest share count x price
//            (the same "constant shares, estimated" policy as the house indices)
//   EW     : equal weights reset at every quarter-end, drifting in between
//   CUSTOM : the user's fixed weights, reset at every quarter-end
// A member joins on its first available bar and leaves after its last one; the
// index is chained from member returns, so a joining member never makes it jump.

import { quarterOf } from "./calendar.js";
import { wwTrend } from "./weightWatcher.js";

/**
 * members: [{ id, label, time:[], close:[], shares?:number, weight?:number }]
 * opts: { method: "CW"|"EW"|"CUSTOM", base: 1000, from?: "YYYY-MM-DD" }
 * returns { dates, level, n, weightsAt: {dates, children:[{key,label,weights}]}, warnings }
 */
export function buildCustomIndex(members, { method = "CW", base = 1000, from = null } = {}) {
  const warnings = [];
  const list = members.filter((m) => m.time?.length > 1);
  if (list.length < members.length) warnings.push(`${members.length - list.length} member(s) have no price history and are left out.`);
  if (!list.length) return { dates: [], level: [], n: [], weightsAt: { dates: [], children: [] }, warnings };
  if (method === "CW") for (const m of list) if (!(m.shares > 0)) warnings.push(`${m.label}: no market cap, so it carries no CW weight.`);

  const all = new Set();
  for (const m of list) for (const t of m.time) if (!from || t >= from) all.add(t);
  const dates = [...all].sort();
  // Close on each date, carried forward between a member's own sessions (holidays).
  const px = list.map((m) => {
    const out = new Float64Array(dates.length).fill(NaN);
    let j = 0;
    for (let i = 0; i < dates.length; i++) {
      while (j < m.time.length && m.time[j] <= dates[i]) j++;
      if (j > 0 && dates[i] <= m.time[m.time.length - 1]) out[i] = m.close[j - 1];
    }
    return out;
  });

  const fixed = list.map((m) => (method === "CUSTOM" ? Math.max(0, +m.weight || 0) : 1));
  const level = new Array(dates.length), n = new Array(dates.length);
  const qDates = [], qWeights = list.map(() => []);
  let L = base;
  // Holdings in "index units": value_i = h[i] * price_i. Reset at quarter-ends for EW / CUSTOM.
  const h = new Float64Array(list.length);
  const reset = (i) => {
    const live = list.map((_, k) => Number.isFinite(px[k][i]) && px[k][i] > 0 && fixed[k] > 0);
    const tot = live.reduce((s, ok, k) => s + (ok ? fixed[k] : 0), 0);
    for (let k = 0; k < list.length; k++) h[k] = live[k] && tot > 0 ? (L * fixed[k]) / tot / px[k][i] : 0;
  };
  for (let i = 0; i < dates.length; i++) {
    if (i > 0) {
      let v0 = 0, v1 = 0;
      for (let k = 0; k < list.length; k++) {
        const a = px[k][i - 1], b = px[k][i];
        if (!(a > 0 && b > 0)) continue;
        const w = method === "CW" ? (list[k].shares || 0) * a : h[k] * a;
        v0 += w; v1 += method === "CW" ? (list[k].shares || 0) * b : h[k] * b;
      }
      if (v0 > 0) L *= v1 / v0;
    }
    level[i] = round4(L);
    let cnt = 0;
    for (let k = 0; k < list.length; k++) if (px[k][i] > 0) cnt++;
    n[i] = cnt;
    const qEnd = i === dates.length - 1 || quarterOf(dates[i]) !== quarterOf(dates[i + 1]);
    if (method !== "CW" && i === 0) reset(i);
    if (qEnd) {
      // Weight Watcher observation: each member's share of the index value,
      // taken BEFORE an EW / CUSTOM reset so the drift since the last reset shows.
      const vals = list.map((m, k) => (px[k][i] > 0 ? (method === "CW" ? (m.shares || 0) * px[k][i] : h[k] * px[k][i]) : 0));
      const tot = vals.reduce((s, v) => s + v, 0);
      qDates.push(dates[i]);
      vals.forEach((v, k) => qWeights[k].push(tot > 0 && v > 0 ? round6((v / tot) * 100) : null));
    }
    // A member that appears mid-quarter joins EW / CUSTOM weights at once rather than waiting.
    const joined = method !== "CW" && i > 0 && list.some((_, k) => px[k][i] > 0 && !(px[k][i - 1] > 0));
    if (method !== "CW" && i > 0 && (qEnd || joined)) reset(i);
  }
  const children = list.map((m, k) => ({ key: m.id, label: m.label, weights: qWeights[k], trend: wwTrend(qWeights[k]) }))
    .sort((a, b) => (last(b.weights) ?? -1) - (last(a.weights) ?? -1));
  // The last observation is the latest date: a quarter still running.
  const latestFlags = qDates.map((_, i) => i === qDates.length - 1);
  return { dates, level, n, weightsAt: { dates: qDates, latestFlags, children }, warnings };
}

/** Summary returns of a level series over trading-day horizons. */
export function seriesReturns(dates, level, horizons = { "1M": 21, "3M": 63, "6M": 126, "12M": 252 }) {
  const out = {};
  const i = level.length - 1;
  for (const [k, n] of Object.entries(horizons)) out[k] = i - n >= 0 && level[i - n] > 0 ? level[i] / level[i - n] - 1 : null;
  const y = dates.length ? dates[i].slice(0, 4) : null;
  const j = dates.findIndex((d) => d.slice(0, 4) === y);
  out.YTD = j > 0 ? level[i] / level[j - 1] - 1 : null;
  return out;
}

const round4 = (v) => Math.round(v * 1e4) / 1e4;
const round6 = (v) => Math.round(v * 1e6) / 1e6;
const last = (xs) => { for (let i = xs.length - 1; i >= 0; i--) if (xs[i] != null) return xs[i]; return null; };
