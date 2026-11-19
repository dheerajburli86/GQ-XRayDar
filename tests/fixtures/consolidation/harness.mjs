// Loads the fixture closes and scores the detector against the owner's dated examples.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rsc } from "../../../engine/indicators.js";
import { mmaBreakouts } from "../../../engine/consolidation.js";
import { CASES, NEGATIVES, BENCH } from "./cases.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const TF = { d: "D", w: "W", m: "M", q: "Q" };
const cache = new Map();
export function load(name) {
  if (cache.has(name)) return cache.get(name);
  const out = {};
  for (const line of fs.readFileSync(path.join(DIR, `${name}.txt`), "utf8").split("\n")) {
    if (!line.trim()) continue;
    const [k, ...rest] = line.trim().split(/\s+/);
    const time = [], close = [];
    for (const p of rest) { const [d, c] = p.split(","); time.push(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`); close.push(Number(c)); }
    out[TF[k]] = { time, close };
  }
  cache.set(name, out);
  return out;
}

/** The series a screen draws its averages on: price (RSIMMA) or price / benchmark (RSCMMA). */
export function seriesFor(stock, screen, tf) {
  const s = load(stock)[tf];
  if (!s) return null;
  if (screen !== "RSCMMA") return { time: s.time, values: s.close };
  const b = load(BENCH[stock])[tf];
  if (!b) return null;
  const r = rsc(s.time, s.close, b.time, b.close, tf, 100);
  return { time: r.time, values: r.value };
}

/** Index of the candle a label refers to: the month's candle for "YYYY-MM", else the nearest date. */
export function indexOf(time, label) {
  if (label.length === 7) return time.findIndex((t) => t.slice(0, 7) >= label);
  let best = -1, bd = Infinity;
  const L = Date.parse(label);
  for (let i = 0; i < time.length; i++) { const d = Math.abs(Date.parse(time[i]) - L); if (d < bd) { bd = d; best = i; } }
  return best;
}

export const TOLERANCE = { D: 5, W: 2, M: 2, Q: 1 };

export function evaluate() {
  const rows = [];
  let chance = 0;
  for (const c of CASES) {
    if (!c.end) continue;
    const s = seriesFor(c.stock, c.screen, c.tf);
    const e = indexOf(s.time, c.end);
    if (e < 12) { rows.push({ ...c, scored: false }); continue; }
    const { events } = mmaBreakouts(s.time, s.values);
    const ups = events.filter((x) => x.dir === "up");
    const best = ups.reduce((b, x) => (b == null || Math.abs(x.endIdx - e) < Math.abs(b.endIdx - e) ? x : b), null);
    const off = best ? best.endIdx - e : null;
    const tol = TOLERANCE[c.tf];
    let cover = 0, m = 0;
    for (let i = 15; i < s.time.length; i++) { m++; if (ups.some((x) => Math.abs(x.endIdx - i) <= tol)) cover++; }
    chance += cover / m;
    rows.push({ ...c, scored: true, hit: off != null && Math.abs(off) <= tol, off, detected: best ? `${best.start}..${best.end}` : null });
  }
  const scored = rows.filter((r) => r.scored);
  const negatives = NEGATIVES.map((ng) => {
    const s = seriesFor(ng.stock, ng.screen, ng.tf);
    const fired = mmaBreakouts(s.time, s.values).events.filter((x) => x.dir === "up" && x.end.slice(0, 7) >= ng.from && x.end.slice(0, 7) <= ng.to);
    return { ...ng, fired: fired.map((x) => x.end) };
  });
  return { rows, hits: scored.filter((r) => r.hit).length, scored: scored.length, chance: chance / scored.length, negatives };
}
