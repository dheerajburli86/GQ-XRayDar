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

test("9-month and quarterly MMA fields exist with exact keys", () => {
  const keys = (Array.isArray(FIELDS) ? FIELDS : Object.values(FIELDS)).map((f) => f.key);
  for (const k of ["mmaN", "mmaBullN", "mmaBearN", "mmaQ", "mmaY", "rsiDivergenceN"]) assert.ok(keys.includes(k), k);
  assert.ok(keys.includes("subIndustry"));
});

import { toSecurity as toSec } from "../engine/classification.js";
import { usRuleFor, US_INDUSTRY_RULES } from "../engine/reference/usIndustryRules.js";

test("a US stock outside the workbook is placed by its FMP industry, workbook rows still win", () => {
  const base = { id: "x", universe: "us_stocks", country: "United States", currency: "USD" };
  const r = toSec({ ...base, symbol: "ZZZZ", name: "Z", fmp_industry: "Banks - Regional" });
  assert.equal(r.sector, "Financials"); assert.equal(r.classSource, "us_rule"); assert.ok(r.subIndustry);
  assert.equal(toSec({ ...base, symbol: "AAPL", name: "Apple", fmp_industry: "Banks - Regional" }).classSource, "us_workbook");
});
test("biotech splits on size; every rule has three non-empty levels", () => {
  assert.equal(usRuleFor("Biotechnology", 5e9)[2], "Commercial-Stage Biotech");
  assert.equal(usRuleFor("Biotechnology", 1e8)[2], "Clinical-Stage / Pre-Commercial Biotech");
  for (const [k, v] of Object.entries(US_INDUSTRY_RULES)) assert.ok(v.length === 3 && v.every(Boolean), k);
  assert.equal(usRuleFor("Shell Companies")[0], "Financials");
});

test("consolidation boxes exist for the RSIMMA and RSAACC panes and the hierarchy counts", () => {
  const keys = (Array.isArray(FIELDS) ? FIELDS : Object.values(FIELDS)).map((f) => f.key);
  for (const k of ["rsiBoxBreakoutW", "rsiRscBoxBreakoutM", "rsiRscBoxStateQ", "boxPrimaryBreakoutScreens", "boxPrimaryConsolidatingScreens"]) assert.ok(keys.includes(k), k);
});
