import { test } from "node:test";
import assert from "node:assert/strict";
import { farFromLatest, decideRepairs, applyPriceRepairs } from "../engine/quality.js";

const bars = (closes, start = 1) => ({ time: closes.map((_, i) => `2026-01-${String(start + i).padStart(2, "0")}`), open: [...closes], high: [...closes], low: [...closes], close: [...closes], volume: closes.map(() => 100) });

test("SRSN-style run: tiny stored prices are replaced from the provider, or dropped when the provider is also bad", () => {
  const b = bars([80, 0.0003, 0.0003, 0.0003, 2, 85]);
  const sus = farFromLatest(b);
  assert.deepEqual(sus.map((s) => s.date), ["2026-01-02", "2026-01-03", "2026-01-04"]);
  const prov = new Map([["2026-01-02", { open: 81, high: 82, low: 79, close: 81, volume: 5 }], ["2026-01-03", { open: 0.0003, high: 0.0003, low: 0.0003, close: 0.0003, volume: 0 }], ["2026-01-05", { open: 2, high: 2, low: 2, close: 2, volume: 1 }]]);
  const d = decideRepairs(sus, prov, 85);
  assert.deepEqual(d.map((x) => x.action), ["replace", "drop", "drop"]);
  const { bars: out, replaced, dropped } = applyPriceRepairs(b, d);
  assert.equal(replaced, 1); assert.equal(dropped, 2);
  assert.deepEqual(out.close, [80, 81, 2, 85]);
  assert.deepEqual(out.time, ["2026-01-01", "2026-01-02", "2026-01-05", "2026-01-06"]);
  assert.equal(out.high[1], 82);
});

test("a real crash the provider confirms is left alone", () => {
  const b = bars([500, 400, 300, 5]);
  const sus = farFromLatest(b);
  const prov = new Map(b.time.map((t, i) => [t, { close: b.close[i] }]));
  assert.ok(decideRepairs(sus, prov, 5).every((x) => x.action === "confirmed"));
  assert.equal(applyPriceRepairs(b, decideRepairs(sus, prov, 5)).bars, b);
});

test("similar industry names fold into one group", async () => {
  const { canonicalIndustryGroup } = await import("../engine/reference/industryAliases.js");
  assert.equal(canonicalIndustryGroup("Pharmaceuticals, Biotechnology & Medical Devices"), "Pharmaceuticals");
  assert.equal(canonicalIndustryGroup("Pharmaceuticals & Medical Products"), "Pharmaceuticals");
  assert.equal(canonicalIndustryGroup("Household & Personal Products"), "Household and Personal Products");
  assert.equal(canonicalIndustryGroup("Media & Entertainment"), "Media and Entertainment");
  assert.equal(canonicalIndustryGroup("Semiconductor Equipment & Materials"), "Semiconductor Equipment & Materials");
  assert.equal(canonicalIndustryGroup("Banks"), "Banks");
});
