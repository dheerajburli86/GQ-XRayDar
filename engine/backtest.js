// Event-study backtesting. A "signal" is an event type from the inflection
// database; its outcome is the forward return from the NEXT session's close,
// the excess return over the stock's country CW index for the same dates, and
// the maximum favourable / adverse excursion over the next 63 sessions.
//
// Two forms:
//   BacktestAccumulator - streaming, constant memory, histogram medians; used by
//                         the batch pipeline over the whole universe
//   backtestEvents      - exact, over an in-memory list (a watchlist, one market)

export const HORIZON_KEYS = ["1M", "3M", "6M", "12M"];

const BIN = 0.5, LO = -100, HI = 400, NB = Math.round((HI - LO) / BIN);
const binOf = (v) => Math.max(0, Math.min(NB - 1, Math.floor((v - LO) / BIN)));

function newGroup() {
  return { n: 0, sum: 0, hits: 0, exN: 0, exSum: 0, exHits: 0, hist: new Uint32Array(NB) };
}

export class BacktestAccumulator {
  constructor() { this.groups = new Map(); this.exc = new Map(); }
  _g(key) { let g = this.groups.get(key); if (!g) { g = newGroup(); this.groups.set(key, g); } return g; }
  add(ev, scopes) {
    for (const scope of scopes) {
      for (const h of HORIZON_KEYS) {
        const r = ev.fwd?.[h];
        if (r == null) continue;
        const g = this._g(`${ev.type}|${scope}|${h}`);
        g.n++; g.sum += r; if (r > 0) g.hits++; g.hist[binOf(r)]++;
        const x = ev.excess?.[h];
        if (x != null) { g.exN++; g.exSum += x; if (x > 0) g.exHits++; }
      }
      if (ev.mfe != null && ev.complete) {
        const k = `${ev.type}|${scope}`;
        let e = this.exc.get(k); if (!e) { e = { n: 0, mfe: 0, mae: 0 }; this.exc.set(k, e); }
        e.n++; e.mfe += ev.mfe; e.mae += ev.mae;
      }
    }
  }
  rows() {
    const out = [];
    for (const [key, g] of this.groups) {
      const [type, scope, horizon] = key.split("|");
      let acc = 0, med = null;
      for (let b = 0; b < NB; b++) { acc += g.hist[b]; if (acc >= g.n / 2) { med = LO + (b + 0.5) * BIN; break; } }
      const e = this.exc.get(`${type}|${scope}`);
      out.push({
        type, scope, horizon, n: g.n, mean: rd(g.sum / g.n), median: rd(med), hitRate: rd((g.hits / g.n) * 100),
        excessMean: g.exN ? rd(g.exSum / g.exN) : null, excessHitRate: g.exN ? rd((g.exHits / g.exN) * 100) : null,
        mfe: e ? rd(e.mfe / e.n) : null, mae: e ? rd(e.mae / e.n) : null,
      });
    }
    return out;
  }
}

/** Exact statistics over an event list, filtered by type. */
export function backtestEvents(events, type = null) {
  const ev = type ? events.filter((e) => e.type === type) : events;
  const res = {};
  for (const h of HORIZON_KEYS) {
    const v = ev.map((e) => e.fwd?.[h]).filter((x) => x != null).sort((a, b) => a - b);
    const x = ev.map((e) => e.excess?.[h]).filter((y) => y != null);
    res[h] = v.length ? {
      n: v.length, mean: rd(avg(v)), median: rd(v[Math.floor(v.length / 2)]), hitRate: rd((v.filter((y) => y > 0).length / v.length) * 100),
      p25: rd(v[Math.floor(v.length * 0.25)]), p75: rd(v[Math.floor(v.length * 0.75)]),
      excessMean: x.length ? rd(avg(x)) : null, excessHitRate: x.length ? rd((x.filter((y) => y > 0).length / x.length) * 100) : null,
    } : { n: 0 };
  }
  const comp = ev.filter((e) => e.complete && e.mfe != null);
  res.excursion = comp.length ? { n: comp.length, mfe: rd(avg(comp.map((e) => e.mfe))), mae: rd(avg(comp.map((e) => e.mae))) } : null;
  return res;
}

const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const rd = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
