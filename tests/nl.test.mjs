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

test("owner's screen question with typos: no ticker picked from a number, every condition read", () => {
  const secs = [{ symbol: "50", name: "Hong Kong Ferry Holdings Co. Ltd.", id: "x" }];
  const c = parseCommand("give me list of US listed stocks with markt cap above $10B and Fundmental score above 50, Technical score also above 60", { securities: secs, countries: ["United States", "Hong Kong"] });
  assert.equal(c.intent, "screen");
  assert.equal(c.securityId, null);
  assert.equal(c.scope.country, "United States");
  assert.equal(c.scope.assetClass, "Stock");
  assert.deepEqual(c.conditions, [
    { field: "capUsd", op: ">", value: 1e10 },
    { field: "score_fundamentals", op: ">", value: 50 },
    { field: "score_technical", op: ">", value: 60 },
  ]);
  const r = parseCommand("US stocks mcap > 5bn with 3m return above 20%", { securities: [], countries: ["United States"] });
  assert.deepEqual(r.conditions, [{ field: "capUsd", op: ">", value: 5e9 }, { field: "ret3M", op: ">", value: 20 }]);
});

test("ranking by size: 'by / based on market cap', 'biggest', 'largest' sort by cap, not the AI score", () => {
  const p = (q) => parseCommand(q, { securities: [], countries: ["United States", "Japan"] });
  for (const q of ["list down the top 5 US stocks based on market cap", "What are the 5 biggest US stocks by market cap?", "largest 5 stocks in the United States"]) {
    const r = p(q);
    assert.deepEqual(r.sort, { field: "capUsd", dir: "desc" }, q);
    assert.equal(r.limit, 5, q);
    assert.equal(r.scope.country, "United States", q);
  }
  assert.deepEqual(p("smallest US stocks by market cap").sort, { field: "capUsd", dir: "asc" });
  assert.deepEqual(p("top 10 US stocks by 1 month return").sort, { field: "ret1M", dir: "desc" });
  assert.equal(p("top 10 US stocks").sort.field, "score");
});
