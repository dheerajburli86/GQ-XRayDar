import test from "node:test";
import assert from "node:assert/strict";
import { toSecurity } from "../engine/classification.js";
import { CAP_UNRELIABLE_COUNTRIES } from "../engine/geography.js";

test("India stocks carry no market cap, other countries keep theirs", () => {
  assert.ok(CAP_UNRELIABLE_COUNTRIES.has("India"));
  const base = { id: "1", symbol: "X", name: "X", market_cap_local: 5e9, market_cap_currency: "INR", market_cap_usd: 6e7, market_cap_inr: 5e9, is_active: true };
  const ind = toSecurity({ ...base, universe: "india_stocks", country: "India" });
  assert.equal(ind.capLocal, null); assert.equal(ind.capUsd, null); assert.equal(ind.capCurrency, null);
  const us = toSecurity({ ...base, universe: "us_stocks", country: "United States", market_cap_currency: "USD" });
  assert.ok(us.capLocal > 0 && us.capUsd > 0);
});

test("demo engine run: India joins no cap-based index and no Weight Watcher group, other countries still do", async () => {
  const { generateDemo, demoSource } = await import("../engine/demo/generator.js");
  const { runPipeline } = await import("../engine/pipeline.js");
  const { MemorySink } = await import("../engine/memorySink.js");
  const sink = new MemorySink();
  await runPipeline(demoSource(generateDemo({ from: "2022-01-03" })), sink.sinkInterface, {});
  const keys = [...sink.indexData.keys()];
  const india = keys.filter((k) => /C:India/.test(k));
  const us = keys.filter((k) => /C:United States/.test(k));
  assert.ok(us.length > 0, `expected US country indices among ${keys.length} keys`);
  assert.equal(india.length, 0, `India index keys remain: ${india.slice(0, 3)}`);
  assert.ok(!sink.ww.some((w) => /India/.test(JSON.stringify(w.key || w.parentKey || ""))), "India Weight Watcher rows remain");
  const indiaSecs = sink.securities.filter((x) => x.country === "India");
  assert.ok(indiaSecs.length > 0 && indiaSecs.every((x) => x.capUsdNow == null), "India securities still carry a cap");
});
