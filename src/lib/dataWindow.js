// Shared hover state for the Data window (Ctrl+D) and the OHLCV legend on charts.
// A chart reports the candle under its crosshair; the legend and the window read it.
// src = { name, tf, bars:{time,open,high,low,close,volume} }; time = ISO date or null (cursor off the chart).
import { useSyncExternalStore } from "react";
import { emaStrict } from "../../engine/indicators.js";

let state = { open: false, src: null, time: null };
const subs = new Set();
const emit = () => subs.forEach((f) => f());
export const dwSubscribe = (f) => { subs.add(f); return () => subs.delete(f); };
export const dwGet = () => state;
export const useDw = () => useSyncExternalStore(dwSubscribe, dwGet);

export function reportHover(src, time) {
  if (!src?.bars?.time?.length) return;
  if (state.src?.bars === src.bars && state.time === time) return;
  // leaving a chart keeps its last bar on show; a different chart takes over
  state = { ...state, src, time: time ?? null };
  emit();
}
export const toggleDw = (open) => { state = { ...state, open: open ?? !state.open }; emit(); };

/** Index of the last candle at or before `time` (the last candle when time is null); -1 when none. */
export function barIndex(bars, time) {
  const t = bars?.time;
  if (!t?.length) return -1;
  if (time == null) return t.length - 1;
  let lo = 0, hi = t.length - 1, k = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (t[mid] <= time) { k = mid; lo = mid + 1; } else hi = mid - 1; }
  return k;
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const dayName = (iso) => { const [y, m, d] = String(iso).split("-").map(Number); return Number.isFinite(y) ? DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] : ""; };
export const dmy = (iso) => { const [y, m, d] = String(iso).split("-"); return d && m ? `${d}/${m}/${y}` : String(iso); };

/** The numbers for one candle: OHLCV, change on the previous candle, and the 12 EMAs of the close the Analyst data window shows. */
export function barInfo(bars, i) {
  if (!bars || i < 0 || i >= bars.time.length) return null;
  const prev = i > 0 ? bars.close[i - 1] : null;
  const c = bars.close[i];
  return { time: bars.time[i], open: bars.open[i], high: bars.high[i], low: bars.low[i], close: c, volume: bars.volume?.[i] ?? null, chg: prev > 0 && c != null ? (c / prev - 1) * 100 : null };
}

const rowCache = new WeakMap();
/** Bars of an Analyst price row ({time, ohlc}); the same object every call so the hover state can match it. */
export function rowBars(row) {
  if (!row?.ohlc || !row.time?.length) return null;
  let b = rowCache.get(row);
  if (!b) { b = { time: row.time, open: row.ohlc.open, high: row.ohlc.high, low: row.ohlc.low, close: row.ohlc.close, volume: row.ohlc.volume }; rowCache.set(row, b); }
  return b;
}

const emaCache = new WeakMap();
export const EMA_SHORT = [3, 5, 8, 10, 12, 15], EMA_LONG = [30, 35, 40, 45, 50, 60];
export function emasOf(bars) {
  let m = emaCache.get(bars);
  if (!m) { m = {}; for (const n of [...EMA_SHORT, ...EMA_LONG]) m[n] = emaStrict(bars.close, n); emaCache.set(bars, m); }
  return m;
}

export const fmtPx = (v) => (v == null || !Number.isFinite(v) ? "—" : Math.abs(v) >= 1000 ? v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : v.toFixed(Math.abs(v) < 10 ? 4 : 2));
export const fmtVol = (v) => (v == null || !Number.isFinite(v) ? "—" : v.toLocaleString("en-IN", { maximumFractionDigits: 2 }));
