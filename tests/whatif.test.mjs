import test from "node:test";
import assert from "node:assert/strict";
import { applyWhatIf, nextWeekday } from "../engine/whatif.js";
import { buildAnalystColumn } from "../engine/analyst.js";

const mk = (n) => { const time = [], c = []; let d = "2026-01-05"; for (let i = 0; i < n; i++) { time.push(d); c.push(100 + i * 0.5 + (i % 3)); d = nextWeekday(d); } return { time, open: c, high: c.map((x) => x + 1), low: c.map((x) => x - 1), close: c, volume: c.map(() => 10) }; };

test("nextWeekday skips the weekend", () => { assert.equal(nextWeekday("2026-11-20"), "2026-11-23"); assert.equal(nextWeekday("2026-11-19"), "2026-11-20"); });
test("a price on the last date replaces that close and keeps the candle coherent", () => {
  const b = mk(30), last = b.time.at(-1);
  const r = applyWhatIf(b, [{ date: last, close: 500 }]);
  assert.equal(r.bars.time.length, 30); assert.equal(r.bars.close.at(-1), 500); assert.equal(r.bars.high.at(-1), 500);
  assert.equal(b.close.at(-1) === 500, false, "input untouched");
});
test("a later date appends a candle; an earlier date is ignored", () => {
  const b = mk(30), last = b.time.at(-1), nx = nextWeekday(last);
  const r = applyWhatIf(b, [{ date: nx, close: 90 }, { date: b.time[3], close: 1 }]);
  assert.equal(r.bars.time.length, 31); assert.equal(r.bars.open.at(-1), b.close.at(-1)); assert.equal(r.bars.low.at(-1), 90);
  assert.equal(r.ignored.length, 1);
});
test("rsc closes move with the same percentage", () => {
  const b = mk(30), a = b.close.map((x) => x * 2);
  const r = applyWhatIf(b, [{ date: b.time.at(-1), close: b.close.at(-1) * 1.1 }], a);
  assert.ok(Math.abs(r.rscCloses.at(-1) / a.at(-1) - 1.1) < 1e-9);
});
test("a big drop lowers the daily RSI", () => {
  const b = mk(60), col = (x) => buildAnalystColumn({ mode: "RSIMMA", tf: "D", bars: x }).rows[1].base.at(-1);
  const r = applyWhatIf(b, [{ date: nextWeekday(b.time.at(-1)), close: 60 }]);
  assert.ok(col(r.bars) < col(b));
});
