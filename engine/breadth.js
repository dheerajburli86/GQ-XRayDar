// Market breadth: how many stocks participate in a move, per scope and date.
// Counted on the master calendar; a stock contributes from its first bar to its
// last (delisted names are counted while they traded -- no survivorship bias).
// A stock that did not trade on a date carries its previous state and is not
// counted as advancing or declining.

const FIELDS = ["n", "adv", "dec", "n20", "a20", "n50", "a50", "n200", "a200", "nh", "nl", "nm", "bm"];

export class Breadth {
  constructor(T) { this.T = T; this.scopes = new Map(); }
  scope(key, light = false) {
    let s = this.scopes.get(key);
    if (!s) {
      s = { light, f: {} };
      for (const f of light ? ["n50", "a50"] : FIELDS) s.f[f] = new Int32Array(this.T);
      this.scopes.set(key, s);
    }
    return s;
  }

  /**
   * Add one stock.
   *   firstT/lastT   master-index span of the stock
   *   barAt          Int32Array(T): own-bar index in effect at master t (-1 before first bar)
   *   traded         Uint8Array(T)
   *   close          own closes (by own bar)
   *   e20,e50,e200   own-bar EMAs; hi52, lo52 own-bar rolling extremes
   *   weeklyBullAt   Int8Array(T): 1 bull, 0 not, -1 unknown (state of the last COMPLETED week)
   *   keys           scopes it belongs to; lightKeys get only the 50-DMA participation count
   */
  add({ firstT, lastT, barAt, traded, close, e20, e50, e200, hi52, lo52, weeklyBullAt }, keys, lightKeys) {
    const S = keys.map((k) => this.scope(k).f), L = lightKeys.map((k) => this.scope(k, true).f);
    for (let t = firstT; t <= lastT; t++) {
      const j = barAt[t];
      if (j < 0) continue;
      const tr = traded[t] && j > 0;
      const up = tr && close[j] > close[j - 1], dn = tr && close[j] < close[j - 1];
      const has50 = j >= 49, has200 = j >= 199, has20 = j >= 19;
      const ab20 = has20 && close[j] > e20[j], ab50 = has50 && close[j] > e50[j], ab200 = has200 && close[j] > e200[j];
      const nh = tr && j >= 251 && close[j] >= hi52[j], nl = tr && j >= 251 && close[j] <= lo52[j];
      const wb = weeklyBullAt[t];
      for (const f of S) {
        f.n[t]++;
        if (up) f.adv[t]++; else if (dn) f.dec[t]++;
        if (has20) { f.n20[t]++; if (ab20) f.a20[t]++; }
        if (has50) { f.n50[t]++; if (ab50) f.a50[t]++; }
        if (has200) { f.n200[t]++; if (ab200) f.a200[t]++; }
        if (nh) f.nh[t]++; if (nl) f.nl[t]++;
        if (wb >= 0) { f.nm[t]++; if (wb === 1) f.bm[t]++; }
      }
      for (const f of L) { if (has50) { f.n50[t]++; if (ab50) f.a50[t]++; } }
    }
  }

  /** Compact output per scope from `start`: percentages and the A/D line. */
  output(dates, start = 0) {
    const out = {};
    for (const [key, s] of this.scopes) {
      const f = s.f, rec = { key, light: s.light, dates: [] };
      const cols = s.light ? ["pct50"] : ["n", "adv", "dec", "adLine", "pct20", "pct50", "pct200", "newHigh", "newLow", "pctBullMma"];
      for (const c of cols) rec[c] = [];
      let ad = 0, any = false;
      for (let t = start; t < dates.length; t++) {
        if (!any && (s.light ? f.n50[t] : f.n[t]) === 0) continue;
        any = true;
        rec.dates.push(dates[t]);
        const p = (a, b) => (b > 0 ? Math.round((a / b) * 10000) / 100 : null);
        if (s.light) { rec.pct50.push(p(f.a50[t], f.n50[t])); continue; }
        ad += f.adv[t] - f.dec[t];
        rec.n.push(f.n[t]); rec.adv.push(f.adv[t]); rec.dec.push(f.dec[t]); rec.adLine.push(ad);
        rec.pct20.push(p(f.a20[t], f.n20[t])); rec.pct50.push(p(f.a50[t], f.n50[t])); rec.pct200.push(p(f.a200[t], f.n200[t]));
        rec.newHigh.push(f.nh[t]); rec.newLow.push(f.nl[t]); rec.pctBullMma.push(p(f.bm[t], f.nm[t]));
      }
      if (any) out[key] = rec;
    }
    return out;
  }
}

/**
 * Breadth divergence: the scope's CW index is rising while participation
 * deteriorates. Looks back `bars` sessions from the latest date.
 *   index: {dates, level}   breadth: output record
 * Returns {flag, reasons[], indexChg, pct50Chg, adChg, asOf} -- reasons explain every condition.
 */
export function breadthDivergence(index, breadth, bars = 20, minIndexRise = 2, minPctDrop = 5) {
  if (!index?.dates?.length || !breadth?.dates?.length) return null;
  const bi = breadth.dates.length - 1, ii = index.dates.lastIndexOf(breadth.dates[bi]);
  if (ii < bars || bi < bars) return null;
  const indexChg = (index.level[ii] / index.level[ii - bars] - 1) * 100;
  const pct50Chg = breadth.pct50[bi] != null && breadth.pct50[bi - bars] != null ? breadth.pct50[bi] - breadth.pct50[bi - bars] : null;
  const adChg = breadth.adLine ? breadth.adLine[bi] - breadth.adLine[bi - bars] : null;
  const hlNow = breadth.newHigh ? sum(breadth.newHigh, bi - 9, bi) - sum(breadth.newLow, bi - 9, bi) : null;
  const reasons = [];
  if (indexChg >= minIndexRise) {
    if (pct50Chg != null && pct50Chg <= -minPctDrop) reasons.push(`% above 50-DMA fell ${(-pct50Chg).toFixed(1)} pts`);
    if (adChg != null && adChg < 0) reasons.push(`advance/decline line fell by ${-adChg}`);
    if (hlNow != null && hlNow < 0) reasons.push("more new 52-week lows than highs over the last 10 sessions");
  }
  return { flag: reasons.length > 0, reasons, indexChg: Math.round(indexChg * 100) / 100, pct50Chg, adChg, asOf: breadth.dates[bi], bars };
}
const sum = (a, i, j) => { let s = 0; for (let k = Math.max(0, i); k <= j; k++) s += a[k] || 0; return s; };
