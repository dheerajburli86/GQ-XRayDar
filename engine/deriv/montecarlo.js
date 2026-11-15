// Monte Carlo simulation of a strategy's P&L at a horizon.
//
// The underlying follows a Merton jump-diffusion with a stochastic volatility
// (a discretised Heston variance, full truncation). The option legs are revalued
// at the horizon with Black-76 using the simulated volatility as each leg's IV
// shift, so a volatility spike or crush shows up in the P&L, not only the spot.
// Everything is risk-neutral-ish and labelled a model estimate.

import { positionPnl, positionGreeks } from "./strategy.js";
import { atmIv } from "./chain.js";
import { rng, gauss } from "./risk.js";

export const MC_DEFAULTS = {
  sims: 3000, steps: 20, seed: 11,
  kappa: 3,        // speed of mean reversion of variance (per year)
  volOfVol: 0.6,   // vol of variance
  rho: -0.6,       // spot / variance correlation (equity skew)
  jumpPerYear: 3,  // expected jumps per year
  jumpMean: -0.03, // mean log jump size
  jumpSd: 0.05,    // jump size dispersion
};

function poisson(r, lambda) { const L = Math.exp(-lambda); let k = 0, p = 1; do { k++; p *= r(); } while (p > L); return k - 1; }

/**
 * legs/chain as in strategy.js; days = horizon in calendar days (capped at the
 * first expiry). Returns the distribution, summary statistics and the assumptions.
 */
export function simulateStrategy(legs, chain, opts = {}) {
  const o = { ...MC_DEFAULTS, ...opts };
  const ex = chain.expiries.find((e) => legs.some((l) => l.expiry === e.expiry)) || chain.expiries[0];
  const firstT = Math.min(...legs.filter((l) => l.expiry).map((l) => chain.expiries.find((e) => e.expiry === l.expiry)?.T ?? Infinity), Infinity);
  const H = Math.min((o.days ?? Math.round((Number.isFinite(firstT) ? firstT : 30 / 365) * 365)) / 365, Number.isFinite(firstT) ? firstT : 1);
  const v0 = (o.iv ?? atmIv(ex) ?? 0.2) ** 2, theta = (o.longRunVol ?? Math.sqrt(v0)) ** 2;
  const dt = H / o.steps, R = rng(o.seed);
  const lam = o.jumpPerYear, k = Math.exp(o.jumpMean + 0.5 * o.jumpSd ** 2) - 1;
  const ivNow = Math.sqrt(v0);
  const pnls = [], spots = [], vols = [];
  for (let s = 0; s < o.sims; s++) {
    let x = 0, v = v0;
    for (let t = 0; t < o.steps; t++) {
      const z1 = gauss(R), z2 = o.rho * z1 + Math.sqrt(1 - o.rho ** 2) * gauss(R);
      const vp = Math.max(v, 0);
      const nJ = lam > 0 ? poisson(R, lam * dt) : 0;
      let J = 0; for (let j = 0; j < nJ; j++) J += o.jumpMean + o.jumpSd * gauss(R);
      x += (-0.5 * vp - lam * k) * dt + Math.sqrt(vp * dt) * z1 + J;
      v += o.kappa * (theta - vp) * dt + o.volOfVol * Math.sqrt(vp * dt) * z2;
    }
    const S = chain.spot * Math.exp(x), vol = Math.sqrt(Math.max(v, 1e-6));
    spots.push(S); vols.push(vol);
    pnls.push(positionPnl(legs, S, chain, { t: H, dv: vol - ivNow }));
  }
  const sorted = [...pnls].sort((a, b) => a - b), q = (p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))];
  const mean = pnls.reduce((a, x) => a + x, 0) / pnls.length;
  const tail5 = sorted.slice(0, Math.max(1, Math.floor(0.05 * sorted.length)));
  const bins = 40, lo = sorted[0], hi = sorted[sorted.length - 1], w = (hi - lo) / bins || 1;
  const hist = Array.from({ length: bins }, (_, i) => ({ x: lo + (i + 0.5) * w, n: 0 }));
  for (const p of pnls) hist[Math.min(bins - 1, Math.floor((p - lo) / w))].n++;
  return {
    horizonDays: Math.round(H * 365), sims: o.sims, mean, median: q(0.5), p5: q(0.05), p95: q(0.95), p1: q(0.01),
    var95: -q(0.05), es95: -tail5.reduce((a, x) => a + x, 0) / tail5.length,
    probProfit: pnls.filter((x) => x > 0).length / pnls.length, worst: sorted[0], best: sorted[sorted.length - 1],
    hist, spotP5: [...spots].sort((a, b) => a - b)[Math.floor(0.05 * spots.length)], spotP95: [...spots].sort((a, b) => a - b)[Math.floor(0.95 * spots.length)],
    volMedian: [...vols].sort((a, b) => a - b)[Math.floor(vols.length / 2)], greeksNow: positionGreeks(legs, chain),
    params: o,
    assumptions: `Merton jump-diffusion with Heston-type stochastic variance: start vol ${(ivNow * 100).toFixed(1)}% (ATM IV), mean reversion ${o.kappa}/yr to ${(Math.sqrt(theta) * 100).toFixed(1)}%, vol of vol ${o.volOfVol}, spot/vol correlation ${o.rho}, ${o.jumpPerYear} jumps/yr of mean ${(o.jumpMean * 100).toFixed(1)}% (sd ${(o.jumpSd * 100).toFixed(1)}%). Legs revalued with Black-76, simulated vol applied as a parallel IV shift. Seed ${o.seed}. Model estimate.`,
  };
}
