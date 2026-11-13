import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateRule, ruleHistory, RULES, describeRule } from "../engine/rules.js";
import { heikinAshi, renko, kagi, pointFigure, volumeProfile, supportResistance } from "../engine/chartTools.js";
import { candlePatternsAt } from "../engine/candles.js";

const days = (n) => Array.from({ length: n }, (_, i) => new Date(Date.UTC(2024, 0, 1) + i * 86400000).toISOString().slice(0, 10));
const bars = (closes) => { const t = days(closes.length); return { time: t, open: closes.map((c, i) => (i ? closes[i - 1] : c)), high: closes.map((c, i) => Math.max(c, i ? closes[i - 1] : c) + 0.5), low: closes.map((c, i) => Math.min(c, i ? closes[i - 1] : c) - 0.5), close: closes, volume: closes.map(() => 100) }; };

test("all 17 alert rules exist and fire only on an edge", () => {
  assert.equal(Object.keys(RULES).length, 17);
  const up = [...Array.from({ length: 60 }, () => 100), 101];
  const r = evaluateRule("price_above", { price: 100.5 }, bars(up), "D");
  assert.equal(r.fired, true);
  const r2 = evaluateRule("price_above", { price: 50 }, bars(up), "D");
  assert.equal(r2.fired, false, "already above: no edge, no alert");
  assert.equal(describeRule("rsi_cross_below", {}), "RSI(14) falls below 30");
  const h = ruleHistory("new_high_n", { bars: 5 }, bars([...Array(10).fill(1), 2, 2, 2, 3]), "D");
  assert.deepEqual(h.map((x) => x.index), [10, 13]);
});

test("chart transforms", () => {
  const b = bars(Array.from({ length: 120 }, (_, i) => 100 + 10 * Math.sin(i / 8) + i * 0.1));
  const ha = heikinAshi(b);
  assert.ok(Math.abs(ha.close[5] - (b.open[5] + b.high[5] + b.low[5] + b.close[5]) / 4) < 1e-9);
  const rk = renko(b, 2);
  for (let i = 1; i < rk.bricks.length; i++) assert.ok(Math.abs(Math.abs(rk.bricks[i].close - rk.bricks[i].open) - 2) < 1e-9);
  const kg = kagi(b, 4); assert.ok(kg.length > 3);
  const pf = pointFigure(b, 2, 3); assert.ok(pf.cols.length > 2); assert.ok(pf.cols.every((c, i) => i === 0 || c.kind !== pf.cols[i - 1].kind));
  const vp = volumeProfile(b, { bins: 10 }); assert.equal(vp.bins.length, 10);
  assert.ok(Math.abs(vp.bins.reduce((a, x) => a + x.volume, 0) - 120 * 100) < 1e-6, "every unit of volume lands in one band");
  assert.ok(Array.isArray(supportResistance(b)));
});

test("bullish engulfing after a decline", () => {
  const closes = [20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9.5, 9];
  const b = bars(closes);
  const i = closes.length;
  b.time.push("2024-02-01"); b.open.push(8.8); b.close.push(10); b.high.push(10.1); b.low.push(8.7); b.volume.push(100);
  b.open[i - 1] = 9.6; b.close[i - 1] = 9;
  assert.ok(candlePatternsAt(b, i).includes("bullish_engulfing"));
});
