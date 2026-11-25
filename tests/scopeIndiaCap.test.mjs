import { test } from "node:test";
import assert from "node:assert/strict";
import { effectiveScope, capless } from "../src/lib/scope.js";

// Alok Sir's Grok bot: Scanners, market India, Size = Large -> "0 in scope" (India has no cap segment).
test("a size filter is dropped for India, kept elsewhere", () => {
  assert.equal(effectiveScope({ cap: "Large", sector: "Financials" }, "India").cap, null);
  assert.equal(effectiveScope({ cap: "Large", country: "India" }).cap, null);
  assert.equal(effectiveScope({ cap: "Large", region: "India" }).cap, null);
  assert.equal(effectiveScope({ cap: "Large" }, "US").cap, "Large");
  assert.equal(effectiveScope({ cap: "Large" }, "all").cap, "Large");
  assert.equal(effectiveScope({ cap: "Large", sector: "Financials" }, "India").sector, "Financials");
  assert.equal(capless({}, "Global"), false);
});
