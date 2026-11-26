import test from "node:test";
import assert from "node:assert/strict";
import { glocomHistoryRows, toCsv, scopeParts } from "../engine/glocomExport.js";

const hist = { dates: ["2026-11-13", "2026-11-20"], of: [2, 2], groups: {
  "Banks, Trusts": { rank: [1, 2], code: [1, 3], label: ["US 80 80", "Neutral 40 60"], score: [90, 50], n: [6, 6], w: [0.05, 0.01], m6: [0.2, 0.1], y: [0.4, 0.3], pW: [1, 0.5], p6m: [1, 0.5], p1y: [1, 0.5] },
  Late: { rank: [null, 1], code: [null, 1], label: [null, "LTS 80"], score: [null, 80], n: [0, 5], w: [null, 0.02], m6: [null, 0.2], y: [null, 0.5], pW: [null, 1], p6m: [null, 1], p1y: [null, 1] } } };

test("one row per date and group, empty groups skipped", () => {
  const rows = glocomHistoryRows("C:India|industry", hist);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].market, "India"); assert.equal(rows[0].level, "industry");
  assert.equal(rows[2].band, "LTS 80");
});
test("global scope name and csv quoting", () => {
  assert.deepEqual(scopeParts("G|sector"), { market: "Global", level: "sector" });
  const csv = toCsv(glocomHistoryRows("G|industry", hist));
  assert.match(csv, /"Banks, Trusts"/);
  assert.equal(csv.split("\n")[0].split(",").length, 16);
});
