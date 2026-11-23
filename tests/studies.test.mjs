import { test } from "node:test";
import assert from "node:assert/strict";
import { atrW, stochastic, adx, parabolicSar, supertrend, ichimoku, pivots, obv, adLine, cmf, vwap, volumeOscillator } from "../engine/studies.js";
import { atr } from "../engine/indicators.js";

const N = 120;
const up = { h: [], l: [], c: [], o: [], v: [], t: [] };
for (let i = 0; i < N; i++) { const c = 100 + i; up.c.push(c); up.h.push(c + 1); up.l.push(c - 1); up.o.push(c - 0.5); up.v.push(1000); up.t.push(new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10)); }
const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} vs ${b}`);

test("ATR (Wilder) matches the engine's ATR", () => {
  const a = atrW(up.h, up.l, up.c, 14), b = atr(up.h, up.l, up.c, 14);
  for (let i = 0; i < N; i++) if (b[i] != null) near(a[i], b[i]);
  near(a.at(-1), 2); // steady +1 a day with a 2-point range: TR = 2
});
test("stochastic: a steady rise closes at the top of the range; flat range = 50", () => {
  const s = stochastic(up.h, up.l, up.c);
  near(s.fastK.at(-1), (up.c.at(-1) - up.l.at(-14)) / (up.h.at(-1) - up.l.at(-14)) * 100);
  assert.ok(s.slowD.at(-1) > 90);
  const flat = Array(30).fill(5);
  assert.equal(stochastic(flat, flat, flat).fastK.at(-1), 50);
});
test("ADX: a one-way rise has +DI > 0, -DI = 0 and ADX near 100", () => {
  const a = adx(up.h, up.l, up.c);
  assert.equal(a.minusDI.at(-1), 0); assert.ok(a.plusDI.at(-1) > 0); assert.ok(a.adx.at(-1) > 99);
});
test("Parabolic SAR and Supertrend follow an uptrend from below", () => {
  const p = parabolicSar(up.h, up.l);
  assert.equal(p.dir.at(-1), 1); assert.ok(p.sar.at(-1) < up.l.at(-1));
  const st = supertrend(up.h, up.l, up.c);
  assert.equal(st.dir.at(-1), 1); assert.ok(st.line.at(-1) < up.c.at(-1));
  // a reversal flips both
  const h = [...up.h], l = [...up.l], c = [...up.c];
  for (let i = 0; i < 40; i++) { const x = c.at(-1) - 3; c.push(x); h.push(x + 1); l.push(x - 1); }
  assert.equal(parabolicSar(h, l).dir.at(-1), -1); assert.equal(supertrend(h, l, c).dir.at(-1), -1);
});
test("Ichimoku: Tenkan is the 9-bar midpoint; spans are drawn 26 bars ahead, Chikou 26 back", () => {
  const ic = ichimoku(up.h, up.l, up.c);
  near(ic.tenkan.at(-1), (up.h.at(-1) + up.l.at(-9)) / 2);
  assert.equal(ic.spanA.length, N + 26);
  near(ic.spanA[N - 1 + 26], (ic.tenkan[N - 1] + ic.kijun[N - 1]) / 2);
  assert.equal(ic.chikou[N - 27], up.c.at(-1));
});
test("pivot points: standard and Fibonacci from the previous bar", () => {
  const p = pivots([110, 0], [90, 0], [100, 0], [100, 100], "standard")[1];
  assert.deepEqual([p.P, p.R1, p.S1, p.R2, p.S2], [100, 110, 90, 120, 80]);
  const f = pivots([110, 0], [90, 0], [100, 0], null, "fibonacci")[1];
  near(f.R1, 107.64); near(f.S2, 87.64);
  const cm = pivots([110, 0], [90, 0], [100, 0], null, "camarilla")[1];
  near(cm.R4, 111);
});
test("OBV, A/D, CMF and the volume oscillator", () => {
  assert.deepEqual(obv([1, 2, 2, 1], [10, 20, 30, 40]), [0, 20, 20, -20]);
  assert.deepEqual(adLine([2, 2], [0, 0], [2, 0], [10, 10]), [10, 0]);
  near(cmf(up.h, up.h.map((x) => x - 2), up.h, up.v, 20).at(-1), 1);
  near(volumeOscillator(Array(30).fill(100)).at(-1), 0);
});
test("anchored VWAP with equal volume = running mean of the typical price", () => {
  const w = vwap(up.t, up.h, up.l, up.c, up.v, { anchor: 10 });
  assert.equal(w.vwap[9], null);
  near(w.vwap[12], (up.c[10] + up.c[11] + up.c[12]) / 3);
  assert.ok(w.upper[0][50] > w.vwap[50] && w.lower[0][50] < w.vwap[50]);
});

import { roc } from "../engine/studies.js";
test("ROC is the % change over n bars, null before n bars and on a zero base", () => {
  const r = roc([100, 110, 121, 0, 50], 1);
  assert.equal(r[0], null);
  assert.ok(Math.abs(r[1] - 10) < 1e-9 && Math.abs(r[2] - 10) < 1e-9);
  assert.ok(Math.abs(r[3] + 100) < 1e-9);
  assert.equal(r[4], null);
  assert.equal(roc([1, 2, 3], 5).every((x) => x === null), true);
});

import { kst, KST_PARAMS } from "../engine/studies.js";
test("KST matches a hand computation of Pring's formula and takes every parameter", () => {
  const c = Array.from({ length: 120 }, (_, i) => 100 + 10 * Math.sin(i / 7) + i * 0.3);
  const rocN = (n) => c.map((v, i) => (i >= n ? (v / c[i - n] - 1) * 100 : null));
  const smaN = (x, n) => x.map((_, i) => { const w = x.slice(i - n + 1, i + 1); return i >= n - 1 && w.every((v) => v != null) ? w.reduce((a, b) => a + b, 0) / n : null; });
  const legs = [[10, 10, 1], [15, 10, 2], [20, 10, 3], [30, 15, 4]].map(([r, s, w]) => smaN(rocN(r), s).map((v) => (v == null ? null : v * w)));
  const want = c.map((_, i) => (legs.every((l) => l[i] != null) ? legs.reduce((a, l) => a + l[i], 0) : null));
  const got = kst(c);
  for (let i = 0; i < c.length; i++) {
    if (want[i] == null) assert.equal(got.kst[i], null, `bar ${i}`);
    else assert.ok(Math.abs(got.kst[i] - want[i]) < 1e-9, `bar ${i}`);
  }
  assert.equal(got.kst[43], null); assert.ok(got.kst[44] != null); // first value at ROC 30 + SMA 15 - 1
  const sig = smaN(got.kst, 9);
  assert.ok(Math.abs(got.signal[100] - sig[100]) < 1e-9);
  // custom periods, weights and signal are honoured; blank inputs fall back to Pring's
  const k2 = kst(c, { roc1: 5, roc2: 7, roc3: 9, roc4: 11, sma1: 3, sma2: 3, sma3: 3, sma4: 4, w1: 1, w2: 1, w3: 1, w4: 1, signal: 4 });
  assert.ok(k2.kst[14] != null && got.kst[14] == null);
  assert.deepEqual(kst(c, { roc1: "" }).params, KST_PARAMS);
  assert.ok(kst([1, 2, 3]).kst.every((v) => v === null));
});

import * as S from "../engine/studies.js";
const close = (a, b, tol = 1e-9) => Math.abs(a - b) < tol;
const series = (n = 160) => {
  const c = Array.from({ length: n }, (_, i) => 100 + 8 * Math.sin(i / 6) + i * 0.2);
  return { c, h: c.map((x, i) => x + 1 + (i % 3) * 0.2), l: c.map((x, i) => x - 1 - (i % 4) * 0.15), v: c.map((_, i) => 1000 + (i % 7) * 100) };
};

test("moving averages: WMA, Hull, DEMA, TEMA and the by-name switch", () => {
  assert.deepEqual(S.wma([1, 2, 3, 4], 3).map((x) => x && +x.toFixed(6)), [null, null, 14 / 6, 20 / 6].map((x) => x && +x.toFixed(6)));
  const flat = Array(60).fill(50);
  for (const k of S.MA_KINDS) { const m = S.movingAverage(k, flat, 10); assert.ok(close(m.at(-1), 50), k); }
  // on a straight line DEMA and TEMA remove the EMA lag; Hull follows it closely
  const ln = Array.from({ length: 200 }, (_, i) => i);
  assert.ok(Math.abs(S.tema(ln, 10).at(-1) - 199) < 0.01 && Math.abs(S.dema(ln, 10).at(-1) - 199) < 0.3 && close(S.hma(ln, 16).at(-1), 199 - 2 / 3, 1e-9));
  assert.equal(S.movingAverage("SMA", [1, 2, 3], 2)[2], 2.5);
});

test("Bollinger: mid = SMA, bands = mid +/- k population SD, %B and width", () => {
  const c = [1, 2, 3, 4, 5], b = S.bollinger(c, 5, 2), sd = Math.sqrt(2);
  assert.ok(close(b.mid[4], 3) && close(b.upper[4], 3 + 2 * sd) && close(b.lower[4], 3 - 2 * sd));
  assert.ok(close(b.pctB[4], (5 - b.lower[4]) / (4 * sd)) && close(b.width[4], (4 * sd / 3) * 100));
  assert.equal(b.mid[3], null);
});

test("CCI, Williams %R, MFI, CMO stay in their published ranges and match hand cases", () => {
  const { c, h, l, v } = series();
  const r = S.williamsR(h, l, c, 14).filter((x) => x != null);
  assert.ok(r.length && r.every((x) => x <= 0 && x >= -100));
  assert.ok(close(S.williamsR([10, 12, 11], [8, 9, 9], [9, 11, 10], 3)[2], ((12 - 10) / (12 - 8)) * -100));
  const m = S.mfi(h, l, c, v, 14).filter((x) => x != null);
  assert.ok(m.length && m.every((x) => x >= 0 && x <= 100));
  assert.equal(S.mfi([2, 3, 4], [0, 1, 2], [1, 2, 3], [1, 1, 1], 2)[2], 100); // only up flows
  const k = S.cmo(c, 9).filter((x) => x != null);
  assert.ok(k.every((x) => x >= -100 && x <= 100));
  assert.equal(S.cmo([1, 2, 3, 4], 3)[3], 100);
  // CCI hand case: TP = close here (h = l = c)
  const tp = [1, 2, 3, 4], cc = S.cci(tp, tp, tp, 4, 0.015);
  assert.ok(close(cc[3], (4 - 2.5) / (0.015 * 1)));
});

test("Keltner, Donchian, Aroon, Vortex shapes", () => {
  const { c, h, l } = series();
  const kc = S.keltner(h, l, c, 20, 10, 2), i = 100;
  assert.ok(kc.upper[i] > kc.mid[i] && kc.mid[i] > kc.lower[i] && close(kc.upper[i] - kc.mid[i], kc.mid[i] - kc.lower[i]));
  const dc = S.donchian(h, l, 20);
  assert.ok(close(dc.upper[i], Math.max(...h.slice(i - 19, i + 1))) && close(dc.lower[i], Math.min(...l.slice(i - 19, i + 1))));
  const up = Array.from({ length: 40 }, (_, j) => j), ar = S.aroon(up, up, 25);
  assert.equal(ar.up.at(-1), 100); assert.equal(ar.down.at(-1), 0); assert.equal(ar.osc.at(-1), 100);
  const vx = S.vortex(h, l, c, 14);
  assert.ok(vx.plus[i] > 0 && vx.minus[i] > 0);
});

test("TRIX, PPO, DPO, Coppock, Mass Index, UO, Elder, Force, EOM, Chaikin oscillator", () => {
  const { c, h, l, v } = series(300);
  const flat = Array(120).fill(10);
  assert.ok(close(S.trix(flat, 15, 9).trix.at(-1), 0));
  const p = S.ppo(c, 12, 26, 9);
  assert.ok(p.ppo.at(-1) != null && close(p.hist.at(-1), p.ppo.at(-1) - p.signal.at(-1)));
  // TradingView default: close - SMA(20) of 11 bars ago; centred: close 11 bars ago - SMA now
  const k = 11, n = c.length, m = c.slice(-20).reduce((a, b) => a + b, 0) / 20, mk = c.slice(n - 20 - k, n - k).reduce((a, b) => a + b, 0) / 20;
  assert.ok(close(S.dpo(c, 20).at(-1), c[n - 1] - mk, 1e-6));
  assert.ok(close(S.dpo(c, 20, true).at(-1), c[n - 1 - k] - m, 1e-6));
  assert.ok(S.coppock(c, 14, 11, 10).at(-1) != null);
  const mi = S.massIndex(h.map(() => 2), l.map(() => 1), 9, 25);
  assert.ok(close(mi.at(-1), 25)); // constant range: every ratio is 1
  const uo = S.ultimateOscillator(h, l, c).filter((x) => x != null);
  assert.ok(uo.length && uo.every((x) => x >= 0 && x <= 100));
  const er = S.elderRay(h, l, c, 13);
  assert.ok(er.bull[200] > er.bear[200]);
  assert.ok(close(S.forceIndex(flat, flat, 13).at(-1), 0));
  assert.ok(S.easeOfMovement(h, l, v, 14).at(-1) != null);
  assert.ok(S.chaikinOscillator(h, l, c, v, 3, 10).at(-1) != null);
});

test("every study in the catalogue draws, with its starting settings and with changed ones", async () => {
  const { studyOverlays } = await import("../src/lib/chartOverlays.js");
  const { c, h, l, v } = series(400);
  const t = c.map((_, i) => `2020-${String(1 + Math.floor(i / 28) % 12).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`);
  const time = t.map((_, i) => new Date(Date.UTC(2015, 0, 1 + i)).toISOString().slice(0, 10));
  const b = { time, open: c, high: h, low: l, close: c, volume: v };
  for (const s of S.STUDIES.filter((x) => !["avwap", "pivots"].includes(x.key))) {
    const o = studyOverlays(b, { [s.key]: { on: true } }, "D");
    const specs = [...o.price, ...o.panes.flatMap((p) => p.specs)];
    assert.ok(specs.length && specs.every((sp) => sp.data.length > 0), `${s.key} draws`);
    const half = Object.fromEntries(Object.entries(s.params).map(([k, x]) => [k, typeof x === "number" ? (Number.isInteger(x) ? Math.max(1, Math.round(x / 2)) : x / 2) : x]));
    const o2 = studyOverlays(b, { [s.key]: { on: true, params: half } }, "D");
    assert.ok([...o2.price, ...o2.panes.flatMap((p) => p.specs)].length, `${s.key} with changed settings`);
  }
});

test("studies: Stochastic RSI, Momentum, Awesome Oscillator, TSI, HV, std dev, linear regression, envelope, Choppiness, Ulcer", async () => {
  const S = await import("../engine/studies.js");
  const c = Array.from({ length: 120 }, (_, i) => 100 + 10 * Math.sin(i / 6) + i * 0.3);
  const h = c.map((x) => x + 1), l = c.map((x) => x - 1);
  // straight line: regression fits exactly, slope = step, R² = 1
  const line = Array.from({ length: 60 }, (_, i) => 50 + 2 * i);
  const lr = S.linearRegression(line, 20);
  assert.ok(Math.abs(lr.value[59] - line[59]) < 1e-9 && Math.abs(lr.slope[59] - 2) < 1e-9 && Math.abs(lr.r2[59] - 1) < 1e-9);
  assert.equal(lr.value[18], null);
  // momentum = close - close n back
  assert.equal(S.momentum(line, 10)[30], 20);
  // constant close: no volatility, std dev 0, HV 0
  const flat = Array(40).fill(10);
  assert.equal(S.stdDev(flat, 20)[39], 0);
  assert.equal(S.historicalVolatility(flat, 20)[39], 0);
  // HV: alternating +/-1% log moves -> sd of returns x sqrt(252)
  const alt = [100]; for (let i = 1; i < 41; i++) alt.push(alt[i - 1] * Math.exp(i % 2 ? 0.01 : -0.01));
  const hv = S.historicalVolatility(alt, 20)[40];
  assert.ok(Math.abs(hv - 0.01 * Math.sqrt(20 / 19) * Math.sqrt(252) * 100) < 1e-6, String(hv));
  // envelope: bands exactly pct around the average
  const env = S.envelope(line, 10, 5, "SMA");
  assert.ok(Math.abs(env.upper[30] - env.mid[30] * 1.05) < 1e-9 && Math.abs(env.lower[30] - env.mid[30] * 0.95) < 1e-9);
  // Stochastic RSI stays within 0-100, %D is the 3-average of %K
  const sr = S.stochRsi(c, 14, 14, 3, 3);
  const ks = sr.k.filter((x) => x != null);
  assert.ok(ks.length > 50 && ks.every((x) => x >= 0 && x <= 100));
  const i = 100; assert.ok(Math.abs(sr.d[i] - (sr.k[i] + sr.k[i - 1] + sr.k[i - 2]) / 3) < 1e-9);
  // AO = SMA5 - SMA34 of the median price
  const ao = S.awesomeOscillator(h, l, 5, 34);
  const med = c; const avg = (a, n, j) => a.slice(j - n + 1, j + 1).reduce((x, y) => x + y, 0) / n;
  assert.ok(Math.abs(ao[80] - (avg(med, 5, 80) - avg(med, 34, 80))) < 1e-9);
  // TSI of a steadily rising series is +100
  const t = S.tsi(line, 25, 13, 13);
  assert.ok(Math.abs(t.tsi[59] - 100) < 1e-9);
  // Choppiness: bounded 0-100 and higher for a sideways series than for a trend
  const side = Array.from({ length: 60 }, (_, j) => 100 + (j % 2 ? 1 : -1));
  const chS = S.choppiness(side.map((x) => x + 0.5), side.map((x) => x - 0.5), side, 14)[59];
  const chT = S.choppiness(line.map((x) => x + 0.5), line.map((x) => x - 0.5), line, 14)[59];
  assert.ok(chS > chT && chS <= 100 && chT >= 0, `${chS} ${chT}`);
  // Ulcer: zero for a series that never draws down, positive after a fall
  assert.equal(S.ulcerIndex(line, 14)[59], 0);
  assert.ok(S.ulcerIndex([...line, ...Array.from({ length: 20 }, (_, j) => 168 - 3 * j)], 14).at(-1) > 0);
});
