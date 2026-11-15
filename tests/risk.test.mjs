// Portfolio risk, Monte Carlo, derivatives alerts, validation, coach, quote
// hygiene, chart patterns, Fibonacci and the exchange capability matrix.
import { test } from "node:test";
import assert from "node:assert/strict";
import { demoDerivatives, demoStats } from "../engine/deriv/demo.js";
import { enrichChain, quoteFlags, chainQuality } from "../engine/deriv/chain.js";
import { TEMPLATES, legsFromTemplate, positionPnl, recommend, historicalHitRate, strategyMetrics } from "../engine/deriv/strategy.js";
import { alignedReturns, beta, betaWeighted, pnlAttribution, stressPortfolio, portfolioVar, hedgeIdeas, sizing, checkLimits, marginMonitor, cholesky } from "../engine/deriv/risk.js";
import { simulateStrategy } from "../engine/deriv/montecarlo.js";
import { evaluateDerivRule, DERIV_ALERT_RULES, positionView } from "../engine/deriv/alerts.js";
import { brier, calibrationCurve, psi, paramGrid, walkForward, derivCalibration, ivForecastAudit, classification } from "../engine/validation.js";
import { coachReport, postTradeReview } from "../engine/deriv/coach.js";
import { chartPatterns, zigzag } from "../engine/patterns.js";
import { fibonacci } from "../engine/chartTools.js";
import { capability, capabilityNote, freezeSlices, EXCHANGES, CAPABILITIES } from "../engine/deriv/capabilities.js";

const near = (a, b, tol) => Math.abs(a - b) <= tol;
const gen = demoDerivatives("2026-11-13", 80);
const days = gen.days.get("NIFTY");
const chainB = enrichChain(days.at(-1)), chainA = enrichChain(days.at(-2));
const ic = legsFromTemplate(TEMPLATES.find((t) => t.name === "Iron Condor"), chainB);

test("beta of a series on itself is 1, on a scaled copy is the scale", () => {
  const x = Array.from({ length: 100 }, (_, i) => Math.sin(i) / 100);
  assert.ok(near(beta(x, x).beta, 1, 1e-12));
  assert.ok(near(beta(x.map((v) => 2 * v), x).beta, 2, 1e-12));
  const ar = alignedReturns({ A: { "2026-01-01": 100, "2026-01-02": 101, "2026-01-05": 102 }, B: { "2026-01-02": 50, "2026-01-05": 51 } });
  assert.deepEqual(ar.dates, ["2026-01-05"]);
});

test("Taylor attribution explains most of a one-session P&L", () => {
  const legs = legsFromTemplate(TEMPLATES.find((t) => t.name === "Long Call"), chainA);
  const a = pnlAttribution(legs, chainA, chainB);
  const explained = Object.values(a.parts).reduce((s, x) => s + x, 0);
  assert.ok(Number.isFinite(a.actual) && Number.isFinite(a.residual));
  assert.ok(Math.abs(a.actual - explained - a.residual) < 1e-6);
  assert.ok(Math.abs(a.residual) <= Math.max(50, 0.5 * Math.abs(a.actual)), `residual ${a.residual} vs actual ${a.actual}`);
});

test("stress grid, VaR, hedges, sizing, limits and margin", () => {
  const chains = { NIFTY: chainB };
  const positions = [{ id: "p1", und: "NIFTY", legs: ic, name: "IC" }, { id: "p2", und: "NIFTY", legs: legsFromTemplate(TEMPLATES.find((t) => t.name === "Long Futures") || TEMPLATES[0], chainB), name: "F" }];
  const st = stressPortfolio(positions, chains, {});
  const zero = st.betaScaled.find((r) => r.ivShift === 0).cells.find((c) => c.shock === 0);
  assert.ok(near(zero.pnl, 0, 1e-6));
  const spots = Object.fromEntries(days.map((d) => [d.date, d.spot]));
  const { rets } = alignedReturns({ NIFTY: spots });
  const v = portfolioVar(positions, chains, rets, { conf: 0.95, sims: 400 });
  assert.ok(v.historical.var >= 0 && v.monteCarlo.var >= 0 && v.parametric.var > 0);
  assert.ok(v.historical.es >= v.historical.var - 1e-9 && v.monteCarlo.es >= v.monteCarlo.var - 1e-9);
  const L = cholesky([[4, 2], [2, 3]]);
  assert.ok(near(L[0][0] ** 2, 4, 1e-12) && near(L[1][0] * L[0][0], 2, 1e-12));
  const bw = betaWeighted(positions, chains, { benchSpot: chainB.spot });
  const h = hedgeIdeas({ betaDelta: bw.total.betaDelta, vega: bw.total.vega, bench: { und: "NIFTY", lot: chainB.lot, chain: chainB } });
  assert.ok(h.length >= 1);
  assert.equal(sizing("fixedFractional", { capital: 1e6, riskPct: 0.01, maxLossPerLot: 2500 }).lots, 4);
  assert.equal(sizing("kelly", { capital: 1e6, winRate: 0.6, payoffRatio: 1, fraction: 0.5, maxLossPerLot: 10000 }).lots, 10);
  assert.equal(sizing("greekBudget", { per: { delta: 50, vega: 10 }, budget: { delta: 400, vega: 25 } }).lots, 2);
  const br = checkLimits(bw, { maxNetVega: 0, hard: ["maxNetVega"] });
  assert.ok(br.some((x) => x.key === "maxNetVega" && x.level === "hard") || Math.abs(bw.total.vega) === 0);
  const mm = marginMonitor(positions, chains, { capital: 5e6, proposed: { und: "NIFTY", legs: ic } });
  assert.ok(mm.total > 0 && mm.whatIf.incremental <= mm.whatIf.alone + 1e-6);
});

test("Monte Carlo: reproducible with a seed, sensible tails", () => {
  const a = simulateStrategy(ic, chainB, { sims: 500, seed: 3 }), b = simulateStrategy(ic, chainB, { sims: 500, seed: 3 });
  assert.equal(a.mean, b.mean);
  assert.ok(a.p5 <= a.median && a.median <= a.p95 && a.es95 >= a.var95 - 1e-9);
  assert.ok(a.probProfit > 0 && a.probProfit < 1);
  // with no jumps and no vol of vol the P&L can never beat the max profit
  const m = strategyMetrics(ic, chainB);
  const c = simulateStrategy(ic, chainB, { sims: 300, jumpPerYear: 0, volOfVol: 0, seed: 1, days: Math.round(m.grid ? chainB.expiries[0].dte : 1) });
  assert.ok(c.best <= m.maxProfit + 1);
});

test("derivatives alerts fire on an edge only", () => {
  const s0 = { date: "2026-11-12", pcrOi: 1.2, spot: 100, atmIv: 0.2 }, s1 = { date: "2026-11-13", pcrOi: 1.6, spot: 100, atmIv: 0.15 };
  assert.equal(evaluateDerivRule("pcr_high", { level: 1.5 }, s1, s0).fired, true);
  assert.equal(evaluateDerivRule("pcr_high", { level: 1.5 }, s1, { ...s0, pcrOi: 1.7 }).fired, false);
  assert.equal(evaluateDerivRule("iv_crush", { pct: 0.15 }, s1, s0).fired, true);
  assert.equal(evaluateDerivRule("mwpl_ban", {}, { banned: true, pct: 0.96 }, { banned: false, pct: 0.9 }).fired, true);
  assert.equal(evaluateDerivRule("gamma_flip_cross", {}, { spot: 105, gammaFlip: 102 }, { spot: 100, gammaFlip: 102 }).fired, true);
  const pv = positionView({ legs: ic }, chainB);
  assert.ok(Number.isFinite(pv.pnl) && pv.metrics);
  for (const [k, R] of Object.entries(DERIV_ALERT_RULES)) assert.equal(typeof R.label(R.params), "string", k);
});

test("calibration maths", () => {
  assert.equal(brier([1, 0], [1, 0]), 0);
  assert.equal(brier([0.5, 0.5], [1, 0]), 0.25);
  const cc = calibrationCurve([0.05, 0.15, 0.95], [0, 0, 1]);
  assert.equal(cc.length, 3);
  assert.equal(classification([0.9, 0.2, 0.7], [1, 0, 0]).falsePositiveRate, 0.5);
  const xs = Array.from({ length: 500 }, (_, i) => Math.sin(i * 7.1));
  assert.ok(psi(xs, xs) < 0.01);
  assert.ok(psi(xs, xs.map((x) => x + 1)) > 0.25);
  assert.equal(paramGrid({ a: [1, 2], b: [3, 4, 5] }).length, 6);
  const st = demoStats(gen).get("NIFTY");
  const dc = derivCalibration(st);
  assert.ok(dc && dc.brier >= 0 && dc.brier <= 0.25);
  const iva = ivForecastAudit(st.map((h) => h.atmIv), { minFit: 30 });
  assert.ok(iva && iva.directionHitRate >= 0 && iva.directionHitRate <= 1);
});

test("walk-forward chooses on past data and scores on the next period", () => {
  const n = 1500, time = [], close = [];
  let p = 100;
  for (let i = 0; i < n; i++) { const d = new Date(Date.UTC(2015, 0, 1) + i * 86400000); time.push(d.toISOString().slice(0, 10)); p *= Math.exp(0.0003 + 0.015 * Math.sin(i * 0.37) * Math.cos(i * 0.11)); close.push(p); }
  const b = { time, open: close, high: close.map((x) => x * 1.005), low: close.map((x) => x * 0.995), close, volume: close.map(() => 1e5) };
  const wf = walkForward(new Map([["X", b]]), { rule: "rsi_cross_below", tf: "D", candidates: [{ level: 25 }, { level: 30 }, { level: 35 }], folds: 3, minTrades: 3 });
  assert.ok(wf.ok, wf.reason);
  assert.ok(wf.folds.length >= 1 && wf.folds.every((f) => f.inSampleTo < f.outOfSample[1]));
});

test("risk coach flags losses past plan and size before events", () => {
  const e = (id, pnl, lots, extra = {}) => ({ id, at: "2026-10-01", exitAt: "2026-10-05", pnl, lots, plannedMaxLoss: 1000, snapshot: { volRegime: "normal", eventDays: 10 }, ...extra });
  const entries = [e(1, 500, 1), e(2, -2500, 1), e(3, 700, 1), e(4, -3000, 4, { snapshot: { volRegime: "elevated", eventDays: 2 } }), e(5, -400, 4, { snapshot: { volRegime: "elevated", eventDays: 1 } }), e(6, 300, 1)];
  const r = coachReport(entries);
  assert.ok(r.ready);
  assert.ok(r.findings.some((f) => f.title.startsWith("Losses ran past")));
  assert.ok(r.findings.some((f) => f.title.startsWith("Larger size close to events")));
  assert.match(postTradeReview(entries[1]), /passed the planned maximum/);
  assert.equal(coachReport(entries.slice(0, 2)).ready, false);
});

test("recommendations carry evidence, counter-evidence and invalidation triggers", () => {
  const spots = days.map((d) => d.spot);
  const recs = recommend(chainB, { view: "neutral", ivPercentile: 0.7, spots });
  assert.ok(recs.length);
  for (const x of recs) { assert.ok(x.evidence.invalidation.length >= 1); assert.ok(x.evidence.confidence > 0 && x.evidence.confidence <= 0.85); }
  const hh = historicalHitRate(strategyMetrics(ic, chainB), spots, 5, chainB.spot);
  assert.ok(hh && hh.n > 0);
});

test("quote hygiene suppresses IV on invalid contracts", () => {
  assert.ok(quoteFlags({ cp: 1, strike: 90, vol: 0, oi: 0, prevClose: 0 }, null, 100, 0.1).includes("dead"));
  assert.ok(quoteFlags({ cp: 1, strike: 90, vol: 5, oi: 10 }, 5, 100, 0.1).includes("below_intrinsic"));
  assert.deepEqual(quoteFlags({ cp: 1, strike: 100, vol: 10, oi: 10, high: 3, low: 2, close: 2.5 }, 2.5, 100, 0.1), []);
  const q = chainQuality(chainB);
  assert.ok(q.contracts > 0);
  for (const ex of chainB.expiries) for (const r of ex.rows) for (const l of [r.ce, r.pe]) if (l?.q?.includes("dead")) assert.equal(l.iv, null);
});

test("chart patterns, zig-zag and Fibonacci", () => {
  const px = []; let p = 100;
  for (const [n, f] of [[20, 1.003], [10, 0.995], [20, 1.006], [15, 0.993], [15, 1.004], [12, 0.994], [8, 0.993]]) for (let i = 0; i < n; i++) { p *= f; px.push(p); }
  const b = { time: px.map((_, i) => new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10)), close: px, high: px.map((x) => x * 1.002), low: px.map((x) => x * 0.998), open: px };
  const z = zigzag(b, 0.03);
  for (let i = 1; i < z.length; i++) assert.notEqual(z[i].type, z[i - 1].type);
  const pats = chartPatterns(b, { pct: 0.03 });
  assert.ok(pats.some((x) => x.key === "head_shoulders"));
  const f = fibonacci(b);
  assert.equal(f.levels.length, 9);
  assert.ok(near(f.levels.find((l) => l.ratio === 0.5).price, (f.high + f.low) / 2, 1e-9));
});

test("exchange capability matrix and freeze-quantity slicing", () => {
  for (const ex of Object.keys(EXCHANGES)) for (const c of CAPABILITIES) assert.ok(capability(ex, c.key));
  assert.equal(capability("NSE", "eodChain"), "yes");
  assert.equal(capabilityNote("NSE", "eodChain"), null);
  assert.match(capabilityNote("NSE", "depth"), /live/);
  const s = freezeSlices("NSE", "NIFTY", 4000, 75);
  assert.equal(s.slices.reduce((a, x) => a + x, 0), 4000);
  assert.ok(s.slices.every((x) => x <= 1800));
  void positionPnl;
});
