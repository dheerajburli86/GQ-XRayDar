import test from "node:test";
import assert from "node:assert/strict";
import { periodKey, normaliseTf, tfLabel, ANALYST_TFS } from "../engine/calendar.js";
import { aggregate, rsi } from "../engine/indicators.js";
import { buildAnalystColumn, analystRows, analystDate } from "../engine/analyst.js";

const days = (from, n) => { const out = []; let t = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10)); while (out.length < n) { const d = new Date(t); if (d.getUTCDay() % 6) out.push(d.toISOString().slice(0, 10)); t += 86400000; } return out; };

test("timeframes: n-month and n-week grids, spellings and labels", () => {
  assert.equal(periodKey("2026-11-13", "2M"), "2026-11-2M");
  assert.equal(periodKey("2026-12-31", "2M"), "2026-11-2M");
  assert.equal(periodKey("2026-11-13", "5M"), "2026-09-5M");     // grid from Jan 2000
  assert.equal(periodKey("1995-03-01", "5M"), "1995-01-5M");     // before 2000 too
  assert.equal(periodKey("2026-11-13", "24M"), "2026-01-24M");   // 2-year: even years
  assert.equal(periodKey("2025-06-30", "24M"), "2024-01-24M");
  assert.equal(periodKey("2026-11-13", "2W"), periodKey("2026-11-03", "2W"));
  assert.notEqual(periodKey("2026-11-13", "2W"), periodKey("2026-11-16", "2W"));
  assert.equal(normaliseTf("3M"), "Q"); assert.equal(normaliseTf("6m"), "H"); assert.equal(normaliseTf("9 months"), "N");
  assert.equal(normaliseTf("12M"), "Y"); assert.equal(normaliseTf("2Y"), "24M"); assert.equal(normaliseTf("13w"), "13W");
  assert.equal(normaliseTf("3D"), null); assert.equal(normaliseTf("0M"), null); assert.equal(normaliseTf("abc"), null);
  assert.equal(tfLabel("24M"), "2-year"); assert.equal(tfLabel("7M"), "7-month"); assert.equal(tfLabel("Q"), "Quarterly");
  for (const t of ["2M", "4M", "5M", "7M", "8M", "10M", "11M", "24M"]) assert.ok(ANALYST_TFS.includes(t));
});

test("n-month candles: OHLC of the block", () => {
  const time = days("2024-01-01", 400), close = time.map((_, i) => 100 + i);
  const b = aggregate({ time, open: close, high: close.map((c) => c + 1), low: close.map((c) => c - 1), close, volume: close.map(() => 1) }, "5M");
  // the 5-month block holding January 2024 is Oct 2023 - Feb 2024 on the grid from January 2000
  assert.equal(b.key[0], "2023-10-5M");
  assert.equal(b.open[0], 100);
  assert.ok(b.time[0] >= "2024-02-01" && b.time[0] < "2024-03-01"); // stamped with its LAST session
  assert.equal(b.key[1], "2024-03-5M");
});

test("Analyst screens: rows, nested RSI, header", () => {
  const time = days("2018-01-01", 1500);
  const close = time.map((_, i) => 100 * Math.exp(0.0004 * i + 0.05 * Math.sin(i / 17)));
  const bars = { time, open: close, high: close, low: close, close };
  const bench = { time, close: time.map((_, i) => 50 * Math.exp(0.0002 * i)) };
  assert.equal(analystRows("RSIMMA").length, 4);
  assert.equal(analystRows("RSCACC").length, 5);
  const c = buildAnalystColumn({ mode: "RSIMMA", tf: "W", bars });
  const w = aggregate({ ...bars, volume: close.map(() => 0) }, "W");
  assert.deepEqual(c.rows[2].base, rsi(rsi(w.close)));
  assert.equal(c.rows[0].avgs.length, 12);
  assert.equal(c.header.close, w.close.at(-1));
  assert.ok(Math.abs(c.header.chg - (w.close.at(-1) / w.close.at(-2) - 1)) < 1e-12);
  const r = buildAnalystColumn({ mode: "RSCACC", tf: "M", bars, bench, benchLabel: "BSE500" });
  assert.equal(r.rows.length, 5);
  assert.equal(r.rows[1].label, "RSC vs BSE500");
  assert.deepEqual(r.rows[1].avgs.map((a) => a.period), [4, 14, 26, 39]);
  assert.match(r.rows[4].label, /^RSI 14M of RSI of RSI of RSC/);
  const noBench = buildAnalystColumn({ mode: "RSCMMA", tf: "D", bars });
  assert.equal(noBench.rows[1].missing, "no comparison series");
  assert.equal(analystDate("2026-11-13"), "13-Nov-2026");
});

test("start date anchors multi-month candles; To cuts the data", () => {
  // 5-month blocks from March 2021: Mar-Jul 2021, Aug-Dec 2021, Jan-May 2022 ...
  assert.equal(periodKey("2021-03-01", "5M", "2021-03-15"), "2021-03-5M");
  assert.equal(periodKey("2021-07-30", "5M", "2021-03-15"), "2021-03-5M");
  assert.equal(periodKey("2021-08-02", "5M", "2021-03-15"), "2021-08-5M");
  assert.equal(periodKey("2021-02-26", "5M", "2021-03-15"), "2020-10-5M"); // before the anchor: blocks run backwards too
  // quarters anchored on February: Feb-Apr, May-Jul ...
  assert.equal(periodKey("2024-04-30", "Q", "2024-02-01"), periodKey("2024-02-01", "Q", "2024-02-01"));
  assert.notEqual(periodKey("2024-05-02", "Q", "2024-02-01"), periodKey("2024-04-30", "Q", "2024-02-01"));
  // D / W / M ignore the anchor
  assert.equal(periodKey("2024-04-30", "M", "2024-02-11"), "2024-04");
  // 3-week blocks from the anchor's Monday
  assert.equal(periodKey("2024-01-24", "3W", "2024-01-10"), "2024-01-08-3W");
  assert.equal(periodKey("2024-01-29", "3W", "2024-01-10"), "2024-01-29-3W");

  const time = [], close = [];
  for (let t = Date.UTC(2020, 0, 1); t <= Date.UTC(2023, 11, 31); t += 86400000) {
    const d = new Date(t); if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    time.push(d.toISOString().slice(0, 10)); close.push(100 + time.length * 0.1);
  }
  const bars = { time, open: close, high: close, low: close, close };
  const col = buildAnalystColumn({ mode: "RSIMMA", tf: "5M", bars, to: "2022-09-15", anchor: "2021-03-01" });
  assert.equal(col.header.date, "2022-09-15");            // the last candle stops at To
  assert.ok(col.rows[0].time.includes("2021-07-30"));     // Mar-Jul 2021 candle ends on its last session
});
