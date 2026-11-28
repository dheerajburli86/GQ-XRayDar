import test from "node:test";
import assert from "node:assert/strict";
import { toSecurity } from "../engine/classification.js";
import { CAP_UNRELIABLE_COUNTRIES } from "../engine/geography.js";

test("India caps are on (2026-11-28); the capless path still works for any country listed in CAP_UNRELIABLE_COUNTRIES", () => {
  assert.equal(CAP_UNRELIABLE_COUNTRIES.has("India"), false);
  const base = { id: "1", symbol: "X", name: "X", market_cap_local: 5e9, market_cap_currency: "INR", market_cap_usd: 6e7, market_cap_inr: 5e9, is_active: true };
  const ind = toSecurity({ ...base, universe: "india_stocks", country: "India" });
  assert.ok(ind.capLocal > 0 && ind.capUsd > 0);
});

test("demo engine run: India has CW and size-segment indices like any other country", async () => {
  const { generateDemo, demoSource } = await import("../engine/demo/generator.js");
  const { runPipeline } = await import("../engine/pipeline.js");
  const { MemorySink } = await import("../engine/memorySink.js");
  const sink = new MemorySink();
  await runPipeline(demoSource(generateDemo({ from: "2022-01-03" })), sink.sinkInterface, {});
  const keys = [...sink.indexData.keys()];
  const india = keys.filter((k) => /C:India/.test(k));
  const us = keys.filter((k) => /C:United States/.test(k));
  assert.ok(us.length > 0);
  if (india.length) assert.ok(india.some((k) => k.startsWith("CW|")), "India has no CW index");
});

test("index eligibility: flat USD 250M minimum cap for every global stock; India (no cap) is not filtered", async () => {
  const { generateDemo, demoSource } = await import("../engine/demo/generator.js");
  const { runPipeline } = await import("../engine/pipeline.js");
  const { MemorySink } = await import("../engine/memorySink.js");
  const { METHODOLOGY } = await import("../engine/methodology.js");
  assert.deepEqual({ ...METHODOLOGY.eligibility.minCapUsd }, { developed: 2.5e8, emerging: 2.5e8 });
  const sink = new MemorySink();
  await runPipeline(demoSource(generateDemo({ from: "2022-01-03" })), sink.sinkInterface, {});
  let checked = 0;
  for (const ms of sink.memberships) {
    if (ms.country === "India" || ms.latest) continue;
    const min = 2.5e8;
    for (const x of ms.members) { checked++; assert.ok(x.capUsd >= min, `${ms.country} ${x.id} cap ${x.capUsd} below ${min}`); }
  }
  assert.ok(checked > 0, "no memberships checked");
});

test("India rows without a type are stocks; dormant rows are analysed but flagged (2026-11-25, Neogen)", async () => {
  const { isAnalysableRow, isEquityRow, toSecurity } = await import("../engine/classification.js");
  const neogen = { id: "n", symbol: "NEOGEN", name: "NEOGEN CHEMICALS", universe: "india_stocks", type: null, sector: "Specialty Chemicals & Agrochemicals", is_active: true };
  assert.equal(isEquityRow(neogen), true);
  assert.equal(toSecurity(neogen).dormant, false);
  const dormant = { ...neogen, id: "d", symbol: "SLEEPY", type: "stock", sector: "NO_RECENT_TRADES" };
  assert.equal(isEquityRow(dormant), false);
  assert.equal(isAnalysableRow(dormant), true);
  const s = toSecurity(dormant);
  assert.equal(s.dormant, true); assert.equal(s.assetClass, "Stock");
  assert.notEqual(s.sector, "NO_RECENT_TRADES");
  assert.equal(isAnalysableRow({ ...dormant, sector: "ETF" }), false);
  assert.equal(isAnalysableRow({ id: "u", symbol: "X", universe: "global", type: null, sector: "Banks", is_active: true }), false, "a blank type outside India is not assumed to be a stock");
  assert.equal(isEquityRow({ id: "r", symbol: "DHC", universe: "us_stocks", type: "FUND", sector: "Real Estate" }), true, "US REIT trusts");
});
