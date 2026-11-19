import { test } from "node:test";
import assert from "node:assert/strict";
import { computeProjection, addSessions } from "../engine/projection.js";
import { seasonality } from "../engine/seasonality.js";

const mk = (closes, start = "2025-01-01") => {
  const b = { time: [], open: [], high: [], low: [], close: [] };
  const d = new Date(`${start}T00:00:00Z`);
  for (const c of closes) { while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1); b.time.push(d.toISOString().slice(0, 10)); b.close.push(c); b.open.push(c); b.high.push(c + 1); b.low.push(c - 1); d.setUTCDate(d.getUTCDate() + 1); }
  return b;
};

test("future sessions skip weekends", () => { assert.equal(addSessions("2026-11-13", 1), "2026-11-16"); });
test("target projection: triggered on the first candle meeting the condition, path ends on the target", () => {
  const b = mk([...Array(40).fill(100), 101, 102, 103, 104, 105]);
  const r = computeProjection(b, { condition: "close > 102", side: "up", target: { kind: "price", value: 120 }, horizon: 10, since: b.time[0] });
  assert.equal(r.status, "active"); assert.equal(r.start.time, b.time[42]);
  assert.equal(r.path.at(-1).value, 120); assert.ok(r.path.at(-1).future);
  const reached = computeProjection(b, { condition: "close > 102", side: "up", target: { kind: "price", value: 104.5 }, horizon: 10, since: b.time[0] });
  assert.equal(reached.status, "reached");
  const dead = computeProjection(mk([...Array(40).fill(100), 103, 99, 98]), { condition: "close > 102", side: "up", target: { kind: "pct", value: 5 }, invalidate: 100, since: "2025-01-01" });
  assert.equal(dead.status, "invalidated");
});
test("no target: ATR fallback is labelled; pending when the condition never held", () => {
  const b = mk(Array.from({ length: 60 }, (_, i) => 100 + i * 0.1));
  const r = computeProjection(b, { condition: "close > 1000", side: "up", method: "atr", horizon: 5 });
  assert.equal(r.status, "pending"); assert.match(r.methodNote, /ATR/); assert.ok(r.target > b.close.at(-1));
});
test("historical analogue averages the paths after past signals", () => {
  // a saw-tooth: every 10 candles the close jumps above 105 then drifts up
  const c = []; for (let k = 0; k < 20; k++) for (let j = 0; j < 10; j++) c.push(100 + j);
  const r = computeProjection(mk(c), { condition: "close > 105", side: "up", method: "analogue", horizon: 3 });
  assert.equal(r.method, "analogue"); assert.ok(r.stats.cases >= 3);
});
test("seasonality: weekday and month statistics", () => {
  const b = mk(Array.from({ length: 600 }, (_, i) => 100 * 1.001 ** i), "2023-01-02");
  const s = seasonality(b.time, b.close);
  assert.equal(s.dayOfWeek.length, 5); assert.ok(s.dayOfWeek.every((x) => x.up === 1));
  assert.ok(s.monthOfYear[5].n >= 1 && s.monthOfYear[5].avg > 0);
  assert.ok(s.years >= 1 && s.path.length === 253);
});
import { parseProjectionText } from "../engine/projection.js";
test("projection from a sentence (owner's example)", () => {
  const r = parseProjectionText("Project price to 2450 if weekly RSC turns up and price breaks 2380");
  assert.equal(r.spec.target.value, 2450); assert.equal(r.tf, "W");
  assert.match(r.spec.condition, /close > 2380/); assert.match(r.spec.condition, /rsc > ref\(rsc, 1\)/);
  const d = parseProjectionText("down 8% if close falls below 410, invalid above 432, 30 candles");
  assert.equal(d.spec.side, "down"); assert.equal(d.spec.target.kind, "pct"); assert.equal(d.spec.invalidate, 432); assert.equal(d.spec.horizon, 30);
  assert.equal(d.spec.condition, "close < 410");
});
import { paperStats } from "../engine/paperStats.js";
test("practice-trade stats: win rate, expectancy, drawdown, shorts", () => {
  const s = paperStats([
    { id: "a", side: "buy", qty: 10, price: 100 }, { id: "a", side: "sell", qty: 10, price: 110 },
    { id: "b", side: "buy", qty: 10, price: 50 }, { id: "b", side: "sell", qty: 5, price: 40 },
    { id: "c", side: "sell", qty: 2, price: 30 }, { id: "c", side: "buy", qty: 2, price: 20 },
  ]);
  assert.equal(s.n, 3); assert.equal(s.realised, 100 - 50 + 20);
  assert.equal(Math.round(s.winRate * 100), 67); assert.equal(s.maxDrawdown, -50);
  assert.deepEqual(s.open, [{ id: "b", qty: 5, avg: 50 }]);
});
