import { test } from "node:test";
import assert from "node:assert/strict";
import { geometry, alertLevels } from "../engine/drawings.js";

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
test("Fibonacci retracement of a 100 -> 200 rise", () => {
  const g = geometry({ type: "fib", a: { i: 0, price: 100 }, b: { i: 10, price: 200 } }, 50);
  const lv = g.lines.map((l) => l.pts[0][1]);
  near(lv[0], 200); near(lv[3], 150); near(lv[4], 138.2); near(lv[6], 100);
  assert.equal(g.lines[0].pts[1][0], 50); // runs to the latest bar
  assert.equal(alertLevels({ type: "fib", a: { i: 0, price: 100 }, b: { i: 10, price: 200 } }, 50).length, 7);
});
test("Fibonacci extension from the third point", () => {
  const g = geometry({ type: "fibext", a: { i: 0, price: 100 }, b: { i: 10, price: 200 }, c: { i: 15, price: 150 } }, 30);
  near(g.lines.find((l) => l.title.startsWith("161.8%")).pts[0][1], 311.8);
});
test("pitchfork median runs from the handle through the midpoint of b and c", () => {
  const g = geometry({ type: "pitchfork", a: { i: 0, price: 100 }, b: { i: 10, price: 120 }, c: { i: 20, price: 100 } }, 40);
  const med = g.lines[0]; // handle (0,100) through (15,110): slope 2/3
  near(med.pts[1][1], 100 + (2 / 3) * 40);
  const sch = geometry({ type: "schiff", a: { i: 0, price: 100 }, b: { i: 10, price: 120 }, c: { i: 20, price: 100 } }, 40).lines[0];
  near(sch.pts[0][1], 110);
});
test("Gann fan: the 1x1 passes through b, 1x2 is twice as steep", () => {
  const g = geometry({ type: "gannfan", a: { i: 0, price: 100 }, b: { i: 10, price: 110 } }, 20);
  const one = g.lines.find((l) => l.title === "1x1"), two = g.lines.find((l) => l.title === "1x2");
  near(one.pts[1][1], 120); near(two.pts[1][1], 140);
});
test("risk / reward box and measure", () => {
  const g = geometry({ type: "rr", a: { i: 5, price: 100 }, b: { i: 6, price: 95 }, c: { i: 7, price: 115 } }, 20);
  assert.match(g.info, /Reward \/ risk 3\.00 : 1/);
  const m = geometry({ type: "measure", a: { i: 0, price: 100 }, b: { i: 20, price: 125 } }, 30);
  assert.match(m.info, /\+25\.00 \(25\.0%\) over 20 bars/);
  const tz = geometry({ type: "fibtime", a: { i: 0, price: 1 }, b: { i: 2, price: 1 } }, 30);
  assert.deepEqual(tz.marks.map((x) => x.i), [2, 4, 6, 10, 16, 26]);
});
