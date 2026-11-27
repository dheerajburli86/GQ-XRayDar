import { test } from "node:test";
import assert from "node:assert/strict";
import { sliceRun, periodEnds, buildGrid, classifyAt, targetWeights, runPortfolio, stats, trailing, cagr, drawdown, annVol, normaliseWeights, hitRatio, PORTFOLIOS } from "../engine/glocomPortfolio.js";

const day = (i) => new Date(Date.UTC(2020, 0, 1) + i * 864e5).toISOString().slice(0, 10);
const days = (n) => Array.from({ length: n }, (_, i) => day(i)).filter((d) => ![0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay()));
// 12 members with distinct, steady drifts: member k grows k * 0.02% a day -> strict, stable ranking
function universe(n = 12, len = 1600) {
  const dates = days(len);
  return Array.from({ length: n }, (_, k) => { let p = 100; return { key: `m${k}`, label: `M${k}`, dates, close: dates.map(() => (p *= 1 + (k - 5) * 0.0004)) }; });
}

test("periodEnds picks the last session of each week and month", () => {
  const d = ["2024-01-01", "2024-01-02", "2024-01-05", "2024-01-08", "2024-01-31", "2024-02-01"];
  assert.deepEqual(periodEnds(d, "W").map((i) => d[i]), ["2024-01-05", "2024-01-08", "2024-02-01"]);
  assert.deepEqual(periodEnds(d, "M").map((i) => d[i]), ["2024-01-31", "2024-02-01"]);
});

test("buildGrid forward-fills a short gap but not past the stale limit", () => {
  const a = { dates: ["2024-01-01", "2024-01-02", "2024-02-20"], close: [1, 2, 3] };
  const b = { dates: ["2024-01-01", "2024-01-15", "2024-01-30", "2024-02-20"], close: [1, 1, 1, 1] };
  const { dates, px } = buildGrid([a, b], { stale: 10 });
  assert.equal(px[0][dates.indexOf("2024-01-02")], 2);
  assert.equal(px[0][dates.indexOf("2024-01-15")], null); // 13 days after its last bar
  assert.equal(px[0][dates.indexOf("2024-02-20")], 3);
});

test("classification uses only data up to the checkpoint (no look-ahead)", () => {
  const u = universe();
  const full = classifyAt(u, ["2022-06-30"]);
  const cut = u.map((s) => { const i = s.dates.findIndex((d) => d > "2022-06-30"); return { ...s, dates: s.dates.slice(0, i), close: s.close.slice(0, i) }; });
  assert.deepEqual(classifyAt(cut, ["2022-06-30"]), full);
  // a spike AFTER the checkpoint cannot change the rating at the checkpoint
  const spiked = u.map((s, k) => (k !== 0 ? s : { ...s, close: s.close.map((c, i) => (s.dates[i] > "2022-06-30" ? c * 50 : c)) }));
  assert.deepEqual(classifyAt(spiked, ["2022-06-30"]), full);
});

test("steadily outperforming members land in the strong categories, laggards in the weak ones", () => {
  const u = universe();
  const r = classifyAt(u, ["2023-01-31"])[0];
  assert.match(r[11], /US 80 80|LTS 80/);
  assert.match(r[0], /UW 30 30|LTW 30|UW 40 40|LTW 40/);
  assert.equal(classifyAt(u.slice(0, 5), ["2023-01-31"])[0].every((x) => x === null), true); // fewer than 8 peers: nobody is rated
});

test("targetWeights: equal across categories, then equal within; empty categories drop out", () => {
  const keys = ["a", "b", "c", "d", "e"];
  const rating = ["US 80 80", "US 80 80", "LTS 80", null, "Neutral 40 60"];
  const { w, cats } = targetWeights(rating, keys, ["US 80 80", "LTS 80", "US 60 60"]);
  assert.deepEqual(cats, { "US 80 80": 0.5, "LTS 80": 0.5 }); // US 60 60 is empty
  assert.equal(w[0], 0.25); assert.equal(w[1], 0.25); assert.equal(w[2], 0.5);
  const sum = Object.values(w).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-12);
});

test("targetWeights honours custom category and index weights and re-normalises", () => {
  const keys = ["a", "b", "c"];
  const rating = ["US 80 80", "US 80 80", "LTS 80"];
  const { w } = targetWeights(rating, keys, ["US 80 80", "LTS 80"], { catWeights: { "US 80 80": 75, "LTS 80": 25 }, idxWeights: { a: 3, b: 1 } });
  assert.ok(Math.abs(w[0] - 0.5625) < 1e-12 && Math.abs(w[1] - 0.1875) < 1e-12 && Math.abs(w[2] - 0.25) < 1e-12);
  // a zero custom weight on every live category falls back to equal rather than dividing by zero
  const z = targetWeights(rating, keys, ["US 80 80", "LTS 80"], { catWeights: { "US 80 80": 0, "LTS 80": 0 } });
  assert.ok(Math.abs(Object.values(z.w).reduce((a, b) => a + b, 0) - 1) < 1e-12);
  // nothing qualifies: empty
  assert.deepEqual(targetWeights([null, null], ["a", "b"], ["US 80 80"]).w, {});
});

test("runPortfolio: NAV starts at 1, follows the held members, costs reduce it", () => {
  const u = universe();
  const bench = { dates: u[0].dates, close: u[0].dates.map((_, i) => 100 * 1.0001 ** i) };
  const free = runPortfolio(u, bench, { freq: "W", categories: PORTFOLIOS.strong.categories, costBps: 0 });
  const costly = runPortfolio(u, bench, { freq: "W", categories: PORTFOLIOS.strong.categories, costBps: 50 });
  assert.ok(free.dates.length > 200);
  assert.ok(Math.abs(free.nav[0] - 1) < 1e-9);
  assert.equal(free.nav.length, free.dates.length);
  assert.equal(free.bench.length, free.dates.length);
  assert.ok(costly.nav.at(-1) < free.nav.at(-1));
  assert.ok(free.nav.at(-1) > 1.2, "winners compounding at ~0.2% a day must grow");
  assert.ok(free.holdings[0].members.length >= 1);
  // weights at each rebalance add to 1 (with any cash)
  for (const h of free.holdings) assert.ok(Math.abs(h.members.reduce((a, m) => a + m.w, 0) + h.cash - 1) < 1e-9);
});

test("a single-member universe of a category earns that member's return exactly (hand check, no costs)", () => {
  const dates = days(1600);
  const u = universe();
  // pin member 11 as the only strong one by giving it a big drift, everyone else flat-ish
  const flat = u.map((s, k) => (k === 11 ? { ...s, close: dates.map((_, i) => 100 * 1.001 ** i) } : { ...s, close: dates.map((_, i) => 100 * 1.00001 ** i) }));
  const r = runPortfolio(flat, null, { freq: "M", categories: ["US 80 80", "LTS 80"], costBps: 0 });
  const h0 = r.holdings[0];
  assert.deepEqual(h0.members.map((m) => m.key), ["m11"]);
  const i0 = dates.indexOf(r.dates[0]);
  // between the first two rebalances the portfolio is 100% m11
  const i1 = dates.indexOf(r.holdings[1].date);
  const navAt1 = r.nav[r.dates.indexOf(r.holdings[1].date)];
  assert.ok(Math.abs(navAt1 - flat[11].close[i1] / flat[11].close[i0]) < 1e-9);
});

test("weekly and monthly are separate runs on the same data", () => {
  const u = universe();
  const w = runPortfolio(u, null, { freq: "W", categories: PORTFOLIOS.strong.categories, costBps: 10 });
  const m = runPortfolio(u, null, { freq: "M", categories: PORTFOLIOS.strong.categories, costBps: 10 });
  assert.ok(w.holdings.length > m.holdings.length * 3);
  assert.ok(w.turnover >= 0 && m.turnover >= 0);
});

test("statistics: trailing, CAGR, drawdown, volatility on a known path", () => {
  const dates = []; const nav = [];
  for (let i = 0; i <= 730; i++) { dates.push(day(i)); nav.push(1.0002 ** i); }
  assert.ok(Math.abs(trailing(dates, nav, 365) - (1.0002 ** 730 / 1.0002 ** 365 - 1)) < 1e-9);
  assert.equal(trailing(dates, nav, 5000), null); // not enough history
  assert.ok(Math.abs(cagr(dates, nav, null) - (1.0002 ** 365.25 - 1)) < 1e-6);
  assert.equal(Math.min(...drawdown([1, 2, 1, 3, 1.5])), -0.5);
  assert.ok(annVol(nav) < 1e-9); // constant growth: zero volatility
  const noisy = nav.map((v, i) => v * (i % 2 ? 1.01 : 0.99));
  assert.ok(annVol(noisy) > 0.2);
  assert.equal(hitRatio(dates, nav, nav.map((v) => v * 0.99 ** 0), [dates[0], dates[100], dates[200]]), 0); // equal is not a win
});

test("stats row has every comparison-table field", () => {
  const u = universe();
  const bench = { dates: u[0].dates, close: u[0].dates.map((_, i) => 100 * 1.0001 ** i) };
  const run = runPortfolio(u, bench, { freq: "M", categories: PORTFOLIOS.strong.categories });
  const s = stats(run);
  for (const k of ["r1m", "r3m", "r6m", "r1y", "cagr2", "cagr3", "cagrAll", "maxDD", "vol", "sharpe", "hit", "turnover", "excessCagr"]) assert.ok(k in s, k);
  assert.ok(s.maxDD <= 0 && s.bench.maxDD <= 0);
});

test("normaliseWeights: 100% check and rescale", () => {
  assert.equal(normaliseWeights({ a: 50, b: 50 }, ["a", "b"]).ok, true);
  const n = normaliseWeights({ a: 30, b: 30 }, ["a", "b"]);
  assert.equal(n.ok, false); assert.equal(n.w.a, 0.5);
  assert.equal(normaliseWeights({}, ["a", "b"]).w.a, 0.5);
});

test("re-using stored ratings gives the identical run (the page caches them while weights are edited)", () => {
  const u = universe();
  const a = runPortfolio(u, null, { freq: "W", categories: PORTFOLIOS.strong.categories });
  const b = runPortfolio(u, null, { freq: "W", categories: PORTFOLIOS.strong.categories, ratings: a.ratings });
  assert.deepEqual(b.nav, a.nav);
});

test("sliceRun re-bases NAV and benchmark to 1 at the new start and keeps the tail identical", () => {
  const u = universe();
  const bench = { dates: u[0].dates, close: u[0].dates.map((_, i) => 100 * 1.0001 ** i) };
  const r = runPortfolio(u, bench, { freq: "W", categories: PORTFOLIOS.strong.categories });
  const start = r.dates[150];
  const s = sliceRun(r, start);
  assert.equal(s.dates[0], start); assert.ok(Math.abs(s.nav[0] - 1) < 1e-12 && Math.abs(s.bench[0] - 1) < 1e-12);
  assert.ok(Math.abs(s.nav.at(-1) - r.nav.at(-1) / r.nav[150]) < 1e-9);
  assert.ok(s.holdings.every((h) => h.date >= start));
  assert.equal(sliceRun(r, r.dates[0]), r);
});
