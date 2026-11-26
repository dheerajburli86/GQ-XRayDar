import { test } from "node:test";
import assert from "node:assert/strict";
import { runExtra, toUsd } from "../cli/extraJob.mjs";
import { currencyPairs, crossRate } from "../engine/reference/extraInstruments.js";

test("currency pairs follow market quoting and rupee crosses are built from USD rates", () => {
  const p = currencyPairs(["EUR", "INR", "JPY", "USD"]);
  assert.ok(p.find((x) => x.label === "EUR/USD"));
  assert.ok(p.find((x) => x.label === "USD/INR"));
  assert.ok(p.find((x) => x.label === "100 JPY/INR"));
  // EUR = 1.10 USD, INR = 0.012 USD -> 91.67 INR per EUR
  assert.equal(Math.round(crossRate(1.1, 0.012) * 100) / 100, 91.67);
});

test("extra job: skips symbols FMP does not answer, writes pairs only from real fixings", async () => {
  const written = [], bars = new Map();
  const days = Array.from({ length: 30 }, (_, i) => `2026-01-${String(i + 1).padStart(2, "0")}`);
  const pool = { async query(sql, args) {
    if (sql.startsWith("select max(date)")) return { rows: [{ d: null }] };
    if (sql.startsWith("insert into tas_xasset_bars")) { for (const r of JSON.parse(args[0])) bars.set(`${r.symbol}|${r.date}`, r.close); return { rows: [] }; }
    if (sql.startsWith("select date::text d, close from tas_xasset_bars")) return { rows: [...bars].filter(([k]) => k.startsWith(args[0] + "|")).map(([k, c]) => ({ d: k.split("|")[1], close: c })) };
    if (sql.startsWith("select currency")) return { rows: [{ currency: "INR", d: days, rate: days.map(() => 0.012), stale: days.map((_, i) => (i === 3 ? 1 : 0)) }] };
    if (sql.includes("from instruments i join price_history")) return { rows: [] };
    if (sql.startsWith("insert into tas_extra_series")) { written.push({ symbol: args[0], dates: args[7], close: args[8] }); return { rows: [] }; }
    throw new Error(sql);
  } };
  const fetchImpl = async (url) => ({ ok: true, json: async () => (url.includes("STOXX50E") ? days.map((d, i) => ({ date: d, close: 4000 + i })) : []) });
  const r = await runExtra(pool, { fmpKey: "k", fetchImpl, log: () => {} });
  assert.ok(written.find((x) => x.symbol === "^STOXX50E"));
  assert.ok(r.missing.includes("^AEX"));
  const inr = written.find((x) => x.symbol === "FX:USDINR");
  assert.equal(inr.dates.length, 29); // the carried-forward day is left out
  assert.equal(Math.round(inr.close[0] * 100) / 100, 83.33);
});

test("USD version of a local index: close x USD per unit, short gaps carry the last rate, long gaps are dropped", () => {
  const dates = ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-20"];
  const fx = new Map([["2026-01-05", 0.2], ["2026-01-06", 0.25]]);
  const u = toUsd(dates, [100, 100, 100, 100], fx);
  assert.deepEqual(u.dates, ["2026-01-05", "2026-01-06", "2026-01-07"]);
  assert.deepEqual(u.close, [20, 25, 25]);
});
