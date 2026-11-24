// Every study in the chart lab catalogue, drawn the way the charts draw it (lib/chartOverlays.js):
// with its starting values, with each setting changed, with every price source, with a colour and
// width, and with nonsense settings. Pins Shankar Sir's rule that every setting is real: a box that
// changes nothing on the chart is a bug.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { STUDIES, SOURCE_STUDIES, SOURCES, MA_KINDS } from "../engine/studies.js";
import { studyOverlays } from "../src/lib/chartOverlays.js";

const fx = JSON.parse(fs.readFileSync(new URL("./fixtures/indicatorReference.json", import.meta.url), "utf8")).bars;
const n = fx.c.length;
const day = (i) => new Date(Date.UTC(2020, 0, 1) + i * 86400000).toISOString().slice(0, 10);
const bars = { time: fx.c.map((_, i) => day(i)), open: fx.o, high: fx.h, low: fx.l, close: fx.c, volume: fx.v };

const draw = (key, cfg = {}) => studyOverlays(bars, { [key]: { on: true, ...cfg } }, "D");
const points = (o) => [...o.price, ...o.panes.flatMap((p) => p.specs)].flatMap((s) => s.data || []).filter((d) => Number.isFinite(d.value) || Number.isFinite(d.close)).length + o.levels.length + o.notes.length;
const sig = (o) => JSON.stringify([o.price.map((s) => [s.data, s.priceLines]), o.panes.map((p) => p.specs.map((s) => [s.data, s.priceLines])), o.levels, o.notes]);
// anchored VWAP is a drawing (click a candle), not a study switched on in the list
const LISTED = STUDIES.filter((s) => s.key !== "avwap");
const HIST_ONLY = new Set(["cmf", "elder", "force", "chaikinOsc", "coppock", "volosc", "ao", "bop"]);

// settings that only matter in a situation the fixture does not create
const NO_VISIBLE_CHANGE = new Set([
  "ichimoku.shift", // shifts forward into dates after the last bar: checked separately below
  "alligator.jawShift", "alligator.teethShift", "alligator.lipsShift",
  "vwap.session=M", // "Auto" on daily candles IS monthly
]);
const ENUMS = { "pivots.kind": ["standard", "fibonacci", "woodie", "camarilla", "demark"], "vwap.session": ["Auto", "D", "W", "M", "Q", "Y"], "envelope.kind": MA_KINDS };

test("every study draws with its starting values", () => {
  for (const s of LISTED) {
    const o = draw(s.key);
    assert.ok(points(o) > 0, `${s.key} drew nothing`);
  }
});

test("every setting of every study changes what is drawn", () => {
  const dead = [];
  for (const s of LISTED) {
    const base = sig(draw(s.key, { params: { ...s.params } }));
    for (const [k, v0] of Object.entries(s.params || {})) {
      const id = `${s.key}.${k}`;
      if (NO_VISIBLE_CHANGE.has(id)) continue;
      const tries = ENUMS[id] ? ENUMS[id].filter((x) => x !== v0)
        : typeof v0 === "number" ? (Number.isInteger(v0) && v0 !== 0 ? [Math.max(1, Math.round(v0 * 1.6) + 1)] : v0 === 0 ? [1] : [v0 * 1.6])
        : [];
      for (const v of tries) {
        const o = draw(s.key, { params: { ...s.params, [k]: v } });
        assert.ok(points(o) > 0, `${id}=${v} drew nothing`);
        if (sig(o) === base && !NO_VISIBLE_CHANGE.has(`${id}=${v}`)) dead.push(`${id}=${v}`);
      }
    }
  }
  assert.deepEqual(dead, [], `settings that change nothing: ${dead.join(", ")}`);
});

test("forward shifts move the lines forward", () => {
  const a = draw("ichimoku", { params: { tenkan: 9, kijun: 26, spanB: 52, shift: 26 } }), b = draw("ichimoku", { params: { tenkan: 9, kijun: 26, spanB: 52, shift: 40 } });
  const last = (o) => o.price.map((s) => s.data.at(-1)?.time).sort().at(-1);
  assert.ok(last(b) > last(a), "ichimoku shift 40 should reach further forward than 26");
  const al = (jaw) => draw("alligator", { params: { ...STUDIES.find((x) => x.key === "alligator").params, jawShift: jaw } });
  const lastJaw = (o) => o.price[0].data.at(-1).time;
  assert.ok(lastJaw(al(20)) > lastJaw(al(8)), "alligator jaw shift");
});

test("every price source works and changes single-series studies", () => {
  for (const key of SOURCE_STUDIES) {
    const s = STUDIES.find((x) => x.key === key);
    const base = sig(draw(key, { params: { ...s.params, source: "close" } }));
    for (const src of SOURCES) {
      const o = draw(key, { params: { ...s.params, source: src } });
      assert.ok(points(o) > 0, `${key} source ${src} drew nothing`);
      if (src === "hl2") assert.notEqual(sig(o), base, `${key}: source hl2 gave the same lines as close`);
    }
  }
});

test("colour, width and up / down colours reach what is drawn", () => {
  const miss = [];
  for (const s of LISTED) {
    const updown = ["psar", "supertrend", "pivots", "ppo"].includes(s.key) || HIST_ONLY.has(s.key) || "hi" in (s.params || {});
    const o = draw(s.key, { color: "#123456", width: 4, upColor: "#00aa01", downColor: "#aa0002" });
    const specs = [...o.price, ...o.panes.flatMap((p) => p.specs)];
    const all = JSON.stringify([specs, o.levels]);
    if (!HIST_ONLY.has(s.key) && !["psar", "supertrend"].includes(s.key) && !all.includes("#123456")) miss.push(`${s.key} colour`);
    if (!HIST_ONLY.has(s.key) && s.key !== "pivots" && !specs.some((sp) => sp.options?.lineWidth === 4)) miss.push(`${s.key} width`);
    if (updown && !(all.includes("#00aa01") && all.includes("#aa0002"))) miss.push(`${s.key} up/down`);
  }
  assert.deepEqual(miss, [], `not applied: ${miss.join(", ")}`);
});

test("settings are held to a usable range", () => {
  const big = draw("ichimoku", { params: { tenkan: 1e6, kijun: 1e6, spanB: 1e6, shift: 1e6 } });
  assert.ok(big.price.length > 0);
  const lv = draw("cci", { params: { n: 20, constant: 0.015, hi: 250, lo: -250 } });
  assert.deepEqual(lv.panes[0].specs[0].priceLines.map((x) => x.price), [250, -250], "levels may be any number, also negative");
  const eom = (scale) => sig(draw("eom", { params: { n: 14, scale } }));
  assert.notEqual(eom(1e8), eom(1e9), "EOM scale is not a period");
});

test("nonsense settings never throw", () => {
  for (const s of LISTED) {
    for (const bad of [0, -5, 1e6, NaN, "", null, "abc"]) {
      const params = Object.fromEntries(Object.keys(s.params || {}).map((k) => [k, bad]));
      assert.doesNotThrow(() => draw(s.key, { params }), `${s.key} with ${bad}`);
    }
  }
  assert.doesNotThrow(() => studyOverlays({ time: [], open: [], high: [], low: [], close: [], volume: [] }, Object.fromEntries(STUDIES.map((s) => [s.key, { on: true }])), "D"));
  for (const k of [1, 2, 5, 30]) {
    const short = { time: bars.time.slice(0, k), open: fx.o.slice(0, k), high: fx.h.slice(0, k), low: fx.l.slice(0, k), close: fx.c.slice(0, k), volume: fx.v.slice(0, k) };
    assert.doesNotThrow(() => studyOverlays(short, Object.fromEntries(STUDIES.map((s) => [s.key, { on: true }])), "D"), `${k} candles`);
  }
});

test("all 56 at once", () => {
  const o = studyOverlays(bars, Object.fromEntries(STUDIES.map((s) => [s.key, { on: true }])), "D");
  assert.equal(STUDIES.length, 56);
  assert.ok(o.panes.length >= 30, `panes ${o.panes.length}`);
  assert.ok(n > 500);
});
