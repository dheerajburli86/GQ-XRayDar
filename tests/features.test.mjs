import test from "node:test";
import assert from "node:assert/strict";
import { HIDDEN, isHidden } from "../src/lib/features.js";
import { barIndex, barInfo, dayName, dmy, rowBars } from "../src/lib/dataWindow.js";

test("hidden features carry a reason and only listed keys are hidden", () => {
  for (const [k, why] of Object.entries(HIDDEN)) assert.ok(why.length > 20, k);
  assert.equal(isHidden("dunusual"), true);
  assert.equal(isHidden("chart"), false);
  assert.equal(isHidden("toString"), false);
});
const bars = { time: ["2026-11-10", "2026-11-11", "2026-11-12"], open: [10, 11, 12], high: [11, 12, 13], low: [9, 10, 11], close: [10.5, 11.5, 12.5], volume: [100, 200, 300] };
test("barIndex picks the candle at or before the cursor, last when off the chart", () => {
  assert.equal(barIndex(bars, null), 2);
  assert.equal(barIndex(bars, "2026-11-11"), 1);
  assert.equal(barIndex(bars, "2026-11-11T05"), 1);
  assert.equal(barIndex(bars, "2026-01-01"), -1);
});
test("barInfo returns the real OHLCV and the change on the previous candle", () => {
  const i = barInfo(bars, 1);
  assert.deepEqual([i.open, i.high, i.low, i.close, i.volume], [11, 12, 10, 11.5, 200]);
  assert.ok(Math.abs(i.chg - (11.5 / 10.5 - 1) * 100) < 1e-9);
  assert.equal(barInfo(bars, 0).chg, null);
});
test("date helpers do not shift with the time zone", () => {
  assert.equal(dayName("2026-01-30"), "Friday"); // as in the Analyst data window
  assert.equal(dmy("2026-01-30"), "30/01/2026");
});
test("rowBars is stable per row", () => {
  const row = { time: bars.time, ohlc: bars };
  assert.equal(rowBars(row), rowBars(row));
  assert.equal(rowBars({ time: [], ohlc: bars }), null);
});
