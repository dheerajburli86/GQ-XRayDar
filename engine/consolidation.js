// Multi-period consolidation and breakout (owner's rule sheet "Multiperiod consolidation",
// 2026-11-17, and his dated examples of 2026-11-18 for HFCL, Glenmark, Sansera, Dell, Nvidia,
// KOSPI $ and Taiwan $).
//
// What the owner marks, read off his circled charts: the area on the PRICE pane (RSIMMA screen)
// or the RSC pane (RSCMMA screen) where the yellow averages (EMA 3-15) stop trending, flatten and
// run into or along the red averages (EMA 30-60), and the candle where the yellow lines fan out
// upward again over the red ones. There is no fixed duration and no fixed width (his words), so
// this module uses no width threshold at all:
//
//   up fan    = yellow lines in order, fastest on top (3 > 5 > 8 > 10 > 12 > 15) AND the fastest
//               yellow above every red line
//   down fan  = the mirror (fastest at the bottom and below every red line)
//   breakout  = the first candle of an up fan after one or more candles without it
//   breakdown = the first candle of a down fan after one or more candles without it
//   start     = the lowest point of the yellow lines between the last up fan and the breakout
//               (the highest point for a breakdown): where the yellow stopped falling
//
// Averages are drawn from the first candle, as in the Analyst software (a recently listed stock
// still has lines), and measured on log values because the charts are on a log scale.
//
// Checked against the owner's 53 dated breakouts (tests/consolidation.test.mjs): 43 within
// +/- 2 candles (+/- 5 sessions on daily, +/- 1 quarter), where a random date would score about 26%.
// The start date matches his within a few candles about half the time; his starts are judgement
// calls and vary in kind, so treat the start as approximate.
import { ema } from "./indicators.js";

export const MMA_YELLOW = [3, 5, 8, 10, 12, 15];
export const MMA_RED = [30, 35, 40, 45, 50, 60];
/** Candles a breakout stays "recent" for, per timeframe. */
export const RECENT_CANDLES = { D: 10, W: 4, M: 2, Q: 1 };
/** No event before this many candles: the slowest yellow line needs them to mean anything. */
export const MIN_CANDLES = 15;

const isNum = (v) => v != null && Number.isFinite(v);

/** Yellow and red EMA lines on log values (null where a value is missing or not positive). */
export function mmaRibbon(values) {
  const x = values.map((v) => (isNum(v) && v > 0 ? Math.log(v) : null));
  return { yellow: MMA_YELLOW.map((p) => ema(x, p)), red: MMA_RED.map((p) => ema(x, p)), x };
}

function fan(Y, R, i) {
  let up = true, down = true;
  for (let k = 0; k < Y.length; k++) if (!isNum(Y[k][i])) return 0;
  for (let k = 0; k < R.length; k++) if (!isNum(R[k][i])) return 0;
  for (let k = 1; k < Y.length; k++) {
    if (!(Y[k - 1][i] > Y[k][i])) up = false;
    if (!(Y[k - 1][i] < Y[k][i])) down = false;
  }
  let rMax = -Infinity, rMin = Infinity;
  for (const r of R) { if (r[i] > rMax) rMax = r[i]; if (r[i] < rMin) rMin = r[i]; }
  if (up && Y[0][i] > rMax) return 1;
  if (down && Y[0][i] < rMin) return -1;
  return 0;
}

/**
 * All breakouts and breakdowns in one series (one timeframe of closes, or of an RSC line).
 * time: date strings, values: same length. Returns
 * { events: [{ dir: "up"|"down", start, end, startIdx, endIdx, candles, turn }], state }
 *   turn: true when the yellow lines were fully on the other side of the red lines at some point
 *         before the event (a change of direction); false for a pause inside a trend.
 *   state: { fan: 1 | 0 | -1, since, sinceIdx } -- the current fan and the date it began
 *          (fan 0 = consolidating: yellow lines not fanned either way).
 */
export function mmaBreakouts(time, values, { minCandles = MIN_CANDLES } = {}) {
  const n = Math.min(time.length, values.length);
  const { yellow: Y, red: R, x } = mmaRibbon(values.slice(0, n));
  const f = new Array(n);
  for (let i = 0; i < n; i++) f[i] = fan(Y, R, i);
  const yMean = (i) => { let s = 0; for (const y of Y) { if (!isNum(y[i])) return null; s += y[i]; } return s / Y.length; };
  const fullySide = (i, dir) => {
    let yMax = -Infinity, yMin = Infinity, rMax = -Infinity, rMin = Infinity;
    for (const y of Y) { if (!isNum(y[i])) return false; yMax = Math.max(yMax, y[i]); yMin = Math.min(yMin, y[i]); }
    for (const r of R) { if (!isNum(r[i])) return false; rMax = Math.max(rMax, r[i]); rMin = Math.min(rMin, r[i]); }
    return dir > 0 ? yMax < rMin : yMin > rMax;
  };
  const events = [];
  for (const dir of [1, -1]) {
    let offStart = -1;
    for (let i = 0; i < n; i++) {
      if (f[i] === dir) {
        if (offStart >= 0 && i >= minCandles && isNum(x[i])) {
          let s = -1, best = null, turn = false;
          for (let j = offStart; j <= i; j++) {
            const m = yMean(j);
            if (isNum(m) && (best == null || (dir > 0 ? m < best : m > best))) { best = m; s = j; }
            if (!turn && fullySide(j, dir)) turn = true;
          }
          if (s >= 0) events.push({ dir: dir > 0 ? "up" : "down", start: time[s], end: time[i], startIdx: s, endIdx: i, candles: i - s, turn });
        }
        offStart = -1;
      } else if (offStart < 0 && i > 0) offStart = i;
    }
  }
  events.sort((a, b) => a.endIdx - b.endIdx || (a.dir < b.dir ? -1 : 1));
  if (!n) return { events, state: { fan: 0, since: null, sinceIdx: -1 } };
  const cur = f[n - 1];
  let k = n - 1;
  while (k > 0 && f[k - 1] === cur) k--;
  return { events, state: { fan: cur, since: time[k], sinceIdx: k } };
}

/**
 * Compact summary for one series, for the snapshot and the screen fields.
 * { state: "fan_up" | "fan_down" | "consolidating", since, up: {start, end, age, candles, turn} | null,
 *   down: {...} | null, recentUp, recentDown }
 * age = candles since the event (0 = it happened on the last candle).
 */
export function mmaBreakoutSummary(time, values, tf) {
  const n = Math.min(time.length, values.length);
  const { events, state } = mmaBreakouts(time, values);
  const last = (dir) => { for (let j = events.length - 1; j >= 0; j--) if (events[j].dir === dir) return events[j]; return null; };
  const pack = (e) => (e ? { start: e.start, end: e.end, age: n - 1 - e.endIdx, candles: e.candles, turn: e.turn } : null);
  const up = pack(last("up")), down = pack(last("down"));
  const recent = RECENT_CANDLES[tf] ?? 2;
  // a breakout stays "recent" only while the yellow lines are still fanned that way
  return {
    state: state.fan > 0 ? "fan_up" : state.fan < 0 ? "fan_down" : "consolidating",
    since: state.since,
    up, down,
    recentUp: !!(up && up.age < recent && state.fan > 0),
    recentDown: !!(down && down.age < recent && state.fan < 0),
  };
}
