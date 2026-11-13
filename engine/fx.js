// FX: date-matched historical rates, quoted as USD per ONE unit of currency.
//
// Minor-unit quotes (pence, cents, agorot) are priced in 1/100 of the major
// unit: a GBX price of 1,250 is GBP 12.50. The rate for a minor unit is the
// major rate / 100 -- applying the GBP rate to a GBX price overstates it 100x.
//
// Missing fixings (holidays, a provider gap) carry the previous available rate
// forward and are FLAGGED stale with the number of days carried. A currency
// with no history at all falls back to its latest rate held constant, flagged
// ESTIMATED for every date -- a USD series built on it is labelled so.

import { lowerBound } from "./calendar.js";

export const MINOR_UNITS = { GBX: ["GBP", 100], GBP_PENCE: ["GBP", 100], GBp: ["GBP", 100], ZAC: ["ZAR", 100], ZAc: ["ZAR", 100], ILA: ["ILS", 100], ILa: ["ILS", 100] };

export function majorCurrency(ccy) {
  if (!ccy) return { major: "USD", divisor: 1 };
  const m = MINOR_UNITS[ccy] || MINOR_UNITS[String(ccy).toUpperCase()];
  return m ? { major: m[0], divisor: m[1] } : { major: String(ccy).toUpperCase(), divisor: 1 };
}

/**
 * Build per-currency rate arrays aligned to `dates`.
 * history: { CCY: { dates: [...], usd: [...], source? } }   (majors only)
 * latest:  { CCY: usdPerUnit }                                 (fallback)
 * Returns a resolver (ccy) -> { rate: Float64Array, stale: Uint16Array, estimated: bool, source }
 * for ANY currency code, minor units included.
 */
export function buildFxTable(dates, history = {}, latest = {}) {
  const cache = new Map();
  const T = dates.length;

  function major(code) {
    if (cache.has(code)) return cache.get(code);
    const rate = new Float64Array(T), stale = new Uint16Array(T);
    let estimated = false, source = "history";
    if (code === "USD") { rate.fill(1); source = "identity"; }
    else {
      const h = history[code];
      if (h && h.dates.length) {
        let j = 0, last = null, lastDate = null, lastPos = -1;
        for (let t = 0; t < T; t++) {
          while (j < h.dates.length && h.dates[j] <= dates[t]) {
            if (h.usd[j] > 0) {
              last = h.usd[j]; lastDate = h.dates[j];
              const lb = lowerBound(dates, lastDate);
              lastPos = dates[lb] === lastDate ? lb : lb - 0.5; // a fixing between sessions counts half
            }
            j++;
          }
          if (last == null) {
            // before the first fixing: first available rate, flagged estimated
            rate[t] = h.usd.find((v) => v > 0) || latest[code] || NaN; stale[t] = 65535;
          } else {
            rate[t] = last;
            stale[t] = dates[t] === lastDate ? 0 : Math.min(65534, Math.ceil(t - lastPos));
          }
        }
        source = h.source || "history";
      } else if (latest[code] > 0) {
        rate.fill(latest[code]); stale.fill(65535); estimated = true; source = "latest_constant";
      } else { rate.fill(NaN); estimated = true; source = "missing"; }
    }
    const res = { rate, stale, estimated, source, currency: code };
    cache.set(code, res);
    return res;
  }

  return function resolve(ccy) {
    const { major: m, divisor } = majorCurrency(ccy);
    if (divisor === 1) return major(m);
    const key = `${ccy}`;
    if (cache.has(key)) return cache.get(key);
    const base = major(m);
    const rate = new Float64Array(T);
    for (let t = 0; t < T; t++) rate[t] = base.rate[t] / divisor;
    const res = { ...base, rate, currency: ccy, minorOf: m, divisor };
    cache.set(key, res);
    return res;
  };
}

/** Provenance summary for one currency across a date window. */
export function fxProvenance(fx, from = 0, to = fx.rate.length - 1) {
  let staleDays = 0, maxStale = 0, estimatedDays = 0;
  for (let t = from; t <= to; t++) {
    if (fx.stale[t] === 65535) estimatedDays++;
    else if (fx.stale[t] > 0) { staleDays++; if (fx.stale[t] > maxStale) maxStale = fx.stale[t]; }
  }
  return { currency: fx.currency, source: fx.source, estimated: fx.estimated, staleDays, maxStale, estimatedDays };
}

/** Rate on or before a date from a {dates, usd} history (null if none). */
export function rateOn(hist, d) {
  if (!hist) return null;
  const i = lowerBound(hist.dates, d);
  const k = i < hist.dates.length && hist.dates[i] === d ? i : i - 1;
  return k >= 0 ? hist.usd[k] : null;
}
