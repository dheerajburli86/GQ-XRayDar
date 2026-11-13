// Weight Watcher (WW): how a constituent's share of its parent CW index moves
// over time. Weight = constituent market cap / parent aggregate market cap, at
// each quarter-end rebalance, over the parent CW index's own constituent list
// at that date (a stable parent universe: the denominator never includes a stock
// the parent index did not hold). A final observation at the latest date sits at
// the far right of every chart, flagged as a partial quarter.
//
// WW is defined on CW weights only. An EW index weights every constituent
// equally by construction, so an "EW weight" carries no information about
// leadership and is never substituted here.

import { METHODOLOGY } from "./methodology.js";

/** Parent definitions: how to group members into parents and children. */
const PARENTS = [
  // parentType, childType, parentKeyFn, childKeyFn
  ["countrySector", "stock", (m, c) => `C:${c}|S:${m.sector}`, (m) => m.id],
  ["country", "sector", (m, c) => `C:${c}`, (m) => m.sector],
  ["country", "industryGroup", (m, c) => `C:${c}`, (m) => m.ig],
  ["country", "cap", (m, c) => `C:${c}`, (m) => m.seg],
  ["region", "country", (m, c, g) => `R:${g.region}`, (m, c) => c],
  ["region", "sector", (m, c, g) => `R:${g.region}`, (m) => m.sector],
  ["classification", "country", (m, c, g) => `M:${g.classification}`, (m, c) => c],
  ["global", "region", () => "G", (m, c, g) => g.region],
  ["global", "classification", () => "G", (m, c, g) => g.classification],
  ["global", "country", () => "G", (m, c) => c],
  ["global", "sector", () => "G", (m) => m.sector],
  ["global", "cap", () => "G", (m) => m.seg],
];

/**
 * memberships: [{country, date, latest, members:[{id, sector, ig, seg, capUsd}]}]
 * geo: country -> {region, classification}
 * Returns [{parentKey, parentType, childType, dates:[...], latestFlags:[...], children:[{key, weights:[...], caps:[...]}]}]
 */
export function computeWeightWatcher(memberships, geo) {
  // Observation dates = quarter ends + one latest date. Countries' latest dates
  // can differ by a session; they are pooled onto the global latest date.
  const latestDate = memberships.filter((m) => m.latest).map((m) => m.date).sort().pop() || null;
  const qDates = [...new Set(memberships.filter((m) => !m.latest).map((m) => m.date))].sort();
  const obsDates = latestDate && !qDates.includes(latestDate) ? [...qDates, latestDate] : qDates;
  const di = new Map(obsDates.map((d, i) => [d, i]));
  const D = obsDates.length;

  const groups = new Map(); // `${parentKey}#${childType}` -> {parentKey, parentType, childType, total: Float64Array, children: Map}
  for (const ms of memberships) {
    const d = ms.latest ? latestDate : ms.date;
    const t = di.get(d);
    if (t == null) continue;
    const g = geo[ms.country] || { region: "Unassigned", classification: "Unclassified" };
    for (const [ptype, ctype, pk, ck] of PARENTS) {
      for (const m of ms.members) {
        if (!(m.capUsd > 0)) continue;
        const parentKey = pk(m, ms.country, g);
        const gk = `${parentKey}#${ctype}`;
        let grp = groups.get(gk);
        if (!grp) { grp = { parentKey, parentType: ptype, childType: ctype, total: new Float64Array(D), children: new Map() }; groups.set(gk, grp); }
        const childKey = ck(m, ms.country, g);
        let ch = grp.children.get(childKey);
        if (!ch) { ch = new Float64Array(D); grp.children.set(childKey, ch); }
        ch[t] += m.capUsd;
        grp.total[t] += m.capUsd;
      }
    }
  }
  const out = [];
  for (const grp of groups.values()) {
    const children = [];
    for (const [key, caps] of grp.children) {
      const weights = Array.from(caps, (c, t) => (grp.total[t] > 0 && c > 0 ? round6((c / grp.total[t]) * 100) : null));
      children.push({ key, weights, caps: Array.from(caps, (c) => (c > 0 ? Math.round(c) : null)) });
    }
    children.sort((a, b) => (lastVal(b.weights) ?? -1) - (lastVal(a.weights) ?? -1));
    out.push({ parentKey: grp.parentKey, parentType: grp.parentType, childType: grp.childType, dates: obsDates, latestFlags: obsDates.map((d) => d === latestDate && !qDates.includes(d)), children });
  }
  return out;
}

const round6 = (v) => Math.round(v * 1e6) / 1e6;
const lastVal = (xs) => { for (let i = xs.length - 1; i >= 0; i--) if (xs[i] != null) return xs[i]; return null; };

/**
 * Trend / turning point of one weight series (percent values, nulls allowed).
 *   rising / falling       : last two quarter changes both up / both down
 *   turn_up_from_low       : previous observation was the lowest of the look-back
 *                            window (a prolonged low) and the latest is higher
 *   turn_down_from_high    : mirror
 *   sideways               : move over the last 4 observations within +/- sidewaysRel
 */
export function wwTrend(weights, m = METHODOLOGY.ww) {
  const v = weights.map((x, i) => [x, i]).filter(([x]) => x != null);
  if (v.length < 3) return { trend: "insufficient", change4: null, last: v.length ? v[v.length - 1][0] : null };
  const xs = v.map((p) => p[0]);
  const n = xs.length, last = xs[n - 1], prev = xs[n - 2], prev2 = xs[n - 3];
  const back = xs[Math.max(0, n - 5)];
  const change4 = back ? (last / back - 1) : null;
  const win = xs.slice(Math.max(0, n - 1 - m.turnLookbackQuarters), n - 1);
  let trend;
  if (win.length >= 4 && prev === Math.min(...win) && last > prev) trend = "turn_up_from_low";
  else if (win.length >= 4 && prev === Math.max(...win) && last < prev) trend = "turn_down_from_high";
  else if (change4 != null && Math.abs(change4) < m.sidewaysRel) trend = "sideways";
  else if (last > prev && prev > prev2) trend = "rising";
  else if (last < prev && prev < prev2) trend = "falling";
  else trend = last >= prev ? "rising" : "falling";
  return { trend, change4, last, prev };
}

export const WW_TREND_LABEL = {
  rising: "Rising", falling: "Falling", sideways: "Sideways",
  turn_up_from_low: "Turning up from a prolonged low", turn_down_from_high: "Turning down from a high",
  insufficient: "Not enough history",
};

/** Per-point classification for chart markers: +1 rising, -1 falling, 0 flat. */
export function wwPointDirections(weights) {
  return weights.map((w, i) => {
    if (w == null || i === 0 || weights[i - 1] == null) return 0;
    return w > weights[i - 1] ? 1 : w < weights[i - 1] ? -1 : 0;
  });
}
