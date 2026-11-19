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
