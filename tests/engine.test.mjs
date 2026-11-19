import { test } from "node:test";
import assert from "node:assert/strict";
import { ema, rsi, nestedRsi, aggregate, rsc, rollingMax, rollingMin, mmaState, emaStrict } from "../engine/indicators.js";
import { periodKey, quarterEndIndices } from "../engine/calendar.js";
import { buildFxTable, majorCurrency } from "../engine/fx.js";
import { canonicalCountry, countryMeta } from "../engine/geography.js";
import { IndexBuilder, parseIndexKey, levelOf } from "../engine/indexEngine.js";
import { computeWeightWatcher, wwTrend } from "../engine/weightWatcher.js";
import { methodologyHash, METHODOLOGY } from "../engine/methodology.js";
import { applyCorporateActions } from "../engine/quality.js";
import { backtestEvents } from "../engine/backtest.js";
import { breadthDivergence } from "../engine/breadth.js";

const close = (a, b) => Math.abs(a - b) < 1e-9 * Math.max(1, Math.abs(b));

test("EMA matches pandas ewm(span, adjust=False)", () => {
  const e = ema([1, 2, 3, 4], 3); // alpha 0.5
  assert.deepEqual(e, [1, 1.5, 2.25, 3.125]);
  assert.equal(emaStrict([1, 2, 3, 4], 3)[1], null);
  assert.equal(emaStrict([1, 2, 3, 4], 3)[2], 2.25);
});

test("EMA and RSI start at the first real value of a series with leading nulls", () => {
  const e = ema([null, null, 2, 4], 3);
  assert.deepEqual(e, [null, null, 2, 3]);
  const xs = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 3) * 5 + i * 0.1);
  const r1 = rsi(xs, 14), r2 = nestedRsi(xs, 2, 14);
  assert.equal(r1[13], null); assert.ok(r1[14] > 0);
  const firstR2 = r2.findIndex((v) => v != null);
  assert.equal(firstR2, 28); // RSI needs 14 changes; RSI-of-RSI needs 14 more
});

test("house RSI: all gains -> 100, flat -> 50", () => {
  assert.equal(rsi(Array.from({ length: 20 }, (_, i) => i + 1), 14).at(-1), 100);
  assert.equal(rsi(Array.from({ length: 20 }, () => 5), 14).at(-1), 50);
});

test("rolling max/min deque equals brute force", () => {
  const xs = Array.from({ length: 300 }, (_, i) => Math.sin(i * 0.37) * 10 + (i % 7));
  const mx = rollingMax(xs, 20), mn = rollingMin(xs, 20);
  for (let i = 0; i < xs.length; i++) {
    const w = xs.slice(Math.max(0, i - 19), i + 1);
    assert.equal(mx[i], Math.max(...w)); assert.equal(mn[i], Math.min(...w));
  }
});

test("weekly aggregation stamps the candle with its last session and true weekly EMA", () => {
  const b = { time: ["2026-11-02", "2026-11-03", "2026-11-06", "2026-11-09", "2026-11-13"], open: [1, 2, 3, 4, 5], high: [2, 3, 4, 5, 6], low: [0, 1, 2, 3, 4], close: [1.5, 2.5, 3.5, 4.5, 5.5], volume: [1, 1, 1, 1, 1] };
  const w = aggregate(b, "W");
  assert.deepEqual(w.time, ["2026-11-06", "2026-11-13"]);
  assert.deepEqual(w.close, [3.5, 5.5]);
  assert.deepEqual(w.high, [4, 6]); assert.deepEqual(w.low, [0, 3]); assert.deepEqual(w.volume, [3, 2]);
  assert.equal(periodKey("2026-11-15", "W"), "2026-11-09"); // Sunday belongs to the week starting Monday 9th
  assert.equal(periodKey("2026-11-13", "Q"), "2026-Q4");
});

test("RSC joins on the candle key and rebases to 100", () => {
  const t = ["2026-01-05", "2026-01-06", "2026-01-07"];
  const r = rsc(t, [10, 11, 12], t, [100, 100, 120], "D");
  assert.deepEqual(r.value.map((v) => +v.toFixed(6)), [100, 110, 100]);
});

test("MMA bullish alignment requires fan order and separation", () => {
  const S = [[6], [5.9], [5.8]], L = [[5], [4.9]];
  assert.equal(mmaState(S, L, 0).bull, true);
  assert.equal(mmaState([[6], [6.1]], L, 0).bull, false); // short group not fanned
});

test("quarter ends exclude the running quarter", () => {
  const d = ["2026-03-30", "2026-03-31", "2026-04-01", "2026-06-30"];
  assert.deepEqual(quarterEndIndices(d), [1]);
});

test("FX: minor units use the major rate / 100; gaps carry forward flagged stale", () => {
  assert.deepEqual(majorCurrency("GBX"), { major: "GBP", divisor: 100 });
  const dates = ["2026-01-01", "2026-01-02", "2026-01-05", "2026-01-06"];
  const fx = buildFxTable(dates, { GBP: { dates: ["2026-01-01", "2026-01-05"], usd: [1.3, 1.4] } });
  assert.deepEqual(Array.from(fx("GBP").rate), [1.3, 1.3, 1.4, 1.4]);
  assert.deepEqual(Array.from(fx("GBP").stale), [0, 1, 0, 1]);
  assert.ok(close(fx("GBX").rate[0], 0.013));
  const est = buildFxTable(dates, {}, { JPY: 0.0065 })("JPY");
  assert.equal(est.estimated, true); assert.equal(est.source, "latest_constant");
});

test("country names are canonicalised and regions derived, not read", () => {
  assert.equal(canonicalCountry("Hong_kong"), "Hong Kong");
  assert.equal(canonicalCountry("United_kingdom"), "United Kingdom");
  assert.equal(countryMeta("India").classification, "Emerging Markets");
  assert.equal(countryMeta("United States").region, "US");
  assert.equal(countryMeta("Atlantis").assigned, false);
});

// ── index engine: exact CW / EW maths and FX conversion ───────────────────────
function tinyUniverse() {
  const dates = ["2026-03-30", "2026-03-31", "2026-04-01", "2026-04-02", "2026-04-03", "2026-06-30", "2026-07-01", "2026-07-02"];
  const T = dates.length;
  const mk = (id, closes, cap, sector = "Financials", ccy = "EUR", last = T - 1) => {
    const close = Float64Array.from(closes), traded = new Uint8Array(T).fill(1);
    return { sec: { id, sector, industryGroup: "Banks", currency: ccy, capLocal: cap, capCurrency: ccy === "GBX" ? "GBP" : ccy, active: true }, first: 0, last, close, traded };
  };
  return { dates, mk };
}

test("CW and EW returns are exact, and the USD index = local relatives x FX relatives", () => {
  const { dates, mk } = tinyUniverse();
  const stocks = [mk("a", [10, 10, 11, 12, 12, 13, 13, 14], 100), mk("b", [20, 20, 20, 18, 18, 18, 19, 19], 300), mk("c", [5, 5, 5.5, 5.5, 6, 6, 6, 6], 50)];
  const fx = buildFxTable(dates, { EUR: { dates, usd: [1.1, 1.1, 1.12, 1.1, 1.08, 1.1, 1.11, 1.1] } });
  const m = { ...METHODOLOGY, eligibility: { ...METHODOLOGY.eligibility, minListingDays: 0, minCapUsd: { developed: 0, emerging: 0 } }, capBreakpoints: { large: 0.7, mid: 0.85, small: 1.01 } };
  const b = new IndexBuilder({ dates, rebalanceIdx: [1, 5], fx, methodology: m });
  b.addCountry("Germany", "EUR", stocks, "Europe", "European Developed Markets");
  const cwL = b.series.get("CW|LCL|C:Germany"), cwU = b.series.get("CW|USD|C:Germany"), ewL = b.series.get("EW|LCL|C:Germany");
  // shares are latest cap / latest close: a=100/14, b=300/19, c=50/6
  const sh = { a: 100 / 14, b: 300 / 19, c: 50 / 6 };
  const capAt = (t) => sh.a * stocks[0].close[t] + sh.b * stocks[1].close[t] + sh.c * stocks[2].close[t];
  assert.ok(close(cwL.values[4] / cwL.values[1], capAt(4) / capAt(1)), "CW = cap ratio within a period");
  const ew = (t0, t1) => stocks.reduce((s, x) => s + x.close[t1] / x.close[t0], 0) / 3;
  assert.ok(close(ewL.values[5] / ewL.values[1], ew(1, 5)), "EW = mean price relative within a period");
  for (let t = 2; t < dates.length; t++) {
    const fxRel = fx("EUR").rate[t] / fx("EUR").rate[t - 1];
    assert.ok(close((1 + cwU.rets[t]), (1 + cwL.rets[t]) * fxRel), `USD = local x FX at ${dates[t]}`);
  }
  b.finish();
  const g = b.series.get("CW|USD|G");
  assert.ok(close(g.values.at(-1), cwU.values.at(-1)), "a one-country global index equals the country USD index");
  assert.equal(levelOf("C:Germany|S:Financials|K:Large"), "1");
  assert.equal(parseIndexKey("CW|USD|R:Asia|S:Energy").sector, "Energy");
});

test("a delisted constituent leaves on its last bar; survivors carry the index", () => {
  const { dates, mk } = tinyUniverse();
  const T = dates.length;
  const s1 = mk("a", [10, 10, 10, 10, 10, 10, 10, 10], 100);
  const s2 = mk("b", [10, 10, 10, 10, 10, 10, 10, 10], 100, "Financials", "EUR", 3);
  for (let t = 4; t < T; t++) s2.close[t] = 10; // forward-filled after its last bar
  const fx = buildFxTable(dates, {}, { EUR: 1.1 });
  const m = { ...METHODOLOGY, eligibility: { ...METHODOLOGY.eligibility, minListingDays: 0, minCapUsd: { developed: 0, emerging: 0 } }, capBreakpoints: { large: 0.7, mid: 0.85, small: 1.01 } };
  const b = new IndexBuilder({ dates, rebalanceIdx: [1, 5], fx, methodology: m });
  b.addCountry("Germany", "EUR", [s1, s2], "Europe", "European Developed Markets");
  const cw = b.series.get("CW|LCL|C:Germany");
  assert.equal(cw.n[3], 2); assert.equal(cw.n[4], 1);
  assert.ok(close(cw.values.at(-1), 1000));
});

test("Weight Watcher weights sum to 100 within every parent and date", () => {
  const ms = [
    { country: "India", date: "2026-03-31", latest: false, members: [{ id: "x", sector: "IT", ig: "Software", seg: "Large", capUsd: 300 }, { id: "y", sector: "IT", ig: "Software", seg: "Mid", capUsd: 100 }, { id: "z", sector: "Energy", ig: "Energy", seg: "Large", capUsd: 600 }] },
    { country: "Japan", date: "2026-03-31", latest: false, members: [{ id: "j", sector: "IT", ig: "Software", seg: "Large", capUsd: 1000 }] },
  ];
  const ww = computeWeightWatcher(ms, { India: countryMeta("India"), Japan: countryMeta("Japan") });
  for (const g of ww) {
    const s = g.children.reduce((a, c) => a + (c.weights[0] || 0), 0);
    assert.ok(Math.abs(s - 100) < 1e-6, `${g.parentKey}/${g.childType} sums to ${s}`);
  }
  const it = ww.find((g) => g.parentKey === "C:India|S:IT");
  assert.equal(it.children.find((c) => c.key === "x").weights[0], 75);
});

test("WW turning points", () => {
  assert.equal(wwTrend([5, 4.8, 4.5, 4.2, 4.0, 3.9, 4.3]).trend, "turn_up_from_low");
  assert.equal(wwTrend([3, 3.2, 3.5, 3.8, 4.0, 4.3, 4.1]).trend, "turn_down_from_high");
  assert.equal(wwTrend([4, 4.01, 4.02, 4.0, 4.01, 4.0]).trend, "sideways");
});

test("corporate actions divide prior prices by the factor", () => {
  const b = { time: ["a", "b", "c"], open: [20, 20, 10], high: [20, 20, 10], low: [20, 20, 10], close: [20, 20, 10], volume: [1, 1, 2] };
  const { bars } = applyCorporateActions(b, [{ exDate: "c", factor: 2 }]);
  assert.deepEqual(bars.close, [10, 10, 10]); assert.deepEqual(bars.volume, [2, 2, 2]);
});

test("backtest statistics", () => {
  const ev = [1, 2, -1, 4].map((r) => ({ type: "x", fwd: { "1M": r }, excess: { "1M": r - 1 } }));
  const r = backtestEvents(ev, "x");
  assert.equal(r["1M"].n, 4); assert.equal(r["1M"].hitRate, 75); assert.equal(r["1M"].mean, 1.5);
});

test("breadth divergence flags a rising index with falling participation", () => {
  const dates = Array.from({ length: 30 }, (_, i) => `2026-01-${String(i + 1).padStart(2, "0")}`);
  const idx = { dates, level: dates.map((_, i) => 100 + i * 0.5) };
  const br = { dates, pct50: dates.map((_, i) => 70 - i), adLine: dates.map((_, i) => -i), newHigh: dates.map(() => 0), newLow: dates.map(() => 2) };
  const d = breadthDivergence(idx, br);
  assert.equal(d.flag, true); assert.ok(d.reasons.length >= 2);
});

test("methodology hash is stable and changes with the rules", () => {
  assert.equal(methodologyHash(), methodologyHash({ ...METHODOLOGY }));
  assert.notEqual(methodologyHash(), methodologyHash({ ...METHODOLOGY, baseLevel: 100 }));
});

import { isSplitLike } from "../engine/indexEngine.js";
test("split guard recognises split ratios and ignores ordinary moves", () => {
  const g = METHODOLOGY.splitGuard;
  assert.equal(isSplitLike(0.5, g), true);
  assert.equal(isSplitLike(0.2, g), true);
  assert.equal(isSplitLike(10.1, g), true);
  assert.equal(isSplitLike(0.62, g), false);   // a 38% fall is a market move
  assert.equal(isSplitLike(0.45, g), false);   // not near any split factor
  assert.equal(isSplitLike(1.05, g), false);
});
