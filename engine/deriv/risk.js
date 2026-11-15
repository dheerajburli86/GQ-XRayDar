// Portfolio risk for saved (practice) derivatives positions.
//
//   beta / betaWeighted   net Greeks, raw and beta-weighted to a benchmark index
//   pnlAttribution        P&L between two sessions split into delta, gamma,
//                         theta, vega, rho/carry and the unexplained residual
//   stressPortfolio       spot x IV grid, beta-scaled or with correlation breakdown
//   portfolioVar          parametric (delta-gamma), historical and Monte Carlo
//                         VaR and expected shortfall, assumptions disclosed
//   hedgeIdeas            delta / vega neutralising hedges with index futures,
//                         ATM options or the underlying
//   sizing / checkLimits  position sizing rules and hard / soft risk limits
//   marginMonitor         estimated margin use against the user's collateral
//
// Every number is an end-of-day estimate from Black-76 on the stored chain.
// Margin is the stress ESTIMATE from strategy.js, never exchange SPAN.

import { positionPnl, positionGreeks, marginEstimate, makeLeg } from "./strategy.js";
import { atmIv } from "./chain.js";
import { ninv } from "./pricing.js";

const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const quant = (sorted, p) => { if (!sorted.length) return null; const i = (sorted.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo); };

/** Daily log returns aligned by date: {date: spot} maps -> arrays over common dates. */
export function alignedReturns(series) {
  const keys = Object.keys(series);
  if (!keys.length) return { dates: [], rets: {} };
  let common = null;
  for (const k of keys) { const ds = new Set(Object.keys(series[k])); common = common ? new Set([...common].filter((d) => ds.has(d))) : ds; }
  const dates = [...common].sort();
  const rets = {};
  for (const k of keys) { const r = []; for (let i = 1; i < dates.length; i++) { const a = series[k][dates[i - 1]], b = series[k][dates[i]]; r.push(a > 0 && b > 0 ? Math.log(b / a) : 0); } rets[k] = r; }
  return { dates: dates.slice(1), rets };
}

/** OLS beta of x on the benchmark b (both return arrays of equal length). */
export function beta(x, b) {
  const n = Math.min(x.length, b.length);
  if (n < 20) return { beta: 1, n, estimated: true };
  const xs = x.slice(-n), bs = b.slice(-n), mx = mean(xs), mb = mean(bs);
  let cov = 0, vb = 0;
  for (let i = 0; i < n; i++) { cov += (xs[i] - mx) * (bs[i] - mb); vb += (bs[i] - mb) ** 2; }
  return { beta: vb > 0 ? cov / vb : 1, n, estimated: false };
}

/**
 * Per-position Greeks plus beta-weighted delta: the benchmark-index units that
 * move like the position, = delta x spot x beta / benchmark spot.
 */
export function betaWeighted(positions, chains, { betas = {}, benchSpot }) {
  const rows = [];
  const tot = { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0, deltaValue: 0, betaDelta: 0, betaDeltaValue: 0 };
  for (const p of positions) {
    const ch = chains[p.und];
    if (!ch) { rows.push({ ...p, missing: true }); continue; }
    const g = positionGreeks(p.legs, ch);
    const b = betas[p.und]?.beta ?? 1;
    const deltaValue = g.delta * ch.spot;
    const betaDelta = benchSpot > 0 ? (deltaValue * b) / benchSpot : null;
    const r = { ...p, spot: ch.spot, g, beta: b, betaEstimated: betas[p.und]?.estimated ?? true, deltaValue, betaDelta, betaDeltaValue: deltaValue * b };
    rows.push(r);
    for (const k of ["delta", "gamma", "theta", "vega", "rho"]) tot[k] += g[k];
    tot.deltaValue += deltaValue; tot.betaDelta += betaDelta || 0; tot.betaDeltaValue += r.betaDeltaValue;
  }
  return { rows, total: tot };
}

/**
 * Second-order Taylor attribution of the P&L between two sessions of the same
 * underlying, holding the same legs. Greeks are taken on the earlier session.
 */
export function pnlAttribution(legs, chainA, chainB, { r = 0.065 } = {}) {
  const lot = chainA.lot || 1;
  const value = (ch) => legs.reduce((s, l) => { const cur = makeLeg(ch, { ...l, price: null }); return s + l.side * l.qty * (l.type === "EQ" ? 1 : lot) * (cur.price ?? 0); }, 0);
  const vA = value(chainA), vB = value(chainB), actual = vB - vA;
  const g = positionGreeks(legs.map((l) => ({ ...l, iv: makeLeg(chainA, { ...l, price: null }).iv ?? l.iv })), chainA, { r });
  const dS = chainB.spot - chainA.spot;
  const dt = Math.max(0, (Date.parse(chainB.date) - Date.parse(chainA.date)) / 86400000);
  // IV change: average change in each option leg's own IV, in vol points (vega is per 1 point = 0.01).
  const ivCh = []; for (const l of legs) { if (l.type !== "CE" && l.type !== "PE") continue; const a = makeLeg(chainA, { ...l, price: null }).iv, b = makeLeg(chainB, { ...l, price: null }).iv; if (a && b) ivCh.push(b - a); }
  const dIv = ivCh.length ? mean(ivCh) : 0;
  const parts = { delta: g.delta * dS, gamma: 0.5 * g.gamma * dS * dS, theta: g.theta * dt, vega: g.vega * dIv * 100, rho: 0 };
  const explained = Object.values(parts).reduce((s, x) => s + x, 0);
  return { from: chainA.date, to: chainB.date, actual, parts, residual: actual - explained, dS, dIv, days: dt,
    note: "Second-order Taylor expansion with Greeks from the earlier session. Theta is per calendar day, vega per 1 IV point. Rho is shown as zero because the stored rate does not change between sessions; the residual holds higher-order and cross effects (vanna, charm) and model error." };
}

/** Revalue every position for a shock: spot moves by shock x beta (or by shock alone when corrBreak). */
export function shockedPnl(positions, chains, { shock = 0, dv = 0, days = 0, betas = {}, corrBreak = false } = {}) {
  let total = 0;
  for (const p of positions) {
    const ch = chains[p.und];
    if (!ch) continue;
    const b = corrBreak ? 1 : betas[p.und]?.beta ?? 1;
    total += positionPnl(p.legs, ch.spot * (1 + shock * b), ch, { t: days / 365, dv });
  }
  return total - positions.reduce((s, p) => { const ch = chains[p.und]; return ch ? s + positionPnl(p.legs, ch.spot, ch, { t: 0, dv: 0 }) : s; }, 0);
}

/** Stress grid: spot shocks (fractions) x IV shifts (vol points), beta-scaled and correlation breakdown. */
export function stressPortfolio(positions, chains, { spotShocks = [-0.15, -0.1, -0.05, -0.02, -0.01, 0, 0.01, 0.02, 0.05, 0.1, 0.15], ivShifts = [-0.2, -0.1, 0, 0.1, 0.2, 0.5, 1.0], betas = {}, days = 0, relativeIv = true } = {}) {
  const ivOf = (p) => { const ch = chains[p.und]; return ch ? atmIv(ch.expiries.find((e) => e.rows.length >= 3) || ch.expiries[0]) || 0.2 : 0.2; };
  const grid = (corrBreak) => ivShifts.map((s) => ({ ivShift: s, cells: spotShocks.map((shock) => {
    let tot = 0;
    for (const p of positions) {
      const ch = chains[p.und]; if (!ch) continue;
      const dv = relativeIv ? ivOf(p) * s : s;
      tot += shockedPnl([p], chains, { shock, dv, days, betas, corrBreak });
    }
    return { shock, pnl: tot };
  }) }));
  return { spotShocks, ivShifts, betaScaled: grid(false), corrBreakdown: grid(true),
    note: `IV shifts are ${relativeIv ? "relative (+50% = IV x 1.5)" : "absolute vol points"}; the beta-scaled grid moves each underlying by shock x its beta to the benchmark, the correlation-breakdown grid moves every underlying by the full shock regardless of beta (hedges between index and stock legs stop offsetting).` };
}

// ---- random numbers (seeded, so a run can be reproduced) ----
export function rng(seed = 42) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function gauss(r) { let u = 0, v = 0; while (u === 0) u = r(); while (v === 0) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

/** Cholesky of a symmetric positive semi-definite matrix (with a small ridge if needed). */
export function cholesky(M) {
  const n = M.length, L = M.map(() => new Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
    let s = M[i][j];
    for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
    L[i][j] = i === j ? Math.sqrt(Math.max(s, 1e-12)) : s / L[j][j];
  }
  return L;
}

export function covariance(rets, keys) {
  const n = Math.min(...keys.map((k) => rets[k].length));
  const m = keys.map((k) => mean(rets[k].slice(-n)));
  return keys.map((a, i) => keys.map((b, j) => { const x = rets[a].slice(-n), y = rets[b].slice(-n); let s = 0; for (let t = 0; t < n; t++) s += (x[t] - m[i]) * (y[t] - m[j]); return s / Math.max(1, n - 1); }));
}

/**
 * One-day VaR and expected shortfall at `conf`, three ways:
 *   parametric   delta-gamma normal (Cornish-Fisher not applied), from the covariance
 *   historical   full revaluation under each stored joint daily move
 *   monteCarlo   full revaluation under correlated normal moves (corrScale scales
 *                every off-diagonal correlation: 1 = as measured, 0 = independent,
 *                >1 toward a crisis where everything moves together)
 * rets: {und: [daily log returns]} aligned (alignedReturns).
 */
export function portfolioVar(positions, chains, rets, { conf = 0.99, sims = 2000, seed = 7, corrScale = 1, horizonDays = 1 } = {}) {
  const unds = [...new Set(positions.map((p) => p.und))].filter((u) => chains[u] && rets[u]?.length);
  if (!unds.length) return null;
  const n = Math.min(...unds.map((u) => rets[u].length));
  const reval = (moves) => { let s = 0; for (const p of positions) { const ch = chains[p.und]; if (!ch || moves[p.und] == null) continue; s += positionPnl(p.legs, ch.spot * Math.exp(moves[p.und]), ch, { t: horizonDays / 365 }) - positionPnl(p.legs, ch.spot, ch, { t: 0 }); } return s; };
  const stats = (pnls) => { const s = [...pnls].sort((a, b) => a - b), cut = quant(s, 1 - conf), tail = s.filter((x) => x <= cut); return { var: -cut, es: -mean(tail.length ? tail : [cut]), n: s.length, worst: s[0], best: s[s.length - 1] }; };
  // historical
  const hist = [];
  for (let t = rets[unds[0]].length - n; t < rets[unds[0]].length; t++) { const mv = {}; for (const u of unds) mv[u] = rets[u][rets[u].length - rets[unds[0]].length + t] * Math.sqrt(horizonDays); hist.push(reval(mv)); }
  // covariance + scaled correlations
  const C = covariance(rets, unds);
  const sd = C.map((r, i) => Math.sqrt(r[i]));
  const Cs = C.map((r, i) => r.map((c, j) => (i === j ? c : Math.max(-0.999, Math.min(0.999, (c / (sd[i] * sd[j] || 1)) * corrScale)) * sd[i] * sd[j])));
  const L = cholesky(Cs);
  // Monte Carlo
  const R = rng(seed), mc = [];
  for (let k = 0; k < sims; k++) {
    const z = unds.map(() => gauss(R)), mv = {};
    unds.forEach((u, i) => { let x = 0; for (let j = 0; j <= i; j++) x += L[i][j] * z[j]; mv[u] = x * Math.sqrt(horizonDays); });
    mc.push(reval(mv));
  }
  // parametric delta-gamma (dollar delta and gamma per underlying)
  let mu = 0, varp = 0;
  const dd = unds.map((u) => { let d = 0, g = 0; for (const p of positions.filter((x) => x.und === u)) { const gg = positionGreeks(p.legs, chains[u]); d += gg.delta * chains[u].spot; g += gg.gamma * chains[u].spot ** 2; } return { d, g }; });
  for (let i = 0; i < unds.length; i++) { mu += 0.5 * dd[i].g * Cs[i][i] * horizonDays; for (let j = 0; j < unds.length; j++) varp += dd[i].d * dd[j].d * Cs[i][j] * horizonDays; }
  for (let i = 0; i < unds.length; i++) for (let j = 0; j < unds.length; j++) varp += 0.5 * (dd[i].g * dd[j].g * Cs[i][j] ** 2) * horizonDays * horizonDays;
  const z = ninv(conf), sdp = Math.sqrt(Math.max(0, varp));
  const pdfz = Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
  return {
    conf, horizonDays, underlyings: unds, sessions: n,
    parametric: { var: z * sdp - mu, es: (sdp * pdfz) / (1 - conf) - mu },
    historical: stats(hist), monteCarlo: { ...stats(mc), sims, seed, corrScale },
    assumptions: `${n} stored sessions of daily moves; ${horizonDays}-day horizon (square-root-of-time scaling); full Black-76 revaluation at unchanged IV for historical and Monte Carlo; parametric is delta-gamma normal, a local approximation that can exceed the true worst loss of a capped structure (spreads); prefer the revaluation methods for those. Monte Carlo correlations x ${corrScale}.`,
  };
}

/**
 * Hedge ideas for net Greeks.
 *   delta   index futures lots from beta-weighted delta, or the underlying's own futures
 *   vega    ATM straddles of the benchmark's near expiry, then re-hedge the straddle's delta
 */
export function hedgeIdeas({ betaDelta, vega, bench, perUnd = [] }) {
  const out = [];
  if (bench && Number.isFinite(betaDelta) && Math.abs(betaDelta) >= 0.5 * (bench.lot || 1)) {
    const lots = Math.round(-betaDelta / (bench.lot || 1));
    if (lots) out.push({ kind: "delta", text: `${lots > 0 ? "Buy" : "Sell"} ${Math.abs(lots)} lot(s) of ${bench.und} futures to bring beta-weighted delta near zero (now ${betaDelta.toFixed(0)} index units).`, lots, instrument: `${bench.und} FUT` });
  }
  for (const u of perUnd) if (Math.abs(u.delta) >= 0.5 * (u.lot || 1)) out.push({ kind: "delta", text: `${u.und}: ${u.delta > 0 ? "sell" : "buy"} ${Math.abs(Math.round(u.delta / (u.lot || 1)))} lot(s) of ${u.und} futures (or ${Math.abs(Math.round(u.delta))} shares) to neutralise its own delta ${u.delta.toFixed(0)}.`, lots: -Math.round(u.delta / (u.lot || 1)), instrument: `${u.und} FUT` });
  if (bench?.chain && Number.isFinite(vega) && Math.abs(vega) > 0) {
    const ex = bench.chain.expiries.find((e) => e.rows.length >= 3);
    const row = ex ? ex.rows.reduce((b, r) => (Math.abs(r.strike - bench.chain.spot) < Math.abs(b.strike - bench.chain.spot) ? r : b), ex.rows[0]) : null;
    const v1 = row?.ce?.g && row?.pe?.g ? (row.ce.g.vega + row.pe.g.vega) * (bench.lot || 1) : null;
    if (v1 > 0) {
      const lots = Math.round(-vega / v1);
      if (lots) out.push({ kind: "vega", text: `${lots > 0 ? "Buy" : "Sell"} ${Math.abs(lots)} ${bench.und} ${row.strike} straddle(s) (${ex.expiry}) to offset net vega ${vega.toFixed(0)} (one straddle lot carries ${v1.toFixed(0)}); the straddle is near delta-neutral, re-check delta after.`, lots, instrument: `${bench.und} ${row.strike} straddle ${ex.expiry}` });
    }
  }
  if (!out.length) out.push({ kind: "none", text: "Net delta and vega are small relative to one hedge lot; no hedge suggested." });
  return out;
}

/** Position sizing. All results are numbers of lots (or units), floored. */
export const SIZING_METHODS = {
  fixedFractional: "Fixed fractional: risk a set % of capital at the structure's max loss",
  volTarget: "Volatility target: size so the position's daily vol is a set % of capital",
  greekBudget: "Greek budget: largest size that keeps |delta|, |vega| and |gamma| within budgets",
  kelly: "Fractional Kelly: Kelly fraction from win rate and payoff ratio, scaled down",
};
const fl = (x) => Math.floor(x + 1e-9);
export function sizing(method, p) {
  if (method === "fixedFractional") { const risk = p.capital * p.riskPct; const n = p.maxLossPerLot > 0 ? fl(risk / p.maxLossPerLot) : null; return { lots: n, detail: `risk budget ${risk.toFixed(0)} / max loss per lot ${p.maxLossPerLot?.toFixed(0)}` }; }
  if (method === "volTarget") { const dailyVolPerLot = Math.abs(p.deltaPerLot * p.spot) * (p.annVol / Math.sqrt(252)); const target = p.capital * p.targetDailyPct; return { lots: dailyVolPerLot > 0 ? fl(target / dailyVolPerLot) : null, detail: `target daily vol ${target.toFixed(0)} / per-lot daily vol ${dailyVolPerLot.toFixed(0)}` }; }
  if (method === "greekBudget") { const lim = []; for (const k of ["delta", "vega", "gamma"]) { const per = Math.abs(p.per?.[k] || 0), b = p.budget?.[k]; if (per > 0 && b > 0) lim.push({ k, n: fl(b / per) }); } const m = lim.reduce((a, x) => (a == null || x.n < a.n ? x : a), null); return { lots: m ? m.n : null, detail: m ? `binding: ${m.k}` : "no budget set" }; }
  if (method === "kelly") { const b = p.payoffRatio, w = p.winRate; const f = b > 0 ? w - (1 - w) / b : 0; const frac = Math.max(0, f) * (p.fraction ?? 0.25); const n = p.maxLossPerLot > 0 ? fl((p.capital * frac) / p.maxLossPerLot) : null; return { lots: n, kelly: f, used: frac, detail: `full Kelly ${(f * 100).toFixed(1)}%, using ${(frac * 100).toFixed(1)}% of capital` }; }
  return { lots: null, detail: "unknown method" };
}

/**
 * Risk limits. limits: {maxUnderlyingPct, maxExpiryPct, maxNetDelta, maxNetVega,
 * maxNetGamma, maxDailyLoss, maxMarginPct, hard: [keys that block]} against the
 * current book. Returns breaches with level "hard" | "soft".
 */
export function checkLimits(book, limits = {}, { capital = null, dayPnl = null, margin = null } = {}) {
  const hard = new Set(limits.hard || []), out = [];
  const push = (key, msg, val, lim) => out.push({ key, level: hard.has(key) ? "hard" : "soft", msg, value: val, limit: lim });
  const gross = book.rows.reduce((s, r) => s + Math.abs(r.deltaValue || 0), 0) || 1;
  if (limits.maxUnderlyingPct) { const by = new Map(); for (const r of book.rows) by.set(r.und, (by.get(r.und) || 0) + Math.abs(r.deltaValue || 0)); for (const [u, v] of by) if (v / gross > limits.maxUnderlyingPct) push("maxUnderlyingPct", `${u} is ${(v / gross * 100).toFixed(0)}% of gross delta exposure`, v / gross, limits.maxUnderlyingPct); }
  if (limits.maxExpiryPct) { const by = new Map(); for (const r of book.rows) for (const l of r.legs || []) if (l.expiry) by.set(l.expiry, (by.get(l.expiry) || 0) + l.qty); const tot = [...by.values()].reduce((a, x) => a + x, 0) || 1; for (const [e, v] of by) if (v / tot > limits.maxExpiryPct) push("maxExpiryPct", `${(v / tot * 100).toFixed(0)}% of contracts expire on ${e}`, v / tot, limits.maxExpiryPct); }
  for (const [k, g] of [["maxNetDelta", "betaDelta"], ["maxNetVega", "vega"], ["maxNetGamma", "gamma"]]) if (limits[k] != null && Math.abs(book.total[g]) > limits[k]) push(k, `net ${g === "betaDelta" ? "beta-weighted delta" : g} ${book.total[g].toFixed(1)} exceeds ${limits[k]}`, book.total[g], limits[k]);
  if (limits.maxDailyLoss != null && dayPnl != null && -dayPnl > limits.maxDailyLoss) push("maxDailyLoss", `today's P&L ${dayPnl.toFixed(0)} is past the daily loss limit ${limits.maxDailyLoss}`, dayPnl, limits.maxDailyLoss);
  if (limits.maxMarginPct && capital > 0 && margin != null && margin / capital > limits.maxMarginPct) push("maxMarginPct", `estimated margin is ${(margin / capital * 100).toFixed(0)}% of collateral`, margin / capital, limits.maxMarginPct);
  return out;
}

/** Estimated margin per position and in total, with a what-if for a proposed position. */
export function marginMonitor(positions, chains, { capital = null, proposed = null } = {}) {
  const rows = positions.map((p) => ({ id: p.id, name: p.name, und: p.und, margin: chains[p.und] ? marginEstimate(p.legs, chains[p.und]).estimate : null }));
  const total = rows.reduce((s, r) => s + (r.margin || 0), 0);
  let whatIf = null;
  if (proposed && chains[proposed.und]) {
    // Margin of the combined book for that underlying shows the hedge benefit (or cost) of the new legs.
    const sameUnd = positions.filter((p) => p.und === proposed.und).flatMap((p) => p.legs);
    const before = sameUnd.length ? marginEstimate(sameUnd, chains[proposed.und]).estimate : 0;
    const after = marginEstimate([...sameUnd, ...proposed.legs], chains[proposed.und]).estimate;
    const alone = marginEstimate(proposed.legs, chains[proposed.und]).estimate;
    whatIf = { alone, incremental: after - before, benefit: alone - (after - before), totalAfter: total + (after - before) };
  }
  return { rows, total, capital, utilisation: capital > 0 ? total / capital : null, whatIf, label: "Estimate, not exchange SPAN + exposure" };
}
