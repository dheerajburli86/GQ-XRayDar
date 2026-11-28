import { test } from "node:test";
import assert from "node:assert/strict";
import { effectiveScope, capless } from "../src/lib/scope.js";

// Alok Sir's Grok bot: Scanners, market India, Size = Large -> "0 in scope" (India has no cap segment).
test("a size filter is kept for India now that India has caps (2026-11-28)", () => {
  assert.equal(effectiveScope({ cap: "Large", sector: "Financials" }, "India").cap, "Large");
  assert.equal(effectiveScope({ cap: "Large", country: "India" }).cap, "Large");
  assert.equal(effectiveScope({ cap: "Large", region: "India" }).cap, "Large");
  assert.equal(effectiveScope({ cap: "Large" }, "US").cap, "Large");
  assert.equal(effectiveScope({ cap: "Large" }, "all").cap, "Large");
  assert.equal(effectiveScope({ cap: "Large", sector: "Financials" }, "India").sector, "Financials");
  assert.equal(capless({}, "Global"), false);
});
