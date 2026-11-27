// Builds the workbook index sets (engine/reference/indexSets.js) from series the app holds. Pure: callers pass a loader.
// Method (stated on every set): equal-weighted, daily-rebalanced composite of the members' daily returns, base 100.
// A member joins on the day it has a return; the set starts on the first day at least half of its resolvable members
// have one. A member's close is carried over a holiday for up to 7 days, longer means that member is out that day.
// Nested sets (a member that is another set) use that set's own level.
import { indexSetDefs, classifyMember } from "./reference/indexSets.js";

export const MIN_BARS = 20;
export const CARRY_DAYS = 7;
export const START_SHARE = 0.5;

/** Equal-weight composite of several {dates, close} series. Returns {dates, close, count: members used per day} or null. */
export function composeEqualWeight(series, { startShare = START_SHARE, carry = CARRY_DAYS } = {}) {
  const live = series.filter((s) => s && s.dates?.length >= 2);
  if (!live.length) return null;
  const all = [...new Set(live.flatMap((s) => s.dates))].sort();
  const maps = live.map((s) => { const m = new Map(); for (let i = 0; i < s.dates.length; i++) if (s.close[i] > 0) m.set(s.dates[i], s.close[i]); return m; });
  const last = live.map(() => null), lastAt = live.map(() => 0);
  const need = Math.max(1, Math.ceil(startShare * live.length));
  const dates = [], close = [], count = [];
  let level = 100, started = false;
  for (const d of all) {
    const t = Date.parse(d);
    let sum = 0, n = 0;
    for (let k = 0; k < live.length; k++) {
      const v = maps[k].get(d);
      const fresh = last[k] != null && (t - lastAt[k]) / 864e5 <= carry;
      if (v > 0) {
        if (fresh) { sum += v / last[k] - 1; n++; }
        last[k] = v; lastAt[k] = t;
      }
    }
    if (!started) { if (n >= need) { started = true; dates.push(d); close.push(level); count.push(n); } continue; }
    if (n > 0) level *= 1 + sum / n;
    dates.push(d); close.push(level); count.push(n);
  }
  return dates.length >= 2 ? { dates, close, count } : null;
}

/**
 * Builds every set. `load(candidate)` returns {dates, close, symbol} or null. Returns [{def, series, members: [{raw, code, kind, status, symbol, bars, first, last}]}].
 * status: ok | proxy (a stand-in series) | missing | duplicate (resolves to a series another member of the set already uses).
 */
export async function buildIndexSets(load) {
  const defs = indexSetDefs();
  const byCode = new Map();
  for (const d of defs) { if (!byCode.has(d.sheet)) byCode.set(d.sheet, new Map()); byCode.get(d.sheet).set(d.code, d); }
  const done = new Map();           // `${sheet}|${code}` -> result
  const busy = new Set();
  const cache = new Map();
  const loadCached = async (c) => { const k = `${c.via}|${c.sym}`; if (!cache.has(k)) cache.set(k, await load(c)); return cache.get(k); };

  async function build(def) {
    const key = `${def.sheet}|${def.code}`;
    if (done.has(key)) return done.get(key);
    if (busy.has(key)) throw new Error(`index set ${def.code} contains itself`);
    busy.add(key);
    const members = [], used = new Map(), parts = [];
    for (const raw of def.members) {
      const c = classifyMember(def, raw, byCode);
      const info = { raw, code: c.code, kind: c.kind, status: "missing", symbol: null, bars: 0, first: null, last: null };
      let s = null;
      if (c.kind === "set") {
        const sub = await build(byCode.get(def.sheet).get(c.code));
        if (sub.series) { s = { ...sub.series, symbol: sub.def.symbol }; info.status = "ok"; }
      } else {
        for (const cand of c.candidates) {
          const got = await loadCached(cand);
          if (got && got.dates?.length >= MIN_BARS) { s = { ...got, symbol: got.symbol || cand.sym }; info.status = cand.proxy ? "proxy" : "ok"; info.via = cand.via; break; }
        }
      }
      if (s) {
        if (used.has(s.symbol)) { info.status = "duplicate"; info.duplicateOf = used.get(s.symbol); }
        else { used.set(s.symbol, raw); parts.push(s); }
        info.symbol = s.symbol; info.bars = s.dates.length; info.first = s.dates[0]; info.last = s.dates.at(-1);
      }
      members.push(info);
    }
    const series = composeEqualWeight(parts);
    busy.delete(key);
    const res = { def, series, members };
    done.set(key, res);
    return res;
  }
  const out = [];
  for (const d of defs) out.push(await build(d));
  return out;
}
