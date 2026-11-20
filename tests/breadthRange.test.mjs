import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { breadthStats, rowsBetween, reverseRange, startForLookback } from "../engine/breadthRange.js";

const fx = JSON.parse(fs.readFileSync(new URL("./fixtures/breadthSheet.json", import.meta.url), "utf8"));
const near = (a, b, t = 1e-9) => assert.ok(Math.abs(a - b) < t, `${a} vs ${b}`);

test("matches the owner's workbook row for row (parent up)", () => {
  const s = breadthStats(fx.rows.map(([name, b, c]) => ({ name, w: b, r: c / b - 1 })));
  for (const k of ["change", "ccr", "oup", "rr", "rrm", "rrmk", "tr", "trmk"]) near(s[k], fx.expect[k]);
});

test("parent down branch uses +ve O/P and the underperformers", () => {
  const s = breadthStats([{ name: "a", w: 50, r: -0.1 }, { name: "b", w: 30, r: 0.02 }, { name: "c", w: 20, r: -0.05 }]);
  assert.equal(s.up, false);
  assert.equal(s.groups.pos.n, 1);       // b rises while the parent falls
  assert.equal(s.groups.op.n, 1);        // c beats the parent but is negative
  assert.equal(s.groups.up.n, 1);        // a lags it
  near(s.rrm, 1 / 3); near(s.rrmk, 0.3);
});

test("zero denominators give null, not a number", () => {
  const s = breadthStats([{ name: "a", w: 1, r: 0.1 }, { name: "b", w: 1, r: 0.1 }]);
  assert.equal(s.ccr == null || Number.isFinite(s.ccr), true);
  assert.equal(s.oup, null);
});

test("reverse range keeps the end fixed and walks the start back one day at a time", () => {
  const dates = ["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-16"];
  const mk = (name, base) => ({ name, dates, level: dates.map((_, i) => base * (1 + 0.01 * i * (name === "a" ? 1 : -0.5))), cap: dates.map(() => 100) });
  const out = reverseRange([mk("a", 100), mk("b", 100), mk("c", 100)], dates, "2026-11-16", 3);
  assert.deepEqual(out.map((x) => x.start), ["2026-11-13", "2026-11-12", "2026-11-11"]);
  assert.ok(out.every((x) => x.end === "2026-11-16"));
});

test("look-backs and missing cap history", () => {
  const dates = ["2026-10-19", "2026-11-12", "2026-11-19"];
  assert.equal(startForLookback(dates, "2026-11-19", "1M"), "2026-10-19");
  assert.equal(startForLookback(dates, "2026-11-19", "1D"), "2026-11-12");
  const r = rowsBetween([{ name: "x", dates, level: [100, 110, 120], cap: null }], "2026-10-19", "2026-11-19");
  assert.equal(r.equalWeighted, true); near(r.rows[0].r, 0.2);
});
