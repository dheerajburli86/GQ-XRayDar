import test from "node:test";
import assert from "node:assert/strict";
import { EXCHANGE_SETS, ETF_SETS } from "../engine/reference/indexSetsData.js";
import { indexSetDefs, classifyMember, LEAF, ALIAS } from "../engine/reference/indexSets.js";
import { composeEqualWeight, buildIndexSets } from "../engine/indexSets.js";

const mk = (start, n, f) => { const dates = [], close = []; for (let i = 0; i < n; i++) { dates.push(new Date(Date.parse(start) + i * 864e5).toISOString().slice(0, 10)); close.push(f(i)); } return { dates, close }; };

test("workbook: 16 exchange sets and 9 ETF sets, no repeated member inside a set", () => {
  assert.equal(EXCHANGE_SETS.length, 16); assert.equal(ETF_SETS.length, 9);
  for (const s of [...EXCHANGE_SETS, ...ETF_SETS]) assert.equal(new Set(s.members).size, s.members.length, s.code);
  assert.equal(new Set(indexSetDefs().map((d) => d.symbol)).size, 25);
});

test("every exchange-sheet member is a set, an alias, or a known leaf; ETF members are tickers", () => {
  const defs = indexSetDefs();
  const byCode = new Map([["exchange", new Map()], ["etf", new Map()]]);
  for (const d of defs) byCode.get(d.sheet).set(d.code, d);
  for (const d of defs) for (const raw of d.members) {
    const c = classifyMember(d, raw, byCode);
    if (d.sheet === "exchange" && c.kind === "leaf") assert.ok(!c.unknown, `${d.code}: ${raw} is not mapped`);
  }
  assert.equal(ALIAS.NGASS, "NGAS");
});

test("equal-weight composite: the average of daily returns, base 100", () => {
  const a = mk("2026-01-01", 5, (i) => 100 * 1.01 ** i), b = mk("2026-01-01", 5, (i) => 50 * 0.99 ** i);
  const r = composeEqualWeight([a, b], { startShare: 1 });
  assert.equal(r.close[0], 100);
  assert.ok(Math.abs(r.close[1] - 100) < 1e-9);          // +1% and -1% average to 0
  assert.ok(Math.abs(r.close.at(-1) - 100) < 1e-6);
});

test("a late-starting member joins without a jump; a stale one drops out", () => {
  const a = mk("2026-01-01", 30, () => 100), b = mk("2026-01-11", 20, () => 10);
  const r = composeEqualWeight([a, b], { startShare: 0.5 });
  assert.ok(r.close.every((v) => Math.abs(v - 100) < 1e-9));
  const c = mk("2026-01-01", 5, () => 10);                // stops after 5 days, a keeps going
  const r2 = composeEqualWeight([a, c]);
  assert.equal(r2.count.at(-1), 1);
});

test("build: missing members are reported, duplicates counted once, nested sets use the inner level", async () => {
  const load = async (c) => (c.via === "x" && c.sym !== "USD:^AEX" ? { ...mk("2026-01-01", 60, (i) => 100 + i), symbol: c.sym } : c.via === "etf" ? { ...mk("2026-01-01", 60, (i) => 20 + i), symbol: `etf:${c.sym}` } : null);
  const out = await buildIndexSets(load);
  const by = Object.fromEntries(out.map((o) => [o.def.code, o]));
  const mid = by.FGMEAST;
  assert.ok(mid.members.some((m) => m.raw === "KUWAIT" && m.status === "missing"));
  assert.ok(mid.members.some((m) => m.raw === "QATAR" && m.status === "proxy"));
  assert.ok(by.FGAFRICA.series, "South Africa alone still builds a set");
  assert.ok(by.FGCMDTY2.series && by.FGCMDTY2.members.find((m) => m.raw === "FGAGRI").status === "ok");
  assert.ok(by["FGALLEQUITY2$"].members.find((m) => m.raw === "AEX$").status === "missing");
  assert.ok(by.ETFEQ.members.find((m) => m.raw === "VNM").status === "ok");
});
