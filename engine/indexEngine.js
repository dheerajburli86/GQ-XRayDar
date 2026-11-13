// CW / EW index engine.
//
// The lowest building block is a CELL: one country x one GICS sector x one cap
// segment, rebuilt at every quarterly rebalance. Every published index is an
// aggregation of cells, and the aggregation is exact rather than approximate:
//
//   CW  r_t = sum(cap_{i,t-1} * r_{i,t}) / sum(cap_{i,t-1})   over constituents alive at t
//         -> additive in (numerator, denominator), so any union of cells is a
//            plain sum of the cells' numerators and denominators.
//   EW  every constituent gets value 1 at the rebalance and drifts with its own
//       return; a cell's value is n_cell * G_cell where G is the cell's EW growth
//       since the rebalance. r_t = sum(n G_{t-1} r_cell) / sum(n G_{t-1}).
//
// Each constituent appears in exactly one cell, so a regional or global index
// never double-counts a stock, and it is built from constituent returns -- never
// by summing index levels in different currencies.
//
// Currency: every constituent return is computed in USD,
//     r_usd = (P_t / P_{t-1}) * (fx_t / fx_{t-1}) - 1
// and, for country-level indices, also in the country currency via the cross
// rate. The USD series is therefore the local series' price relatives times the
// FX relatives from the same base date, which is the correct conversion; it is
// never an index level divided by a spot rate.

import { METHODOLOGY } from "./methodology.js";

export const CAPS = ["Large", "Mid", "Small"];

/** Scope key grammar: G | R:<region> | M:<classification> | C:<country>, optionally
 *  followed by |S:<sector> and/or |K:<cap>. Full index key = FAMILY|CCY|scope. */
export function scopeKey({ scope, sector, cap }) {
  let k = scope;
  if (sector) k += `|S:${sector}`;
  if (cap) k += `|K:${cap}`;
  return k;
}
export const indexKey = (family, ccy, scope) => `${family}|${ccy}|${scope}`;

export function parseScope(sk) {
  const parts = sk.split("|");
  const out = { scope: parts[0], sector: null, cap: null };
  for (const p of parts.slice(1)) {
    if (p.startsWith("S:")) out.sector = p.slice(2);
    if (p.startsWith("K:")) out.cap = p.slice(2);
  }
  const [t, v] = out.scope.includes(":") ? out.scope.split(/:(.*)/s) : ["G", null];
  out.scopeType = t; out.scopeValue = v;
  return out;
}

export function parseIndexKey(key) {
  const [family, ccy, ...rest] = key.split("|");
  return { family, ccy, scopeKey: rest.join("|"), ...parseScope(rest.join("|")) };
}

const SCOPE_NAME = { G: "Global", R: "", M: "", C: "" };
export function scopeName(sk) {
  const p = parseScope(sk);
  const base = p.scopeType === "G" ? SCOPE_NAME.G : p.scopeValue;
  return [base, p.cap ? `${p.cap} Cap` : null, p.sector].filter(Boolean).join(" ");
}

/** Hierarchy level per the spec (1..6), plus supplementary levels. */
export function levelOf(sk) {
  const p = parseScope(sk);
  if (p.scopeType === "C") return p.sector && p.cap ? "1" : p.cap ? "2" : p.sector ? "1s" : "3";
  if (p.scopeType === "R") return p.sector || p.cap ? "4s" : "4";
  if (p.scopeType === "M") return p.sector || p.cap ? "5s" : "5";
  return p.sector || p.cap ? "6s" : "6";
}
export const LEVEL_LABEL = {
  1: "L1 Country sector by cap", "1s": "Country sector (all caps)", 2: "L2 Country cap segment", 3: "L3 Country",
  4: "L4 Region", "4s": "Region sector / cap", 5: "L5 Market classification", "5s": "Classification sector / cap",
  6: "L6 Global", "6s": "Global sector / cap",
};

// ── accumulators ──────────────────────────────────────────────────────────────
function newAcc(T) {
  return {
    cwNum: new Float64Array(T), cwDen: new Float64Array(T),
    ewNum: new Float64Array(T), ewDen: new Float64Array(T),
    n: new Int32Array(T), nStale: new Int32Array(T), cap: new Float64Array(T),
    used: false,
  };
}

/** Turn an accumulator into CW and EW series over [start, T). */
function accToSeries(acc, start0, base) {
  const T = acc.n.length;
  // An index whose first constituents arrive at a later rebalance starts THERE,
  // at the base level, instead of carrying a flat line from the first rebalance.
  let start = start0;
  while (start < T && acc.n[start] === 0) start++;
  if (start > start0 && start < T) start--;
  if (start >= T) start = start0;
  const mk = () => ({ start, level: new Float64Array(T).fill(NaN), ret: new Float64Array(T).fill(NaN) });
  const cw = mk(), ew = mk();
  cw.level[start] = base; ew.level[start] = base; cw.ret[start] = 0; ew.ret[start] = 0;
  for (let t = start + 1; t < T; t++) {
    const rc = acc.cwDen[t] > 0 ? acc.cwNum[t] / acc.cwDen[t] : 0;
    const re = acc.ewDen[t] > 0 ? acc.ewNum[t] / acc.ewDen[t] : 0;
    cw.ret[t] = rc; ew.ret[t] = re;
    cw.level[t] = cw.level[t - 1] * (1 + rc);
    ew.level[t] = ew.level[t - 1] * (1 + re);
  }
  return { cw, ew, n: acc.n, nStale: acc.nStale, cap: acc.cap };
}

/**
 * Build all indices.
 *   dates        master calendar (ascending ISO strings)
 *   rebalanceIdx indices into dates of each rebalance (quarter ends), ascending
 *   fx           resolver from buildFxTable
 * Usage: const b = new IndexBuilder(...); for each country b.addCountry(...); b.finish();
 */
export class IndexBuilder {
  constructor({ dates, rebalanceIdx, fx, methodology = METHODOLOGY }) {
    this.dates = dates; this.T = dates.length; this.reb = rebalanceIdx; this.fx = fx; this.m = methodology;
    this.higher = new Map();     // scopeKey -> acc (USD)
    this.series = new Map();     // indexKey -> series record
    this.memberships = [];       // {country, date, idx, latest, members:[...]}
    this.stats = { countries: 0, stocksSeen: 0, stocksIndexed: new Set(), excluded: { noCap: 0, notListed: 0, stale: 0, micro: 0 } };
    this.splitGuarded = []; // [{id, date, ratio}]
  }

  _higher(sk) {
    let a = this.higher.get(sk);
    if (!a) { a = newAcc(this.T); this.higher.set(sk, a); }
    return a;
  }

  /**
   * stocks: [{ sec, first, last, close: Float64Array(T) forward-filled (NaN before first),
   *            traded: Uint8Array(T), sharesHint? }]
   *   sec = security-master record (classification.toSecurity)
   */
  addCountry(country, countryCurrency, stocks, regionOf, classificationOf) {
    const { T, reb, dates, m } = this;
    if (!reb.length) return;
    const start0 = reb[0];
    const fxCC = this.fx(countryCurrency).rate;
    const region = regionOf, cls = classificationOf;
    this.stats.countries++;
    this.stats.stocksSeen += stocks.length;

    // shares (constant, estimated) from the latest cap and the latest close
    for (const s of stocks) {
      s.fxOwn = this.fx(s.sec.currency).rate;
      s.shares = estimateShares(s, this.fx, T);
    }

    // country-level accumulators: scope -> {L: acc, U: acc}
    const local = new Map();
    const loc = (sk) => {
      let a = local.get(sk);
      if (!a) { a = { L: newAcc(T), U: newAcc(T) }; local.set(sk, a); }
      return a;
    };
    const cS = `C:${country}`;

    for (let k = 0; k < reb.length; k++) {
      const start = reb[k];
      const end = k + 1 < reb.length ? reb[k + 1] : T - 1;
      if (end <= start && k + 1 < reb.length) continue;

      // ---- eligibility + cap segments at the rebalance close (point in time) ----
      const elig = [];
      for (const s of stocks) {
        if (s.first > start - m.eligibility.minListingDays) { if (s.last >= start && s.first <= start) this.stats.excluded.notListed++; continue; }
        if (s.last < start) continue;
        if (!(s.close[start] > 0)) continue;
        let lt = start; while (lt > s.first && !s.traded[lt]) lt--;
        if (start - lt > m.eligibility.maxStaleDays) { this.stats.excluded.stale++; continue; }
        if (!(s.shares > 0)) { if (m.eligibility.requireCap) { this.stats.excluded.noCap++; continue; } }
        const capU = s.shares * s.close[start] * s.fxOwn[start];
        if (!(capU > 0)) continue;
        elig.push({ s, capU });
      }
      elig.sort((a, b) => b.capU - a.capU);
      const total = elig.reduce((x, e) => x + e.capU, 0);
      const bp = m.capBreakpoints;
      let cum = 0;
      const members = [];
      for (const e of elig) {
        const f = total > 0 ? cum / total : 1;
        cum += e.capU;
        const seg = f < bp.large ? "Large" : f < bp.mid ? "Mid" : f < bp.small ? "Small" : null;
        if (!seg) { this.stats.excluded.micro++; continue; }
        e.seg = seg;
        members.push(e);
      }
      this.memberships.push({
        country, date: dates[start], idx: start, latest: false,
        members: members.map((e) => ({ id: e.s.sec.id, sector: e.s.sec.sector, ig: e.s.sec.industryGroup, seg: e.seg, capUsd: e.capU })),
      });
      for (const e of members) this.stats.stocksIndexed.add(e.s.sec.id);

      // ---- cells ----
      const cells = new Map();
      for (const e of members) {
        const key = `${e.s.sec.sector}|${e.seg}`;
        let c = cells.get(key);
        if (!c) {
          c = { sector: e.s.sec.sector, seg: e.seg, mem: [], GL: 1, GU: 1 };
          const targetsL = [cS, `${cS}|K:${e.seg}`, `${cS}|S:${e.s.sec.sector}`, `${cS}|S:${e.s.sec.sector}|K:${e.seg}`];
          c.loc = targetsL.map(loc);
          const sec = e.s.sec.sector;
          c.hi = ["G", `G|S:${sec}`, `G|K:${e.seg}`, `R:${region}`, `R:${region}|S:${sec}`, `R:${region}|K:${e.seg}`,
            `M:${cls}`, `M:${cls}|S:${sec}`, `M:${cls}|K:${e.seg}`].map((sk) => this._higher(sk));
          cells.set(key, c);
        }
        c.mem.push({ s: e.s, VL: 1, VU: 1 });
      }
      for (const c of cells.values()) {
        c.n0 = c.mem.length;
        for (const a of c.loc) { a.L.used = true; a.U.used = true; }
        for (const a of c.hi) a.used = true;
      }

      // counts at the rebalance date itself (used by the start date of the series)
      if (k === 0) {
        for (const c of cells.values()) {
          for (const a of c.loc) { a.L.n[start] += c.n0; a.U.n[start] += c.n0; }
          for (const a of c.hi) a.n[start] += c.n0;
          for (const x of c.mem) {
            const cu = x.s.shares * x.s.close[start] * x.s.fxOwn[start];
            for (const a of c.loc) { a.U.cap[start] += cu; a.L.cap[start] += cu / fxCC[start]; }
            for (const a of c.hi) a.cap[start] += cu;
          }
        }
      }

      // ---- daily returns over (start, end] ----
      for (let t = start + 1; t <= end; t++) {
        const fc = fxCC[t] / fxCC[t - 1];
        for (const c of cells.values()) {
          let cwNL = 0, cwDL = 0, cwNU = 0, cwDU = 0, ewNL = 0, ewDL = 0, ewNU = 0, ewDU = 0, n = 0, ns = 0, capNowU = 0;
          for (const x of c.mem) {
            const s = x.s;
            if (t > s.last) continue; // left the index on its last bar
            const p0 = s.close[t - 1], p1 = s.close[t];
            if (!(p0 > 0) || !(p1 > 0)) continue;
            let rel = p1 / p0;
            if (isSplitLike(rel, m.splitGuard)) {
              rel = 1;
              if (!x.guarded) x.guarded = new Set();
              if (!x.guarded.has(t)) { x.guarded.add(t); this.splitGuarded.push({ id: s.sec.id, date: dates[t], ratio: Math.round((p1 / p0) * 10000) / 10000 }); }
            }
            const fo = s.fxOwn[t] / s.fxOwn[t - 1];
            const rU = rel * fo - 1;
            const rL = rel * fo / fc - 1;
            const capPrevU = s.shares * p0 * s.fxOwn[t - 1];
            const capPrevL = capPrevU / fxCC[t - 1];
            cwNU += capPrevU * rU; cwDU += capPrevU;
            cwNL += capPrevL * rL; cwDL += capPrevL;
            ewNU += x.VU * rU; ewDU += x.VU;
            ewNL += x.VL * rL; ewDL += x.VL;
            x.VU *= 1 + rU; x.VL *= 1 + rL;
            n++; if (!s.traded[t]) ns++;
            capNowU += s.shares * p1 * s.fxOwn[t];
          }
          const reU = ewDU > 0 ? ewNU / ewDU : 0, reL = ewDL > 0 ? ewNL / ewDL : 0;
          const wU = c.n0 * c.GU, wL = c.n0 * c.GL; // cell EW value at t-1
          c.GU *= 1 + reU; c.GL *= 1 + reL;
          for (const a of c.loc) {
            const L = a.L, U = a.U;
            L.cwNum[t] += cwNL; L.cwDen[t] += cwDL; L.ewNum[t] += wL * reL; L.ewDen[t] += wL;
            U.cwNum[t] += cwNU; U.cwDen[t] += cwDU; U.ewNum[t] += wU * reU; U.ewDen[t] += wU;
            L.n[t] += n; U.n[t] += n; L.nStale[t] += ns; U.nStale[t] += ns;
            U.cap[t] += capNowU; L.cap[t] += capNowU / fxCC[t];
          }
          for (const a of c.hi) {
            a.cwNum[t] += cwNU; a.cwDen[t] += cwDU; a.ewNum[t] += wU * reU; a.ewDen[t] += wU;
            a.n[t] += n; a.nStale[t] += ns; a.cap[t] += capNowU;
          }
        }
      }

      // latest (partial-quarter) observation for Weight Watcher
      if (k === reb.length - 1 && end > start) {
        const latestMembers = [];
        for (const c of cells.values()) for (const x of c.mem) {
          if (x.s.last < end || !(x.s.close[end] > 0)) continue;
          latestMembers.push({ id: x.s.sec.id, sector: c.sector, ig: x.s.sec.industryGroup, seg: c.seg, capUsd: x.s.shares * x.s.close[end] * x.s.fxOwn[end] });
        }
        this.memberships.push({ country, date: dates[end], idx: end, latest: true, members: latestMembers });
      }
    }

    // ---- emit country-level series (local + USD) ----
    for (const [sk, a] of local) {
      if (!a.U.used) continue;
      const sL = accToSeries(a.L, start0, m.baseLevel), sU = accToSeries(a.U, start0, m.baseLevel);
      const meta = { scopeKey: sk, country, region, classification: cls, currencyCode: countryCurrency };
      this._emit("CW", "LCL", sk, sL.cw, sL, meta, countryCurrency);
      this._emit("EW", "LCL", sk, sL.ew, sL, meta, countryCurrency);
      this._emit("CW", "USD", sk, sU.cw, sU, meta, "USD");
      this._emit("EW", "USD", sk, sU.ew, sU, meta, "USD");
    }
  }

  _emit(family, ccy, sk, s, src, meta, currencyCode) {
    const key = indexKey(family, ccy, sk);
    const p = parseScope(sk);
    this.series.set(key, {
      key, family, ccy, currencyCode, scopeKey: sk, name: `${scopeName(sk)} ${family}${ccy === "LCL" ? ` (${currencyCode})` : " (USD)"}`,
      level: levelOf(sk), scopeType: p.scopeType, scopeValue: p.scopeValue, sector: p.sector, cap: p.cap,
      country: meta.country || null, region: meta.region || null, classification: meta.classification || null,
      start: s.start, values: s.level, rets: s.ret, n: src.n, nStale: src.nStale, capSeries: src.cap,
    });
  }

  /** Aggregate the cross-country (USD) indices. Call once, after every country. */
  finish(regionOfScope = {}) {
    const start0 = this.reb[0];
    for (const [sk, a] of this.higher) {
      if (!a.used) continue;
      const s = accToSeries(a, start0, this.m.baseLevel);
      const p = parseScope(sk);
      const meta = { region: p.scopeType === "R" ? p.scopeValue : null, classification: p.scopeType === "M" ? p.scopeValue : null, ...regionOfScope[sk] };
      this._emit("CW", "USD", sk, s.cw, s, meta, "USD");
      this._emit("EW", "USD", sk, s.ew, s, meta, "USD");
    }
    return this.series;
  }
}

/** True when a one-day price ratio looks like an unadjusted split / consolidation. */
export function isSplitLike(rel, g) {
  if (!g?.enabled || !(rel > 0)) return false;
  if (Math.abs(rel - 1) < g.minMove && Math.abs(1 / rel - 1) < g.minMove) return false;
  for (const f of g.factors) {
    if (Math.abs(rel * f - 1) <= g.tolerance || Math.abs(rel / f - 1) <= g.tolerance) return true;
  }
  return false;
}

/** Constant share count: latest market cap / latest close (both in USD terms).
 *  Returns null when no cap is known -- such a stock is excluded from CW AND EW. */
export function estimateShares(s, fx, T) {
  const sec = s.sec;
  const i = s.last;
  const px = s.close[i];
  if (!(px > 0)) return null;
  const pxUsd = px * fx(sec.currency).rate[Math.min(i, T - 1)];
  let capUsd = null;
  if (sec.capLocal > 0 && sec.capCurrency) capUsd = sec.capLocal * fx(sec.capCurrency).rate[T - 1];
  else if (sec.capUsd > 0) capUsd = sec.capUsd;
  if (!(capUsd > 0) || !(pxUsd > 0)) return null;
  // the cap is "as of" the latest data; a stock whose data ended earlier keeps the
  // ratio at its own last bar (the price that cap was built on is unknown -- estimated)
  const pxUsdLatest = px * fx(sec.currency).rate[T - 1];
  return capUsd / (sec.active ? pxUsdLatest : pxUsd);
}

/** Compact a series to plain arrays from its start (for storage / transfer). */
export function compactSeries(rec, dates) {
  const out = { key: rec.key, dates: [], level: [], ret: [], n: [], nStale: [], cap: [] };
  for (let t = rec.start; t < dates.length; t++) {
    if (!Number.isFinite(rec.values[t])) continue;
    out.dates.push(dates[t]); out.level.push(round(rec.values[t], 6)); out.ret.push(round(rec.rets[t], 10));
    out.n.push(rec.n[t]); out.nStale.push(rec.nStale[t]); out.cap.push(Math.round(rec.capSeries[t]));
  }
  return out;
}
export const round = (v, d) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);
