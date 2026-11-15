// Out-of-sample validation and forecast calibration.
//
//   walkForward          choose a rule's parameter on past data only, then score
//                        it on the next, unseen period; repeat fold by fold
//   sensitivity          score a rule over a grid of one or two parameters
//   brier / calibration  how well stated probabilities match what happened
//   psi                  population-stability index: has an input's distribution drifted?
//   derivCalibration     the option market's own probabilities (Black-76 at ATM IV)
//                        of finishing above each strike, checked at expiry
//   ivForecastAudit      the AR(1) IV forecast's direction and error on past sessions
//
// All of it describes the past. None of it predicts.

import { ruleScorecard, SCORECARD_HORIZONS } from "./scorecard.js";
import { RULE_DIRECTION } from "./rules.js";
import { ncdf } from "./deriv/pricing.js";
import { ivForecast } from "./deriv/volatility.js";

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

/** Cartesian product of {name: [values]}. */
export function paramGrid(spec) {
  let out = [{}];
  for (const [k, vs] of Object.entries(spec)) out = out.flatMap((o) => vs.map((v) => ({ ...o, [k]: v })));
  return out;
}

/** Signed score of a set of trades at one horizon label: mean move in the rule's direction (%), hit rate, n. */
export function scoreTrades(trades, horizon, dir) {
  const xs = trades.map((t) => t.ret?.[horizon]).filter(Number.isFinite);
  if (!xs.length) return { n: 0, edge: null, hitRate: null, mean: null };
  const d = dir || 1;
  return { n: xs.length, mean: mean(xs), edge: mean(xs.map((x) => d * x)), hitRate: dir ? xs.filter((x) => d * x > 0).length / xs.length : null };
}

/**
 * Walk-forward test of a rule's parameter.
 * barsById: Map(id -> daily bars); candidates: [params]; folds: number of
 * out-of-sample periods (equal date spans of the trade history). Anchored:
 * each in-sample window starts at the beginning of the data.
 */
export function walkForward(barsById, { rule, tf = "D", candidates, folds = 4, horizonIndex = 1, minTrades = 10 }) {
  const dir = RULE_DIRECTION[rule] ?? 0;
  const horizon = SCORECARD_HORIZONS[tf][horizonIndex][1];
  const runs = candidates.map((params) => ({ params, trades: ruleScorecard(barsById, { rule, params, tf, maxTrades: 1e6 }).trades.filter((t) => !t.open) }));
  const dates = runs.flatMap((r) => r.trades.map((t) => t.date)).sort();
  if (dates.length < (folds + 1) * minTrades) return { ok: false, reason: `only ${dates.length} signals across all candidates; need more history or more instruments` };
  const edges = Array.from({ length: folds + 2 }, (_, i) => dates[Math.min(dates.length - 1, Math.floor((i * (dates.length - 1)) / (folds + 1)))]);
  const out = [];
  for (let f = 1; f <= folds; f++) {
    const isEnd = edges[f], oosEnd = edges[f + 1];
    const scored = runs.map((r) => ({ params: r.params, is: scoreTrades(r.trades.filter((t) => t.date <= isEnd), horizon, dir), oos: scoreTrades(r.trades.filter((t) => t.date > isEnd && t.date <= oosEnd), horizon, dir) }));
    const eligible = scored.filter((s) => s.is.n >= minTrades && s.is.edge != null);
    if (!eligible.length) continue;
    const best = eligible.sort((a, b) => b.is.edge - a.is.edge)[0];
    const oosAll = scored.filter((s) => s.oos.n > 0);
    out.push({ fold: f, inSampleTo: isEnd, outOfSample: [isEnd, oosEnd], chosen: best.params, isEdge: best.is.edge, isN: best.is.n, oosEdge: best.oos.edge, oosN: best.oos.n, oosHit: best.oos.hitRate,
      oosRankOfChosen: oosAll.length ? 1 + oosAll.filter((s) => (s.oos.edge ?? -Infinity) > (best.oos.edge ?? -Infinity)).length : null, candidatesOos: oosAll.length });
  }
  const isM = mean(out.map((x) => x.isEdge).filter(Number.isFinite)), oosM = mean(out.map((x) => x.oosEdge).filter(Number.isFinite));
  return { ok: true, rule, tf, horizon, direction: dir, folds: out, inSampleEdge: isM, outOfSampleEdge: oosM, efficiency: isM > 0 ? oosM / isM : null, noInSampleEdge: !(isM > 0),
    method: `Anchored walk-forward over ${folds} out-of-sample periods. In each, the parameter with the best average ${horizon} move in the rule's direction on all earlier signals is chosen, then scored on the next period only. Efficiency = out-of-sample / in-sample edge (near 1 = stable, near 0 or negative = overfit); it is not computed when the in-sample edge itself is not positive, because then no parameter worked even on past data.` };
}

/** Score every parameter combination on all data (for a heatmap). */
export function sensitivity(barsById, { rule, tf = "D", spec, horizonIndex = 1 }) {
  const dir = RULE_DIRECTION[rule] ?? 0;
  const horizon = SCORECARD_HORIZONS[tf][horizonIndex][1];
  const keys = Object.keys(spec);
  const cells = paramGrid(spec).map((params) => ({ params, ...scoreTrades(ruleScorecard(barsById, { rule, params, tf, maxTrades: 1e6 }).trades.filter((t) => !t.open), horizon, dir) }));
  return { keys, spec, horizon, cells, method: `Average ${horizon} move in the rule's direction for each parameter value; a smooth surface is more trustworthy than one sharp peak.` };
}

// ---- probability calibration ----
export function brier(probs, outcomes) { const n = probs.length; if (!n) return null; let s = 0; for (let i = 0; i < n; i++) s += (probs[i] - outcomes[i]) ** 2; return s / n; }
export function logLoss(probs, outcomes) { const n = probs.length; if (!n) return null; let s = 0; for (let i = 0; i < n; i++) { const p = Math.min(1 - 1e-6, Math.max(1e-6, probs[i])); s -= outcomes[i] ? Math.log(p) : Math.log(1 - p); } return s / n; }
export function calibrationCurve(probs, outcomes, bins = 10) {
  const b = Array.from({ length: bins }, (_, i) => ({ lo: i / bins, hi: (i + 1) / bins, n: 0, p: 0, o: 0 }));
  probs.forEach((p, i) => { const k = Math.min(bins - 1, Math.floor(p * bins)); b[k].n++; b[k].p += p; b[k].o += outcomes[i]; });
  return b.filter((x) => x.n).map((x) => ({ lo: x.lo, hi: x.hi, n: x.n, predicted: x.p / x.n, observed: x.o / x.n }));
}
/** Hit rate and false-positive rate for probability forecasts read at a threshold. */
export function classification(probs, outcomes, threshold = 0.5) {
  let tp = 0, fp = 0, tn = 0, fn = 0;
  probs.forEach((p, i) => { const pred = p >= threshold; if (pred && outcomes[i]) tp++; else if (pred) fp++; else if (outcomes[i]) fn++; else tn++; });
  const n = tp + fp + tn + fn;
  return { n, hitRate: n ? (tp + tn) / n : null, falsePositiveRate: fp + tn ? fp / (fp + tn) : null, precision: tp + fp ? tp / (tp + fp) : null };
}
/** Population stability index of `actual` against `expected` (quantile bins of expected). > 0.25 = material drift. */
export function psi(expected, actual, bins = 10) {
  const e = expected.filter(Number.isFinite).sort((a, b) => a - b), a = actual.filter(Number.isFinite);
  if (e.length < bins * 2 || a.length < bins) return null;
  const cuts = Array.from({ length: bins - 1 }, (_, i) => e[Math.floor(((i + 1) * e.length) / bins)]);
  const share = (xs) => { const c = new Array(bins).fill(0); for (const x of xs) { let k = 0; while (k < cuts.length && x > cuts[k]) k++; c[k]++; } return c.map((v) => Math.max(1e-4, v / xs.length)); };
  const pe = share(e), pa = share(a);
  return pe.reduce((s, p, i) => s + (pa[i] - p) * Math.log(pa[i] / p), 0);
}
export const psiLabel = (v) => (v == null ? "—" : v < 0.1 ? "stable" : v < 0.25 ? "moderate drift" : "material drift");

/**
 * Calibration of the option market's probabilities. For every stored session,
 * P(finish above K) = N(d2) under Black-76 at the near expiry's ATM IV, for
 * strikes at -2..+2 standard deviations of the forward; outcome from the spot
 * on the expiry session. hist: tas_fo_stats summaries of one underlying, oldest first.
 */
export function derivCalibration(hist, { sds = [-2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2] } = {}) {
  const spotOn = new Map(hist.map((h) => [h.date, h.spot]));
  const dates = hist.map((h) => h.date);
  const probs = [], outcomes = [], rows = [];
  for (const h of hist) {
    if (!(h.atmIv > 0 && h.nearExpiry && h.spot > 0 && h.nearDte > 0)) continue;
    const d = dates.find((x) => x >= h.nearExpiry);
    if (!d || d === h.date) continue;
    const ST = spotOn.get(d);
    const F = h.fut?.price > 0 && h.fut.expiry === h.nearExpiry ? h.fut.price : h.spot;
    const T = h.nearDte / 365, v = h.atmIv, sq = v * Math.sqrt(T);
    for (const k of sds) {
      const K = F * Math.exp(k * sq);
      const p = ncdf((Math.log(F / K) - 0.5 * v * v * T) / sq);
      probs.push(p); outcomes.push(ST > K ? 1 : 0);
    }
    rows.push({ date: h.date, expiry: h.nearExpiry, F, iv: v, settled: ST, move: ST / F - 1, expected: sq });
  }
  if (!probs.length) return null;
  const base = mean(outcomes);
  return { n: probs.length, sessions: rows.length, brier: brier(probs, outcomes), brierClimatology: base * (1 - base), logLoss: logLoss(probs, outcomes), curve: calibrationCurve(probs, outcomes), classification: classification(probs, outcomes), rows,
    withinOneSd: rows.length ? rows.filter((r) => Math.abs(Math.log(1 + r.move)) <= r.expected).length / rows.length : null,
    method: "Black-76 probability of finishing above strikes from -2 to +2 standard deviations of the near-expiry forward, at that session's ATM IV, checked against the spot on the expiry session. Lower Brier is better; climatology is the score of always forecasting the average outcome." };
}

/** Direction hit rate and error of the AR(1) IV forecast, fitted only on data before each forecast. */
export function ivForecastAudit(ivs, { h = 5, minFit = 40 } = {}) {
  const out = [];
  for (let i = minFit; i + h < ivs.length; i++) {
    const f = ivForecast(ivs.slice(0, i + 1), h);
    if (!f) continue;
    const pred = f.path[h - 1].iv, now = ivs[i], act = ivs[i + h];
    if (!(now > 0 && act > 0)) continue;
    out.push({ i, now, pred, act, dirOk: Math.sign(pred - now) === Math.sign(act - now), err: pred - act, inBand: act >= f.path[h - 1].lo && act <= f.path[h - 1].hi });
  }
  if (!out.length) return null;
  return { n: out.length, h, directionHitRate: out.filter((x) => x.dirOk).length / out.length, mae: mean(out.map((x) => Math.abs(x.err))), bias: mean(out.map((x) => x.err)), bandCoverage: out.filter((x) => x.inBand).length / out.length,
    method: `AR(1) on log ATM IV fitted on sessions up to each date only, projected ${h} sessions; the one-sd band should contain about 68% of outcomes.` };
}
