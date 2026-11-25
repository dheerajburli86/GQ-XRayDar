import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyGlocom, percentiles, rateGlocom, checkpointReturns, GroupAccumulator, groupMoves, groupTimeline } from "../engine/glocom.js";

test("classifyGlocom follows the sheet row by row", () => {
  const c = (w, m, y) => classifyGlocom(w, m, y).label;
  assert.equal(c(0.9, 0.5, 0.9), "US 80 80");
  assert.equal(c(0.8, 0.5, 0.9), "LTS 80");      // w <= 0.8
  assert.equal(c(0.7, 0.5, 0.7), "US 60 60");
  assert.equal(c(0.6, 0.5, 0.8), "LTS 60");      // w <= 0.6, y = 0.8 inclusive
  assert.equal(c(0.2, 0.2, 0.9), "UW 30 30");    // m6 fails the top rows
  assert.equal(c(0.3, 0.35, 0.1), "LTW 30");
  assert.equal(c(0.35, 0.35, 0.1), "UW 40 40");
  assert.equal(c(0.4, 0.45, 0.1), "LTW 40");     // w = 0.4 exactly, m6 >= 0.4 (heatmap rule)
  assert.equal(c(0.4, 0.35, 0.1), "Neutral 40 60"); // m6 < 0.4 at w = 0.4: no row matches
  assert.equal(c(0.5, 0.5, 0.5), "Neutral 40 60");
  assert.equal(c(0.5, 0.39, 0.5), "Neutral 40 60"); // w not < 0.4
  assert.equal(classifyGlocom(0.9, 0.5, 0.9).code, 1);
  assert.equal(classifyGlocom(0.3, 0.35, 0.1).code, 5);
  assert.equal(classifyGlocom(null, null, null).label, "Neutral 40 60");
});

test("percentiles: 0..1, ties averaged, nulls kept null", () => {
  assert.deepEqual(percentiles([3, 1, 2, null]), [1, 0, 0.5, null]);
  assert.deepEqual(percentiles([1, 1, 2]), [0.25, 0.25, 1]);
  assert.deepEqual(percentiles([5]), [0.5]);
});

test("rateGlocom ranks by band then score", () => {
  const items = [1, 2, 3, 4, 5].map((v) => ({ key: `g${v}`, w: v, m6: v, y: v }));
  const r = Object.fromEntries(rateGlocom(items).map((x) => [x.key, x]));
  assert.equal(r.g5.rank, 1); assert.equal(r.g5.label, "US 80 80");
  assert.equal(r.g1.rank, 5); assert.equal(r.g1.code, 5);
});

test("checkpointReturns uses calendar look-backs and drops stale series", () => {
  const time = [], close = [];
  for (let d = new Date("2024-01-01T00:00:00Z"); d <= new Date("2025-03-31T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1)) { time.push(d.toISOString().slice(0, 10)); close.push(100 + time.length); }
  const [r, stale] = checkpointReturns(time, close, ["2025-03-31", "2025-06-30"]);
  const at = (d) => close[time.indexOf(d)];
  assert.ok(Math.abs(r.w - (at("2025-03-31") / at("2025-03-24") - 1)) < 1e-12);
  assert.ok(Math.abs(r.y - (at("2025-03-31") / at("2024-03-31") - 1)) < 1e-12);
  assert.equal(stale, null);
  const [short] = checkpointReturns(time.slice(-30), close.slice(-30), ["2025-03-31"]);
  assert.equal(short.y, null); assert.ok(short.w != null);
});

test("group history tracks rank jumps and band changes", () => {
  const acc = new GroupAccumulator(["d1", "d2"]);
  // A falls from best to worst between d1 and d2; B and C move up one place
  acc.add("A", [{ w: 0.3, m6: 0.3, y: 0.3 }, { w: -0.3, m6: -0.3, y: -0.3 }]);
  acc.add("B", [{ w: 0.2, m6: 0.2, y: 0.2 }, { w: 0.2, m6: 0.2, y: 0.2 }]);
  acc.add("C", [{ w: 0.1, m6: 0.1, y: 0.1 }, { w: 0.1, m6: 0.1, y: 0.1 }]);
  const h = acc.history();
  assert.deepEqual(h.groups.A.rank, [1, 3]);
  const mv = Object.fromEntries(groupMoves(h, 1).map((x) => [x.name, x]));
  assert.equal(mv.A.jump, -2); assert.equal(mv.B.jump, 1); assert.equal(mv.C.jump, 1);
  assert.ok(mv.A.bandMove < 0);
  const tl = groupTimeline(h, "A");
  assert.equal(tl.length, 1); assert.equal(tl[0].date, "d2"); assert.equal(tl[0].jump, -2);
});

test("demo engine run writes group history and stock GLOCOM / LOCOM", async () => {
  const { generateDemo, demoSource } = await import("../engine/demo/generator.js");
  const { runPipeline } = await import("../engine/pipeline.js");
  const { MemorySink } = await import("../engine/memorySink.js");
  const sink = new MemorySink();
  await runPipeline(demoSource(generateDemo({ from: "2022-01-03" })), sink.sinkInterface, {});
  const keys = Object.keys(sink.glocomGroups);
  assert.ok(keys.includes("G|industry") && keys.includes("G|sector"));
  const g = sink.glocomGroups["G|industry"];
  const last = g.dates.length - 1;
  const ranks = Object.values(g.groups).map((x) => x.rank[last]).filter((v) => v != null).sort((a, b) => a - b);
  assert.deepEqual(ranks, ranks.map((_, i) => i + 1)); // 1..n, no gaps or duplicates
  const snaps = [...sink.snapshots.values()].filter((s) => s.glocom);
  assert.ok(snaps.length > 0);
  assert.ok(snaps.some((s) => s.glocom.locom && s.glocom.industry?.rank));
});

test("groups below the minimum stock count are shown but not ranked (Alok Sir, 2026-11-25)", async () => {
  const { GroupAccumulator, rerateHistory, smallGroups } = await import("../engine/glocom.js");
  const acc = new GroupAccumulator(["2026-11-20"]);
  const r = (w) => [{ w, m6: w * 2, y: w * 3 }];
  for (let i = 0; i < 6; i++) acc.add("Big A", r(0.01 * i));
  for (let i = 0; i < 5; i++) acc.add("Big B", r(-0.01 * i));
  for (let i = 0; i < 3; i++) acc.add("Tiny", r(0.5));
  const h5 = acc.history(5);
  assert.equal(h5.groups.Tiny.rank[0], null);
  assert.equal(h5.groups.Tiny.n[0], 3);
  assert.ok(h5.groups.Tiny.w[0] > 0.4);
  assert.equal(h5.of[0], 2);
  assert.deepEqual(smallGroups(h5), [{ name: "Tiny", n: 3 }]);
  // an older history rated with no minimum is re-rated the same way
  const h1 = acc.history();
  assert.equal(h1.groups.Tiny.rank[0], 1);
  const re = rerateHistory(h1, 5);
  assert.equal(re.groups.Tiny.rank[0], null);
  assert.deepEqual([re.groups["Big A"].rank[0], re.groups["Big B"].rank[0]], [h5.groups["Big A"].rank[0], h5.groups["Big B"].rank[0]]);
  assert.equal(rerateHistory(h5, 5), h5);
});
