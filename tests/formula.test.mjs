import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFormula, evalFormula, isCondition } from "../engine/formula.js";
import { ema } from "../engine/indicators.js";

const b = { time: [], open: [], high: [], low: [], close: [], volume: [] };
for (let i = 0; i < 60; i++) { const c = 100 + Math.sin(i / 4) * 10 + i * 0.2; b.time.push(String(i)); b.close.push(c); b.open.push(c - 0.5); b.high.push(c + 1); b.low.push(c - 1); b.volume.push(1000 + i); }

test("arithmetic, precedence and series", () => {
  assert.deepEqual(evalFormula("1 + 2 * 3", b).slice(0, 2), [7, 7]);
  assert.equal(evalFormula("(high - low) / 2", b)[5], 1);
  const d = evalFormula("ema(close, 10) - ema(close, 30)", b), e10 = ema(b.close, 10), e30 = ema(b.close, 30);
  assert.ok(Math.abs(d[50] - (e10[50] - e30[50])) < 1e-12);
});
test("windows, references, crosses and conditions", () => {
  const hi = evalFormula("highest(high, 5)", b);
  assert.equal(hi[3], null); assert.equal(hi[10], Math.max(...b.high.slice(6, 11)));
  assert.equal(evalFormula("ref(close, 1)", b)[10], b.close[9]);
  const x = evalFormula("cross(close, ema(close, 10))", b);
  assert.ok(x.some((v) => v === 1));
  assert.ok(isCondition("rsi(close, 14) > 60 and close > ema(close, 50)"));
  assert.ok(!isCondition("ema(close, 10)"));
  assert.deepEqual(evalFormula("close > 1000 ? 1 : -1", b).slice(0, 1), [-1]);
  assert.equal(evalFormula("not (close > 1000)", b)[0], 1);
});
test("errors are plain English and nothing outside the list is reachable", () => {
  assert.throws(() => parseFormula("ema(close)"), /takes 2/);
  assert.throws(() => parseFormula("window.alert(1)"), /Cannot read|Unknown/);
  assert.throws(() => parseFormula("constructor"), /Unknown name/);
  assert.throws(() => parseFormula("foo(close, 1)"), /Unknown function/);
  assert.throws(() => parseFormula("close +"), /ends too early/);
});
import { formulaFromText } from "../engine/formula.js";
test("indicator from a request: a formula as written, or a known description", () => {
  assert.equal(formulaFromText("create an indicator that is ema(close, 5) - ema(close, 20)").formula, "ema(close, 5) - ema(close, 20)");
  assert.equal(formulaFromText("create an indicator that shows the distance from the 50 day ema").formula, "(close / ema(close, 50) - 1) * 100");
  assert.equal(formulaFromText("indicator for a golden cross").formula, "cross(ema(close, 50), ema(close, 200))");
  assert.equal(formulaFromText("make me something nice"), null);
});
