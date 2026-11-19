import { test } from "node:test";
import assert from "node:assert/strict";
import { confluence, confluenceAcross } from "../engine/confluence.js";
import { importFormulas, exportFormulas } from "../engine/formula.js";

const bull = { mma: "bull", rsi: 62, macd: "bull", studies: { st: 1, sar: 1, cloud: "above", adx: 30, diBull: true, stochK: 70, stochD: 60, cmf: 12 } };

test("confluence counts every readable signal and shows its vote", () => {
  const c = confluence(bull);
  assert.equal(c.counted, 9); assert.equal(c.bull, 9); assert.equal(c.bear, 0);
  assert.equal(c.lean, "bullish"); assert.equal(c.strength, "strong");
  assert.ok(c.items.every((x) => x.why));
});
test("a signal that cannot be read is left out, not voted neutral", () => {
  const c = confluence({ mma: "bear", rsi: 40, macd: "bear", studies: { st: -1, sar: null } });
  assert.equal(c.counted, 4); assert.equal(c.bear, 4);
  assert.equal(confluence({ mma: "bull", rsi: 60 }).lean, "too few signals");
  assert.equal(confluence(null), null);
});
test("ADX below 20 abstains; RSI 45-55 and small money flow are neutral", () => {
  const c = confluence({ mma: "mixed", rsi: 50, macd: "bull", studies: { adx: 15, diBull: false, cmf: 2, st: 1 } });
  assert.equal(c.items.find((x) => x.key === "adx").vote, 0);
  assert.equal(c.items.find((x) => x.key === "rsi").vote, 0);
  assert.equal(c.items.find((x) => x.key === "cmf").vote, 0);
  assert.equal(c.net, 2);
});
test("a split reading is mixed / weak", () => {
  const c = confluence({ mma: "bull", rsi: 40, macd: "bull", studies: { st: -1, sar: -1 } });
  assert.equal(c.bull, 2); assert.equal(c.bear, 3); assert.equal(c.lean, "bearish"); assert.equal(c.strength, "moderate");
});
test("daily and weekly aligned only when both lean the same way", () => {
  assert.equal(confluenceAcross({ D: bull, W: bull }).aligned, true);
  assert.equal(confluenceAcross({ D: bull, W: { mma: "bear", rsi: 30, macd: "bear", studies: { st: -1, sar: -1 } } }).aligned, false);
  assert.match(confluenceAcross({ D: bull }).text, /not enough/);
});

test("import: lines 'name = formula', comments, and bad lines reported not run", () => {
  const r = importFormulas("# my set\nTrend gap = ema(close, 10) - ema(close, 30)\nGolden: cross(ema(close, 50), ema(close, 200))\n//skip\nstudy(\"x\"); plot(close)\nrsi(close, 14) > 60");
  assert.equal(r.items.length, 3);
  assert.equal(r.items[0].name, "Trend gap"); assert.equal(r.items[0].formula, "ema(close, 10) - ema(close, 30)");
  assert.equal(r.items[1].name, "Golden");
  assert.equal(r.items[2].name, "rsi(close, 14) > 60");
  assert.equal(r.errors.length, 1); assert.match(r.errors[0], /line 5/);
});
test("import: JSON round-trips and rejects unknown names; pane and colour are checked", () => {
  const list = [{ name: "A", formula: "sma(close, 20)", pane: "price", color: "#ff0000" }, { name: "B", formula: "constructor(close)", pane: "x", color: "red" }];
  const r = importFormulas(exportFormulas(list));
  assert.equal(r.items.length, 1); assert.equal(r.items[0].pane, "price"); assert.equal(r.items[0].color, "#ff0000");
  assert.equal(r.errors.length, 1);
  assert.equal(importFormulas("[oops").errors.length, 1);
});
test("import: Pine-style script text is never executed", () => {
  const r = importFormulas("//@version=5\nindicator(\"My\")\nplot(ta.sma(close, 20))");
  assert.equal(r.items.length, 0); assert.ok(r.errors.length >= 1);
});
