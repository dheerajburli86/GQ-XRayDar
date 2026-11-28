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

test("daily option: the average of daily returns, base 100", () => {
  const a = mk("2026-01-01", 5, (i) => 100 * 1.01 ** i), b = mk("2026-01-01", 5, (i) => 50 * 0.99 ** i);
  const r = composeEqualWeight([a, b], { startShare: 1, rebalance: "daily" });
  assert.equal(r.close[0], 100);
  assert.ok(Math.abs(r.close[1] - 100) < 1e-9);          // +1% and -1% average to 0
  assert.ok(Math.abs(r.close.at(-1) - 100) < 1e-6);
});

test("monthly rebalance: weights drift inside a month and reset on the first session of the next", () => {
  const a = mk("2026-01-01", 62, (i) => 100 * 1.01 ** i), b = mk("2026-01-01", 62, (i) => 50 * 0.99 ** i);
  const r = composeEqualWeight([a, b], { startShare: 1 });
  const at = (d) => r.close[r.dates.indexOf(d)];
  assert.equal(r.close[0], 100);
  // the set starts on 2 Jan (first day with returns); inside January it is buy-and-hold of 50 / 50, 29 days later on 31 Jan
  assert.ok(Math.abs(at("2026-01-31") - (50 * 1.01 ** 29 + 50 * 0.99 ** 29)) < 1e-9);
  // 1 Feb (i = 31): reset to equal weights at the 31 Jan level, then both move one day
  const jan = at("2026-01-31"), feb1 = jan / 2 * 1.01 + jan / 2 * 0.99;
  assert.ok(Math.abs(at("2026-02-01") - feb1) < 1e-9);
  // differs from a daily-rebalanced set (which stays flat here)
  const d = composeEqualWeight([a, b], { startShare: 1, rebalance: "daily" });
  assert.ok(Math.abs(d.close.at(-1) - 100) < 1e-6 && Math.abs(r.close.at(-1) - 100) > 0.01);
});

test("monthly rebalance: a member that appears mid-month joins at the next month, a stale one drops out", () => {
  const a = mk("2026-01-01", 70, () => 100), b = mk("2026-01-11", 60, (i) => 10 * 1.02 ** i);
  const r = composeEqualWeight([a, b], { startShare: 0.5 });
  assert.ok(Math.abs(r.close[r.dates.indexOf("2026-01-31")] - 100) < 1e-9, "b has zero weight in January");
  assert.ok(r.close.at(-1) > 100.5, "b carries weight from 1 Feb");
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
