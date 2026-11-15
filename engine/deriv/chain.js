// Option-chain analytics for one underlying on one session (end-of-day).
//
// Input (one session, one underlying), as the collector stores it:
//   { date, underlying, kind: "index"|"stock", spot, lot,
//     futures: [{ expiry, close, settle, oi, chgOi, vol, prevClose }],
//     options: [{ expiry, strike, cp: 1|-1, close, settle, prevClose, oi, chgOi, vol, turnover }] }
//
// Every quantity is end-of-day: "live" and "intraday" figures need a streaming
// feed (see engine/deriv/sources.js) and are never imitated from this data.

import { gbs, impliedVol, yearFrac, ninv, ncdf, strikeForDelta } from "./pricing.js";

export const DERIV_DEFAULTS = {
  riskFree: 0.065,          // INR risk-free proxy (91-day T-bill area); shown on every Greeks view
  dividendYield: 0,         // used only when no same-expiry future exists (BSM fallback)
  model: "BLACK76",         // price options off the same-expiry future
  expiryHour: "15:30 IST",  // contracts expire at the close; T counts calendar days / 365
  minPremium: 0.05,         // below this a price carries no volatility information
};

/** The price used for an option: last traded close when it traded, else the exchange settlement price. */
export const premiumOf = (o) => (o.vol > 0 && o.close > 0 ? o.close : o.settle > 0 ? o.settle : o.close > 0 ? o.close : null);

/** Forward for an expiry: the same-expiry future, else put-call parity near the money, else spot carried. */
export function forwardFor(day, expiry, T, r = DERIV_DEFAULTS.riskFree) {
  const fut = (day.futures || []).find((f) => f.expiry === expiry);
  const fp = fut ? (fut.vol > 0 && fut.close > 0 ? fut.close : fut.settle || fut.close) : null;
  if (fp > 0) return { F: fp, source: "future" };
  const byK = new Map();
  for (const o of day.options) if (o.expiry === expiry) { const m = byK.get(o.strike) || {}; m[o.cp > 0 ? "c" : "p"] = premiumOf(o); byK.set(o.strike, m); }
  const syn = [];
  for (const [K, m] of byK) if (m.c > 0 && m.p > 0) syn.push({ K, F: K + (m.c - m.p) * Math.exp(r * T), d: Math.abs(K - day.spot) });
  syn.sort((a, b) => a.d - b.d);
  if (syn.length >= 2) { const take = syn.slice(0, 3).map((x) => x.F).sort((a, b) => a - b); return { F: take[Math.floor(take.length / 2)], source: "synthetic (put-call parity)" }; }
  return { F: day.spot * Math.exp(r * T), source: "spot carried at the risk-free rate" };
}

/**
 * Full chain with implied volatility and Greeks for each contract.
 * Returns { date, underlying, spot, lot, expiries:[{expiry, T, F, fSource, dte, rows:[{strike, ce, pe}]}], assumptions }
 */
export function enrichChain(day, opts = {}) {
  const o = { ...DERIV_DEFAULTS, ...opts };
  const exps = [...new Set(day.options.map((x) => x.expiry))].filter((e) => e >= day.date).sort();
  const expiries = exps.map((expiry) => {
    const T = Math.max(yearFrac(day.date, expiry), 0.5 / 365); // expiry day: half a day left at the close is still informative for Greeks
    const { F, source } = forwardFor(day, expiry, T, o.riskFree);
    const byK = new Map();
    for (const c of day.options) {
      if (c.expiry !== expiry) continue;
      const row = byK.get(c.strike) || { strike: c.strike, ce: null, pe: null };
      const px = premiumOf(c);
      const inp = { cp: c.cp, S: F, F, K: c.strike, T, r: o.riskFree, q: 0 };
      const iv = px >= o.minPremium ? impliedVol("BLACK76", inp, px) : null;
      const g = iv ? gbs(c.cp, F, c.strike, T, o.riskFree, 0, iv) : null;
      const leg = { ...c, px, iv, g, chgPx: px != null && c.prevClose > 0 ? px - c.prevClose : null, intrinsic: Math.max(0, c.cp * (day.spot - c.strike)) };
      if (c.cp > 0) row.ce = leg; else row.pe = leg;
      byK.set(c.strike, row);
    }
    const rows = [...byK.values()].sort((a, b) => a.strike - b.strike);
    return { expiry, T, dte: Math.round(T * 365), F, fSource: source, rows };
  });
  return { date: day.date, underlying: day.underlying, kind: day.kind, spot: day.spot, lot: day.lot, futures: day.futures || [], expiries,
    assumptions: { model: "Black-76 on the same-expiry forward", riskFree: o.riskFree, time: "calendar days / 365 to the 15:30 IST expiry", premium: "last traded price if the contract traded, else the exchange settlement price", data: "exchange end-of-day bhavcopy" } };
}

/** ATM strike: nearest to spot, or to the synthetic / futures forward. */
export function atmStrike(ex, ref) {
  let best = null;
  for (const r of ex.rows) if (best == null || Math.abs(r.strike - ref) < Math.abs(best - ref)) best = r.strike;
  return best;
}

export const moneyness = (cp, K, ref) => (Math.abs(K - ref) / ref < 0.0025 ? "ATM" : cp * (ref - K) > 0 ? "ITM" : "OTM");

/** Put-call ratios by strike, for an expiry and overall. */
export function pcr(ex) {
  let co = 0, po = 0, cv = 0, pv = 0;
  const byStrike = ex.rows.map((r) => {
    const c = r.ce || {}, p = r.pe || {};
    co += c.oi || 0; po += p.oi || 0; cv += c.vol || 0; pv += p.vol || 0;
    return { strike: r.strike, oi: c.oi > 0 ? (p.oi || 0) / c.oi : null, vol: c.vol > 0 ? (p.vol || 0) / c.vol : null };
  });
  return { oi: co > 0 ? po / co : null, vol: cv > 0 ? pv / cv : null, callOi: co, putOi: po, callVol: cv, putVol: pv, byStrike };
}

export function pcrOverall(chain) {
  let co = 0, po = 0, cv = 0, pv = 0;
  for (const ex of chain.expiries) { const p = pcr(ex); co += p.callOi; po += p.putOi; cv += p.callVol; pv += p.putVol; }
  return { oi: co > 0 ? po / co : null, vol: cv > 0 ? pv / cv : null, callOi: co, putOi: po, callVol: cv, putVol: pv };
}

/** Max pain: the settlement price at which option holders' total payout is smallest. */
export function maxPain(ex) {
  let best = null;
  const pains = ex.rows.map((x) => {
    let pain = 0;
    for (const r of ex.rows) {
      pain += (r.ce?.oi || 0) * Math.max(0, x.strike - r.strike);
      pain += (r.pe?.oi || 0) * Math.max(0, r.strike - x.strike);
    }
    if (!best || pain < best.pain) best = { strike: x.strike, pain };
    return { strike: x.strike, pain };
  });
  return { strike: best?.strike ?? null, pains };
}

/** OI walls and concentration. Call walls above spot = resistance, put walls below = support. */
export function oiWalls(ex, spot, n = 3) {
  const calls = ex.rows.filter((r) => r.ce?.oi > 0).map((r) => ({ strike: r.strike, oi: r.ce.oi, chg: r.ce.chgOi || 0 }));
  const puts = ex.rows.filter((r) => r.pe?.oi > 0).map((r) => ({ strike: r.strike, oi: r.pe.oi, chg: r.pe.chgOi || 0 }));
  const conc = (xs) => { const t = xs.reduce((s, x) => s + x.oi, 0); if (!t) return { hhi: null, topShare: null }; return { hhi: xs.reduce((s, x) => s + (x.oi / t) ** 2, 0), topShare: Math.max(...xs.map((x) => x.oi)) / t }; };
  return {
    resistance: calls.filter((c) => c.strike >= spot).sort((a, b) => b.oi - a.oi).slice(0, n),
    support: puts.filter((p) => p.strike <= spot).sort((a, b) => b.oi - a.oi).slice(0, n),
    callConcentration: conc(calls), putConcentration: conc(puts),
    topCall: calls.sort((a, b) => b.oi - a.oi)[0] || null, topPut: puts.sort((a, b) => b.oi - a.oi)[0] || null,
  };
}

/** Synthetic futures from put-call parity at each strike, and conversion / reversal spreads vs the actual future. */
export function parity(ex, r = DERIV_DEFAULTS.riskFree, futurePrice = null) {
  const g = Math.exp(r * ex.T);
  const rows = ex.rows.filter((x) => x.ce?.px > 0 && x.pe?.px > 0).map((x) => {
    const syn = x.strike + (x.ce.px - x.pe.px) * g;
    return { strike: x.strike, synthetic: syn, vsFuture: futurePrice ? syn - futurePrice : null, liquid: (x.ce.vol || 0) > 0 && (x.pe.vol || 0) > 0 };
  });
  // Box spreads between liquid strike pairs: implied financing rate.
  const liq = rows.filter((x) => x.liquid);
  const boxes = [];
  for (let i = 0; i + 1 < liq.length && boxes.length < 12; i++) {
    const a = ex.rows.find((x) => x.strike === liq[i].strike), b = ex.rows.find((x) => x.strike === liq[i + 1].strike);
    const val = a.ce.px - a.pe.px - (b.ce.px - b.pe.px), width = b.strike - a.strike;
    if (val > 0 && val < width) boxes.push({ k1: a.strike, k2: b.strike, cost: val, impliedRate: -Math.log(val / width) / ex.T });
  }
  return { rows, boxes, note: "End-of-day closes are not simultaneous quotes, so parity gaps are indications, not executable arbitrage." };
}

/**
 * Dealer gamma exposure (GEX). Convention (stated wherever shown): dealers are
 * assumed LONG calls and SHORT puts against customers, so call gamma counts
 * positive and put gamma negative. GEX per 1% move = gamma x OI x lot x S^2 x 0.01.
 */
export function gex(ex, spot, lot = 1) {
  const s2 = spot * spot * 0.01 * lot;
  const byStrike = ex.rows.map((r) => {
    const c = (r.ce?.g?.gamma || 0) * (r.ce?.oi || 0) * s2, p = -(r.pe?.g?.gamma || 0) * (r.pe?.oi || 0) * s2;
    return { strike: r.strike, call: c, put: p, net: c + p };
  });
  return { byStrike, total: byStrike.reduce((s, x) => s + x.net, 0) };
}

/** Net GEX recomputed over a grid of spot levels (each strike keeps its own IV); the zero crossing is the gamma flip. */
export function gexProfile(chain, { range = 0.1, steps = 41, expiries = null, r = DERIV_DEFAULTS.riskFree } = {}) {
  const exs = chain.expiries.filter((e) => !expiries || expiries.includes(e.expiry));
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const S = chain.spot * (1 - range + (2 * range * i) / (steps - 1));
    let tot = 0;
    for (const ex of exs) {
      const F = S * (ex.F / chain.spot);
      for (const row of ex.rows) for (const [leg, sign] of [[row.ce, 1], [row.pe, -1]]) {
        if (!leg?.iv || !leg.oi) continue;
        const g = gbs(leg.cp, F, row.strike, ex.T, r, 0, leg.iv);
        tot += sign * g.gamma * leg.oi * (chain.lot || 1) * S * S * 0.01;
      }
    }
    pts.push({ spot: S, gex: tot });
  }
  let flip = null;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (a.gex === 0 || Math.sign(a.gex) !== Math.sign(b.gex)) { flip = a.spot + ((b.spot - a.spot) * (0 - a.gex)) / (b.gex - a.gex || 1); break; }
  }
  return { points: pts, flip, regime: flip == null ? (pts[Math.floor(steps / 2)].gex >= 0 ? "positive" : "negative") : chain.spot >= flip ? "positive" : "negative" };
}

/** Expected move to expiry: from the ATM straddle and from ATM IV (1 and 2 standard deviations). */
export function expectedMove(ex, spot) {
  const k = atmStrike(ex, ex.F);
  const row = ex.rows.find((r) => r.strike === k);
  const straddle = row?.ce?.px > 0 && row?.pe?.px > 0 ? row.ce.px + row.pe.px : null;
  const iv = atmIv(ex);
  const sd = iv ? spot * iv * Math.sqrt(ex.T) : null;
  return { atm: k, straddle, straddlePct: straddle ? straddle / spot : null, iv, sd1: sd, sd2: sd ? 2 * sd : null,
    range1: sd ? [spot - sd, spot + sd] : null, range2: sd ? [spot - 2 * sd, spot + 2 * sd] : null };
}

/** ATM IV: average of call and put IV at the strike nearest the forward. */
export function atmIv(ex) {
  const k = atmStrike(ex, ex.F);
  const row = ex.rows.find((r) => r.strike === k);
  const ivs = [row?.ce?.iv, row?.pe?.iv].filter((x) => x > 0);
  return ivs.length ? ivs.reduce((s, x) => s + x, 0) / ivs.length : null;
}

/** Smile using out-of-the-money contracts (puts below the forward, calls above), which are the liquid side. */
export function smile(ex) {
  return ex.rows.map((r) => {
    const leg = r.strike < ex.F ? r.pe : r.ce;
    const alt = r.strike < ex.F ? r.ce : r.pe;
    const use = leg?.iv ? leg : alt?.iv ? alt : null;
    return use ? { strike: r.strike, k: Math.log(r.strike / ex.F), iv: use.iv, delta: use.g?.delta ?? null, side: use.cp > 0 ? "C" : "P", oi: use.oi } : null;
  }).filter(Boolean);
}

/** IV at a target delta, interpolated across the chain (calls for +delta, puts for -delta). */
export function ivAtDelta(ex, target) {
  const pts = ex.rows.map((r) => (target > 0 ? r.ce : r.pe)).filter((l) => l?.iv && l.g).map((l) => ({ d: l.g.delta, iv: l.iv })).sort((a, b) => a.d - b.d);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if ((a.d - target) * (b.d - target) <= 0 && b.d !== a.d) return a.iv + ((b.iv - a.iv) * (target - a.d)) / (b.d - a.d);
  }
  return null;
}

/** Delta-normalised skew: 25-delta put IV minus 25-delta call IV, 10-delta wings and the risk-reversal / butterfly. */
export function skewMetrics(ex) {
  const p25 = ivAtDelta(ex, -0.25), c25 = ivAtDelta(ex, 0.25), p10 = ivAtDelta(ex, -0.1), c10 = ivAtDelta(ex, 0.1), atm = atmIv(ex);
  return { atm, p25, c25, p10, c10, skew25: p25 != null && c25 != null ? p25 - c25 : null, rr25: p25 != null && c25 != null ? c25 - p25 : null,
    fly25: p25 != null && c25 != null && atm ? (p25 + c25) / 2 - atm : null, wing10: p10 != null && c10 != null ? p10 - c10 : null };
}

/** ATM IV per expiry and forward volatility between consecutive expiries. */
export function termStructure(chain) {
  const pts = chain.expiries.map((ex) => ({ expiry: ex.expiry, dte: ex.dte, T: ex.T, iv: atmIv(ex) })).filter((p) => p.iv);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const v = (b.iv * b.iv * b.T - a.iv * a.iv * a.T) / (b.T - a.T);
    b.fwdVol = v > 0 ? Math.sqrt(v) : null;
    b.fwdNegative = !(v > 0); // calendar arbitrage signal: total variance falls with maturity
  }
  const inverted = pts.length >= 2 && pts[0].iv > pts[1].iv;
  return { points: pts, inverted };
}

/** IV grid for the surface view: expiry x moneyness bucket (strike / forward). */
export function surfaceGrid(chain, buckets = [0.85, 0.9, 0.95, 0.975, 1, 1.025, 1.05, 1.1, 1.15]) {
  return chain.expiries.map((ex) => {
    const sm = smile(ex);
    return { expiry: ex.expiry, dte: ex.dte, cells: buckets.map((m) => interpIv(sm, ex.F * m)) };
  }).filter((r) => r.cells.some((x) => x != null)).map((r) => ({ ...r, buckets }));
}
function interpIv(sm, K) {
  for (let i = 1; i < sm.length; i++) if (sm[i - 1].strike <= K && sm[i].strike >= K) {
    const a = sm[i - 1], b = sm[i];
    return b.strike === a.strike ? a.iv : a.iv + ((b.iv - a.iv) * (K - a.strike)) / (b.strike - a.strike);
  }
  return null;
}

/**
 * Raw SVI fit of total variance w(k) = a + b(rho(k-m) + sqrt((k-m)^2 + s^2)) for one expiry,
 * by Nelder-Mead on vega-free least squares. Returns params, fitted IVs and a
 * butterfly-arbitrage check (Durrleman g(k) >= 0) on a k grid.
 */
export function fitSvi(ex) {
  const sm = smile(ex).filter((p) => p.iv > 0 && Math.abs(p.k) < 0.5);
  if (sm.length < 5) return null;
  const T = ex.T, ks = sm.map((p) => p.k), ws = sm.map((p) => p.iv * p.iv * T);
  const W = (p, k) => p[0] + p[1] * (p[2] * (k - p[3]) + Math.sqrt((k - p[3]) ** 2 + p[4] ** 2));
  const loss = (p) => {
    if (p[1] < 0 || Math.abs(p[2]) >= 1 || p[4] <= 1e-4 || p[0] + p[1] * p[4] * Math.sqrt(1 - p[2] * p[2]) < 0) return 1e9;
    let s = 0; for (let i = 0; i < ks.length; i++) s += (W(p, ks[i]) - ws[i]) ** 2; return s;
  };
  const wmin = Math.min(...ws);
  const p = nelderMead(loss, [wmin * 0.8, 0.1, -0.3, 0, 0.1], 1500);
  const fitted = ex.rows.map((r) => { const k = Math.log(r.strike / ex.F); const w = W(p, k); return { strike: r.strike, iv: w > 0 ? Math.sqrt(w / T) : null }; });
  let arb = false;
  for (let k = -0.4; k <= 0.4; k += 0.02) {
    const h = 1e-4, w = W(p, k), w1 = (W(p, k + h) - W(p, k - h)) / (2 * h), w2 = (W(p, k + h) - 2 * w + W(p, k - h)) / (h * h);
    const g = (1 - (k * w1) / (2 * w)) ** 2 - (w1 * w1) / 4 * (1 / w + 0.25) + w2 / 2;
    if (g < -1e-6) { arb = true; break; }
  }
  const rmse = Math.sqrt(loss(p) / ks.length);
  return { params: { a: p[0], b: p[1], rho: p[2], m: p[3], sigma: p[4] }, fitted, butterflyArbFree: !arb, rmse };
}

function nelderMead(f, x0, iters = 1000) {
  const n = x0.length;
  let pts = [x0, ...x0.map((_, i) => x0.map((v, j) => (j === i ? v + (Math.abs(v) > 1e-3 ? v * 0.2 : 0.05) : v)))].map((x) => ({ x, f: f(x) }));
  for (let it = 0; it < iters; it++) {
    pts.sort((a, b) => a.f - b.f);
    const c = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += pts[i].x[j] / n;
    const worst = pts[n];
    const at = (t) => c.map((v, j) => v + t * (worst.x[j] - v));
    const r = at(-1), fr = f(r);
    if (fr < pts[0].f) { const e = at(-2), fe = f(e); pts[n] = fe < fr ? { x: e, f: fe } : { x: r, f: fr }; }
    else if (fr < pts[n - 1].f) pts[n] = { x: r, f: fr };
    else { const k = at(0.5), fk = f(k); if (fk < worst.f) pts[n] = { x: k, f: fk }; else pts = pts.map((p, i) => (i === 0 ? p : { x: p.x.map((v, j) => pts[0].x[j] + 0.5 * (v - pts[0].x[j])), f: 0 })).map((p, i) => (i === 0 ? p : { x: p.x, f: f(p.x) })); }
    if (Math.abs(pts[n].f - pts[0].f) < 1e-14) break;
  }
  pts.sort((a, b) => a.f - b.f);
  return pts[0].x;
}

/** Risk-neutral probabilities from IV: expire above / below a strike, inside a range, touch before expiry. */
export function probabilities(F, T, iv, { above, below, low, high } = {}) {
  if (!(F > 0 && T > 0 && iv > 0)) return null;
  const pAbove = (K) => ncdf((Math.log(F / K) - 0.5 * iv * iv * T) / (iv * Math.sqrt(T)));
  const out = {};
  if (above) { out.above = pAbove(above); out.touchAbove = Math.min(1, 2 * out.above); }
  if (below) { out.below = 1 - pAbove(below); out.touchBelow = Math.min(1, 2 * out.below); }
  if (low && high) out.inside = pAbove(low) - pAbove(high);
  out.note = "Risk-neutral, from implied volatility (lognormal). Touch probability uses the driftless reflection approximation (about twice the expiry probability).";
  return out;
}

/** Strike at a target delta for an expiry, from its ATM IV. */
export const strikeAtDelta = (ex, cp, delta) => { const iv = atmIv(ex); return iv ? strikeForDelta(cp, ex.F, ex.T, iv, delta) : null; };
export { ninv };
