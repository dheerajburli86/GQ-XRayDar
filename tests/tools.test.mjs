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

import { evaluateAlerts as evalAlerts2 } from "../engine/alerts.js";
import { lineValueAt } from "../engine/fields.js";
test("alerts: OR rules, price-level and drawn-line conditions, one-time keys", () => {
  const row = { sec: { id: "x", symbol: "X", name: "X" }, flat: { close: 105, asOf: "2026-01-11", mmaBullW: false } };
  const lvl = { id: "r1", enabled: true, template: "custom", universe: { ids: ["x"] }, conditions: [{ kind: "level", price: 100, side: "above" }] };
  assert.equal(evalAlerts2([lvl], [row]).length, 1);
  assert.equal(evalAlerts2([{ ...lvl, conditions: [{ kind: "level", price: 110, side: "above" }] }], [row]).length, 0);
  // line through 100 on 1 Jan and 110 on 21 Jan: 105 on 11 Jan
  assert.equal(lineValueAt({ time: "2026-01-01", price: 100 }, { time: "2026-01-21", price: 110 }, "2026-01-11"), 105);
  const line = { ...lvl, conditions: [{ kind: "line", a: { time: "2026-01-01", price: 90 }, b: { time: "2026-01-21", price: 110 }, side: "above" }] };
  assert.equal(evalAlerts2([line], [row]).length, 1); // line is at 100 on 11 Jan
  const any = { ...lvl, match: "any", conditions: [{ field: "mmaBullW", op: "is true" }, { kind: "level", price: 100, side: "above" }] };
  assert.equal(evalAlerts2([any], [row]).length, 1);
  assert.equal(evalAlerts2([{ ...any, match: "all" }], [row]).length, 0);
  assert.ok(evalAlerts2([{ ...lvl, once: true }], [row])[0].key.endsWith("|once"));
  assert.equal(evalAlerts2([lvl], [{ ...row, sec: { ...row.sec, id: "y" } }]).length, 0); // other instrument
});

import { valueArea, tpoProfiles } from "../engine/chartTools.js";
test("value area covers 70% of volume around the point of control; TPO from candles", () => {
  const vp = { bins: [1, 2, 10, 20, 10, 2, 1].map((v, i) => ({ lo: i, hi: i + 1, volume: v })), poc: null };
  vp.poc = vp.bins[3];
  const va = valueArea(vp);
  assert.equal(va.val, 2); assert.equal(va.vah, 5); assert.ok(va.share >= 0.7);
  const b = { time: ["2026-01-05", "2026-01-06", "2026-01-07", "2026-02-02"], open: [10, 10, 10, 20], high: [12, 11, 11, 21], low: [10, 9, 10, 19], close: [11, 10, 10.5, 20] };
  const t = tpoProfiles(b, { block: "M", rows: 3 });
  assert.equal(t.length, 2); assert.equal(t[0].periods, 3);
  assert.ok(t[0].rows.some((r) => r.letters === "ABC"));
  assert.ok(t[0].poc >= 10 && t[0].poc <= 11);
});
