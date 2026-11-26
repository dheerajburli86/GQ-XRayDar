import { test } from "node:test";
import assert from "node:assert/strict";
import { weightedLimiter, mapLimit } from "../engine/concurrency.js";

test("weighted limiter keeps the budget, and an item larger than the budget still runs alone", async () => {
  const run = weightedLimiter(10, 3);
  let inUse = 0, max = 0, maxAloneBig = true;
  const job = (w, ms) => run(w, async () => { inUse += w; max = Math.max(max, inUse); if (w > 10 && inUse !== w) maxAloneBig = false; await new Promise((r) => setTimeout(r, ms)); inUse -= w; });
  await Promise.all([job(12, 20), job(4, 10), job(4, 10), job(4, 10), job(1, 5)]);
  assert.ok(maxAloneBig);
  assert.ok(max <= 12);
});

test("mapLimit returns results in input order", async () => {
  const r = await mapLimit([30, 10, 20], 2, async (ms, i) => { await new Promise((x) => setTimeout(x, ms)); return i; });
  assert.deepEqual(r, [0, 1, 2]);
});

test("pipeline: running countries side by side gives the same results as one at a time", async () => {
  const { generateDemo, demoSource } = await import("../engine/demo/generator.js");
  const { runPipeline } = await import("../engine/pipeline.js");
  const { MemorySink } = await import("../engine/memorySink.js");
  const demo = generateDemo({ from: "2022-01-03" });
  const runWith = async (parallel) => { const sink = new MemorySink(); await runPipeline(demoSource(demo), sink.sinkInterface, { parallel }); return sink; };
  const a = await runWith({});
  const b = await runWith({ countries: 4, budget: 200, prefetch: 2 });
  const snaps = (s) => JSON.stringify([...s.snapshots.values()].map((x) => [x.id, x.score, x.rsRank, x.snap?.asOf]).sort((p, q) => (p[0] < q[0] ? -1 : 1)));
  assert.equal(snaps(a), snaps(b));
  const idx = (s) => JSON.stringify([...s.indexMeta.entries()].map(([k, v]) => [k, v.lastLevel]).sort());
  assert.equal(idx(a), idx(b));
  const bt = (s) => JSON.stringify(s.backtest.map((r) => [r.type, r.scope, r.horizon, r.n]).sort());
  assert.equal(bt(a), bt(b));
  const gl = (s) => JSON.stringify(Object.keys(s.glocomGroups).sort().map((k) => [k, s.glocomGroups[k]?.of]));
  assert.equal(gl(a), gl(b));
  assert.ok(a.snapshots.size > 0);
});
