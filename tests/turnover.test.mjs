import test from "node:test";
import assert from "node:assert/strict";
import { turnoverUsd, secRankCmp, rankedByTurnover } from "../engine/turnover.js";
import { searchInstruments, INDIA_PROXY_LABEL } from "../src/lib/instruments.js";
import { countryFamily } from "../engine/geography.js";

test("turnover is the median of close x volume x fx over the last sessions, null when too thin", () => {
  const close = Array(80).fill(10), vol = Array(80).fill(100);
  vol[79] = 1e9; // one spike must not move a median
  assert.equal(turnoverUsd(close, vol, Array(80).fill(0.5)), 500);
  assert.equal(turnoverUsd(close.slice(0, 10), vol.slice(0, 10), null), null);
  assert.equal(turnoverUsd(close, null, null), null);
});

test("ranking: capped stocks by cap first, uncapped by turnover; a pure uncapped list says so", () => {
  const a = { capUsdNow: 5e9 }, b = { capUsdNow: 1e9 }, c = { turnoverUsd: 3e6 }, d = { turnoverUsd: 9e6 };
  assert.deepEqual([c, b, d, a].sort(secRankCmp), [a, b, d, c]);
  assert.equal(rankedByTurnover([c, d]), true);
  assert.equal(rankedByTurnover([a, d]), false);
});

test("India benchmark family is equal-weight, others cap-weighted; Nifty 500 proxy is searchable and labelled", () => {
  assert.equal(countryFamily("India"), "EW");
  assert.equal(countryFamily("Japan"), "CW");
  const d = { secs: [{ id: "n5", symbol: "NIFTY 500", name: "Nifty 500", country: "India", assetClass: "Index" }], indices: [] };
  const hit = searchInstruments(d, [], "india cw", "Indices").find((x) => x.label === INDIA_PROXY_LABEL);
  assert.ok(hit && hit.kind === "sec" && hit.id === "n5");
  assert.ok(/not a house/.test(hit.sub));
});
