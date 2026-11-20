import test from "node:test";
import assert from "node:assert/strict";
import { planBackfill } from "../scripts/lib/tickerReusePlan.mjs";

const iso = (n) => new Date(Date.UTC(2021, 0, 4 + n)).toISOString().slice(0, 10);
const mkBars = (rows) => ({ time: rows.map((r) => r[0]), open: rows.map((r) => r[1]), high: rows.map((r) => r[1]), low: rows.map((r) => r[1]), close: rows.map((r) => r[1]), volume: rows.map(() => 1) });
// stored: 30 bars of another company at ~14, then (after a 120-day gap) 40 bars of the real company at ~184
const stub = Array.from({ length: 30 }, (_, i) => [iso(i), 14]);
const real = Array.from({ length: 40 }, (_, i) => [iso(150 + i), 184 - i * 0.5]);
const stored = mkBars([...stub, ...real]);
const fmp = (from, to, f) => Array.from({ length: to - from }, (_, i) => ({ date: iso(from + i), open: f(i), high: f(i), low: f(i), close: f(i), volume: 5 })).reverse();

test("backfill plan: FMP history that joins the stored series replaces the previous holder's bars", () => {
  const rows = [...fmp(0, 149, (i) => 150 + i * 0.2), ...fmp(150, 190, (i) => 184 - i * 0.5)];
  const p = planBackfill(stored, rows);
  assert.equal(p.skip, undefined);
  assert.equal(p.breakDate, iso(150));
  assert.equal(p.insert.length, 149);
  assert.equal(p.storedBefore, 30);
  assert.ok(p.insert.every((r) => r.date < p.breakDate));
});

test("backfill plan: refuses FMP data that does not join, or that is too short", () => {
  assert.match(planBackfill(stored, fmp(0, 149, () => 14)).skip, /does not join/);
  assert.match(planBackfill(stored, fmp(0, 30, () => 180)).skip, /only 30 bars/);
  assert.match(planBackfill(stored, fmp(0, 100, () => 184)).skip, /more than 10 days/);
  assert.match(planBackfill(mkBars(stub), []).skip, /no ticker-reuse break/);
  // same level at the join but a different basis after the break
  const off = [...fmp(0, 149, () => 184), ...fmp(150, 190, (i) => (184 - i * 0.5) * 1.4)];
  assert.match(planBackfill(stored, off).skip, /differ/);
});
