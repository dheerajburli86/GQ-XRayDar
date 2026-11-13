import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCommand } from "../engine/nl.js";

const secs = [{ id: "1", symbol: "IT", name: "Gartner Inc" }, { id: "2", symbol: "RELIANCE", name: "Reliance Industries" }];

test("the spec's example query", () => {
  const q = parseCommand("Show strongest weekly IT stocks with improving relative strength", { securities: secs });
  assert.equal(q.intent, "screen");
  assert.equal(q.tf, "W");
  assert.equal(q.scope.sector, "Information Technology");
  assert.deepEqual(q.conditions, [{ field: "rscRising_country_W", op: "is true" }]);
  assert.equal(q.sort.dir, "desc");
  assert.equal(q.securityId, null, "IT is a sector here, not a ticker");
});

test("geography, cap, numeric thresholds", () => {
  const q = parseCommand("top 20 large cap indian banks near 52 week high with rsi below 70");
  assert.equal(q.scope.country, "India"); assert.equal(q.scope.cap, "Large"); assert.equal(q.scope.industryGroup, "Banks"); // the finer GICS level wins
  assert.equal(q.limit, 20);
  assert.ok(q.conditions.some((c) => c.field === "nearHigh52"));
  assert.ok(q.conditions.some((c) => c.field === "rsiW" && c.op === "<" && c.value === 70));
});

test("security questions and chart commands", () => {
  assert.equal(parseCommand("explain RELIANCE", { securities: secs }).intent, "explain");
  const c = parseCommand("open RELIANCE rscacc", { securities: secs });
  assert.equal(c.intent, "chart"); assert.equal(c.page, "screens/RSCACC");
  assert.equal(parseCommand("which sectors are leading in europe").intent, "rotation");
  assert.equal(parseCommand("go to weight watcher").page, "ww");
  assert.equal(parseCommand("dark mode").theme, "dark");
});
