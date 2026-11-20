import { test } from "node:test";
import assert from "node:assert/strict";
import { removeBadPrints, shareBreaks, cutAtTickerReuse } from "../engine/quality.js";
import { computeWeightWatcher } from "../engine/weightWatcher.js";

const mk = (c) => ({ time: c.map((_, i) => `2021-01-${String(i + 1).padStart(2, "0")}`), open: [...c], high: [...c], low: [...c], close: [...c], volume: c.map(() => 1) });

test("bad prints: a run that jumps and comes straight back is dropped (Quality Houses, 31 Dec 2021)", () => {
  const r = removeBadPrints(mk([2.2, 2.26, 899101, 882900.98, 2.28, 2.32]));
  assert.deepEqual(r.removed.map((x) => x.close), [899101, 882900.98]);
  assert.deepEqual(r.bars.close, [2.2, 2.26, 2.28, 2.32]);
  assert.equal(r.bars.time.length, 4);
});
test("bad prints: alternating x2 prints are dropped, a real move is kept", () => {
  assert.deepEqual(removeBadPrints(mk([11, 11.2, 24, 11.27, 12])).removed.map((x) => x.close), [24]);
  // doubled and stayed: a real move
  assert.equal(removeBadPrints(mk([10, 20, 21, 22, 21, 23, 24])).removed.length, 0);
  // doubled, then came part of the way back: kept
  assert.equal(removeBadPrints(mk([10, 20, 15, 12, 10.5, 10])).removed.length, 0);
});
test("bad prints: a JSE holiday bar carrying the US ADR price (x0.001) is dropped, even if the next day moved 20%", () => {
  const r = removeBadPrints(mk([66354, 66100, 41.1, 66200, 66400]));
  assert.deepEqual(r.removed.map((x) => x.close), [41.1]);
  assert.deepEqual(r.bars.close, [66354, 66100, 66200, 66400]);
  assert.deepEqual(removeBadPrints(mk([43499, 43300, 9.85, 9.9, 43100, 43200])).bars.close, [43499, 43300, 43100, 43200]);
  assert.deepEqual(removeBadPrints(mk([100, 101, 5, 120, 121])).bars.close, [100, 101, 120, 121]);
  // a real crash that stays down is kept
  assert.equal(removeBadPrints(mk([100, 101, 5, 5.2, 5.1, 5])).removed.length, 0);
});
test("share-count breaks: a x3 step inside 10 sessions that holds marks where caps start", () => {
  const c = [937, 900, 512, 270, 260, ...Array(30).fill(240), 201, 35, 40, 17, 14, ...Array(30).fill(13)];
  const r = shareBreaks(mk(c.slice(0, 31)));
  assert.equal(r.breaks.length, 1);
  assert.ok(shareBreaks({ time: c.map((_, i) => `d${String(i).padStart(3, "0")}`), close: c }).from > 35);
  // a 40% fall is not a share event
  assert.equal(shareBreaks(mk([100, 60, ...Array(25).fill(60)])).breaks.length, 0);
  // a x3 move that reverses is not either
  assert.equal(shareBreaks(mk([10, 10, 31, 30, 12, 10, ...Array(25).fill(10)])).breaks.length, 0);
});
test("weight watcher: dates where a big country had too few stocks are left empty", () => {
  const mem = (country, date, n, cap, latest = false) => ({ country, date, latest, members: Array.from({ length: n }, (_, i) => ({ id: `${country}${i}`, sector: "S", ig: "I", seg: "Large", capUsd: cap })) });
  const ms = [mem("US", "2015-03-31", 1, 1000), mem("JP", "2015-03-31", 10, 10),
    mem("US", "2015-06-30", 10, 10), mem("JP", "2015-06-30", 10, 10),
    mem("US", "2015-09-30", 10, 10), mem("JP", "2015-09-30", 10, 10)];
  const geo = { US: { region: "US", classification: "DM" }, JP: { region: "Asia", classification: "DM" } };
  const g = computeWeightWatcher(ms, geo).find((x) => x.parentKey === "G" && x.childType === "country");
  const us = g.children.find((c) => c.key === "US");
  assert.equal(us.weights[0], null);
  assert.equal(us.weights[1], 50);
  assert.deepEqual(g.gaps, [{ date: "2015-03-31", countries: ["US"] }]);
  assert.ok(computeWeightWatcher(ms, geo).some((x) => x.parentKey === "G" && x.childType === "industryGroup"));
});

test("ticker reuse: bars of the previous holder of a ticker are cut at the gap + level change", () => {
  const day = (i) => new Date(Date.UTC(2022, 0, 3 + i)).toISOString().slice(0, 10);
  const old = Array.from({ length: 30 }, (_, i) => ({ time: day(i), close: 14 + (i % 3) * 0.1 }));
  const fresh = Array.from({ length: 40 }, (_, i) => ({ time: day(30 + 14 + i), close: 184 - i * 0.5 })); // 14-day gap
  const rows = [...old, ...fresh];
  const bars = { time: rows.map((r) => r.time), open: rows.map((r) => r.close), high: rows.map((r) => r.close), low: rows.map((r) => r.close), close: rows.map((r) => r.close), volume: rows.map(() => 1) };
  const r = cutAtTickerReuse(bars);
  assert.equal(r.bars.close.length, 40);
  assert.equal(r.bars.time[0], day(44));
  assert.equal(r.cut.bars, 30);
  // no gap (an unadjusted split) or a small level change: untouched
  const noGap = { ...bars, time: rows.map((x, i) => day(i)) };
  assert.equal(cutAtTickerReuse(noGap).cut, null);
  const small = { ...bars, close: bars.close.map((x, i) => (i < 30 ? 100 : 130)) };
  assert.equal(cutAtTickerReuse(small).cut, null);
  // a short tail after the break is not trusted to be the "real" company
  const shortTail = { ...bars, time: bars.time.slice(0, 40), open: bars.open.slice(0, 40), high: bars.high.slice(0, 40), low: bars.low.slice(0, 40), close: bars.close.slice(0, 40), volume: bars.volume.slice(0, 40) };
  assert.equal(cutAtTickerReuse(shortTail).cut, null);
});
