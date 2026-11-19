import test from "node:test";
import assert from "node:assert/strict";
import { mmaBreakouts, mmaBreakoutSummary, MIN_CANDLES } from "../engine/consolidation.js";
import { evaluate } from "./fixtures/consolidation/harness.mjs";

// The owner's 53 dated breakouts. Pinned so any change to the detector shows up here: if a change
// makes more of them match, update the list on purpose; if fewer, the change is a regression.
const EXPECTED_HITS = [
  "HFCL RSIMMA M 2021-01", "HFCL RSIMMA Q 2020-12", "HFCL RSIMMA D 2026-04-09", "HFCL RSIMMA W 2026-04-10",
  "HFCL RSCMMA M 2021-02", "HFCL RSCMMA Q 2021-03", "HFCL RSCMMA D 2026-03-10", "HFCL RSCMMA W 2026-04-10",
  "GLENMARK RSIMMA M 2023-04-28", "GLENMARK RSIMMA Q 2023-06", "GLENMARK RSIMMA W 2025-06-13",
  "GLENMARK RSCMMA W 2023-03-24", "GLENMARK RSCMMA W 2025-06-06",
  "SANSERA RSIMMA W 2023-05-12", "SANSERA RSIMMA M 2023-05", "SANSERA RSIMMA W 2025-09-12",
  "SANSERA RSCMMA W 2023-06-02", "SANSERA RSCMMA M 2024-05", "SANSERA RSCMMA D 2025-09-05", "SANSERA RSCMMA W 2025-09-12", "SANSERA RSCMMA M 2025-09",
  "DELL RSIMMA W 2023-04-28", "DELL RSIMMA M 2023-05", "DELL RSIMMA Q 2023-06", "DELL RSIMMA D 2026-02-27", "DELL RSIMMA W 2026-02-27", "DELL RSIMMA M 2026-02",
  "DELL RSCMMA W 2023-08-11", "DELL RSCMMA M 2023-08", "DELL RSCMMA Q 2023-06", "DELL RSCMMA D 2026-02-27", "DELL RSCMMA W 2026-02-27", "DELL RSCMMA M 2026-02", "DELL RSCMMA Q 2026-03",
  "NVDA RSIMMA M 2013-09", "NVDA RSIMMA Q 2013-12", "NVDA RSCMMA M 2015-08",
  "KOSPI_USD RSIMMA W 2025-05-23", "KOSPI_USD RSIMMA M 2025-06", "KOSPI_USD RSIMMA Q 2025-06", "KOSPI_USD RSCMMA W 2025-06-13",
  "TAIWAN_USD RSIMMA W 2023-11-24", "TAIWAN_USD RSIMMA M 2023-12",
];

test("owner's dated breakouts: 43 of 53 found within the tolerance, far above chance", () => {
  const r = evaluate();
  assert.equal(r.scored, 53);
  const hits = r.rows.filter((x) => x.hit).map((x) => `${x.stock} ${x.screen} ${x.tf} ${x.end}`);
  assert.deepEqual(hits, EXPECTED_HITS);
  // a date picked at random would land near an event about a quarter of the time
  assert.ok(r.chance < 0.35, `chance level ${r.chance}`);
});

test("owner's 'trend continued' windows: the known false alarms are Glenmark monthly only", () => {
  const fired = evaluate().negatives.filter((n) => n.fired.length).map((n) => `${n.stock} ${n.screen} ${n.tf}`);
  assert.deepEqual(fired, ["GLENMARK RSIMMA M", "GLENMARK RSCMMA M"]);
});

const months = (n, from = 2000) => Array.from({ length: n }, (_, i) => `${from + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-28`);

test("a flat series never fans, so it never breaks out", () => {
  const time = months(120), values = time.map(() => 100);
  const r = mmaBreakouts(time, values);
  assert.equal(r.events.length, 0);
  assert.equal(r.state.fan, 0);
});

test("fall, base, rise: one breakout after the base, start inside the base", () => {
  const time = months(160), values = [];
  for (let i = 0; i < 160; i++) values.push(i < 60 ? 200 * Math.exp(-0.02 * i) : i < 110 ? 200 * Math.exp(-1.2) * (1 + 0.01 * Math.sin(i)) : 200 * Math.exp(-1.2 + 0.03 * (i - 110)));
  const r = mmaBreakouts(time, values);
  const ups = r.events.filter((e) => e.dir === "up");
  assert.equal(ups.length, 1);
  assert.ok(ups[0].endIdx > 110 && ups[0].endIdx < 125, `breakout at ${ups[0].endIdx}`);
  assert.ok(ups[0].startIdx >= 55 && ups[0].startIdx <= ups[0].endIdx, `start at ${ups[0].startIdx}`);
  assert.equal(ups[0].turn, true);
  const s = mmaBreakoutSummary(time, values, "M");
  assert.equal(s.state, "fan_up");
  assert.equal(s.up.end, ups[0].end);
});

test("the mirror gives a breakdown", () => {
  const time = months(160), values = [];
  for (let i = 0; i < 160; i++) values.push(i < 60 ? 50 * Math.exp(0.02 * i) : i < 110 ? 50 * Math.exp(1.2) * (1 + 0.01 * Math.sin(i)) : 50 * Math.exp(1.2 - 0.03 * (i - 110)));
  const r = mmaBreakouts(time, values);
  const downs = r.events.filter((e) => e.dir === "down");
  assert.equal(downs.length, 1);
  assert.ok(downs[0].endIdx > 110 && downs[0].endIdx < 125);
  assert.equal(mmaBreakoutSummary(time, values, "M").state, "fan_down");
});

test("bad input never throws: nulls, zeros, negatives, short and mismatched arrays", () => {
  const time = months(40);
  const values = time.map((_, i) => (i % 7 === 0 ? null : i % 11 === 0 ? 0 : i % 13 === 0 ? -5 : 100 + i));
  assert.doesNotThrow(() => mmaBreakouts(time, values));
  assert.doesNotThrow(() => mmaBreakouts(time.slice(0, 5), values));
  assert.doesNotThrow(() => mmaBreakouts([], []));
  assert.equal(mmaBreakouts([], []).state.since, null);
  assert.doesNotThrow(() => mmaBreakoutSummary(time, values.slice(0, 10), "W"));
});

test("no event before MIN_CANDLES candles", () => {
  const time = months(40), values = time.map((_, i) => 100 * Math.exp(0.05 * i));
  for (const e of mmaBreakouts(time, values).events) assert.ok(e.endIdx >= MIN_CANDLES);
});
