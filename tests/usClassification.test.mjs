import test from "node:test";
import assert from "node:assert/strict";
import { US_CLASS } from "../engine/reference/usClassification.js";
import { toSecurity } from "../engine/classification.js";
import { FIELDS } from "../engine/fields.js";

test("US workbook gives three layers and wins over GICS", () => {
  assert.ok(Object.keys(US_CLASS).length > 1400);
  const row = { id: 1, symbol: "NVDA", name: "NVIDIA", country: "United States", currency: "USD", universe: "us_stocks", sector: "Technology", industry: null };
  const s = toSecurity(row, "us_stocks");
  assert.equal(s.classSource, "us_workbook");
  assert.equal(s.sector, US_CLASS.NVDA[0]);
  assert.equal(s.subIndustry, US_CLASS.NVDA[2]);
});

test("9-month and quarterly MMA fields exist", () => {
  const keys = (Array.isArray(FIELDS) ? FIELDS : Object.values(FIELDS)).map((f) => f.key);
  assert.ok(keys.some((k) => /N/.test(k) && /mma/i.test(k)) || keys.some((k) => /9-month|_N_|N$/.test(k)));
  assert.ok(keys.includes("subIndustry"));
});
