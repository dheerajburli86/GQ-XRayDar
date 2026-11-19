// The four Analyst-style stacked screens (owner's reference: the "Analyst" software,
// screenshots of HFCL and Reliance, 2026-11-16). Two timeframes side by side; each
// column stacks:
//   RSIMMA / RSIACC  Price | RSI | RSI of RSI | RSI of RSI of RSI
//   RSCMMA / RSCACC  Price | RSC | RSI of RSC | RSI of RSI of RSC | RSI of RSI of RSI of RSC
// with the MMA groups (short EMA 3-15, long EMA 30-60) or the ACC averages (EMA 4/14/26/39)
// drawn on every row. RSI and every EMA are counted in candles OF THAT COLUMN'S timeframe.
// Shared by the screens page and anything that wants the same numbers (one engine).
import { aggregate, rsi, emaStrict, rsc } from "./indicators.js";
import { tfShort } from "./calendar.js";

export const MMA_SHORT = [3, 5, 8, 10, 12, 15];
export const MMA_LONG = [30, 35, 40, 45, 50, 60];
export const ACC_PERIODS = [4, 14, 26, 39];
export const ANALYST_MODES = {
  RSIMMA: { base: "rsi", overlay: "mma" },
  RSIACC: { base: "rsi", overlay: "acc" },
  RSCMMA: { base: "rsc", overlay: "mma" },
  RSCACC: { base: "rsc", overlay: "acc" },
};

/** Row definitions for a mode: kind price | rsc | rsi, and how many RSIs deep. */
export function analystRows(mode) {
  const m = ANALYST_MODES[mode];
  if (!m) throw new Error(`unknown screen ${mode}`);
  if (m.base === "rsi") return [{ kind: "price", depth: 0 }, { kind: "rsi", depth: 1 }, { kind: "rsi", depth: 2 }, { kind: "rsi", depth: 3 }];
  return [{ kind: "price", depth: 0 }, { kind: "rsc", depth: 0 }, { kind: "rsi", depth: 1, of: "rsc" }, { kind: "rsi", depth: 2, of: "rsc" }, { kind: "rsi", depth: 3, of: "rsc" }];
}

export function rowLabel(row, tf, per, benchLabel) {
  const short = tfShort(tf);
  const t = short.length === 1 ? `${per}${short}` : `${per} (${short})`; // "RSI 14W", but "RSI 14 (5M)" not "145M"
  if (row.kind === "price") return "Price";
  if (row.kind === "rsc") return `RSC vs ${benchLabel || "benchmark"}`;
  const src = row.of === "rsc" ? `RSC vs ${benchLabel || "benchmark"}` : "Close";
  return `RSI ${t}` + " of RSI".repeat(row.depth - 1) + ` of ${src}`;
}

const ISO_MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-11-13" -> "13-Nov-2026" (string only; never through Date). */
export const analystDate = (d) => (d ? `${d.slice(8, 10)}-${ISO_MON[+d.slice(5, 7) - 1]}-${d.slice(0, 4)}` : "");

/**
 * One column of a screen.
 * bars: daily columns {time, open, high, low, close, volume?}; bench: {time, close} for RSC modes;
 * rscCloses: the stock's closes in the benchmark's currency when the two differ (defaults to bars.close).
 * to ("YYYY-MM-DD", optional): drop every bar after it, so the last candle is the one holding that date.
 * anchor ("YYYY-MM-DD", optional): count multi-month / multi-week candles from that date (periodKey).
 * Bars before the start date still feed the RSIs and averages, so they are warmed up when the window opens.
 * Returns { tf, header, rows: [{ kind, depth, label, time, base, avgs: [{ period, group, values }] }] }.
 */
export function buildAnalystColumn({ mode, tf, bars, bench = null, rscCloses = null, benchLabel = "", rsiPeriod = 14, rsiMethod = "house", rscBase = 100, to = null, anchor = null }) {
  const m = ANALYST_MODES[mode];
  if (to) {
    let k = bars.time.length;
    while (k > 0 && bars.time[k - 1] > to) k--;
    if (k < bars.time.length) {
      const cut = (a) => (Array.isArray(a) ? a.slice(0, k) : a);
      bars = { ...bars, time: cut(bars.time), open: cut(bars.open), high: cut(bars.high), low: cut(bars.low), close: cut(bars.close), volume: cut(bars.volume) };
      if (rscCloses) rscCloses = rscCloses.slice(0, k);
    }
  }
  const agg = aggregate({ ...bars, volume: bars.volume || bars.close.map(() => 0) }, tf, anchor);
  const n = agg.time.length;
  const header = n ? {
    open: agg.open[n - 1], high: agg.high[n - 1], low: agg.low[n - 1], close: agg.close[n - 1],
    chg: n > 1 && agg.close[n - 2] ? agg.close[n - 1] / agg.close[n - 2] - 1 : null,
    date: agg.time[n - 1], candles: n,
  } : null;
  let rel = null;
  if (m.base === "rsc" && bench) rel = rsc(bars.time, rscCloses || bars.close, bench.time, bench.close, tf, rscBase, anchor);
  const periods = m.overlay === "mma" ? [...MMA_SHORT, ...MMA_LONG] : ACC_PERIODS;
  const rows = analystRows(mode).map((row) => {
    let time, base;
    let ohlc = null;
    if (row.kind === "price") { time = agg.time; base = agg.close; ohlc = { open: agg.open, high: agg.high, low: agg.low, close: agg.close, volume: agg.volume }; }
    else if (row.kind === "rsc" || row.of === "rsc") {
      if (!rel) return { ...row, label: rowLabel(row, tf, rsiPeriod, benchLabel), time: [], base: [], avgs: [], missing: "no comparison series" };
      time = rel.time; base = rel.value;
      for (let k = 0; k < row.depth; k++) base = rsi(base, rsiPeriod, rsiMethod);
    } else {
      time = agg.time; base = agg.close;
      for (let k = 0; k < row.depth; k++) base = rsi(base, rsiPeriod, rsiMethod);
    }
    const avgs = periods.map((p) => ({ period: p, group: m.overlay === "acc" ? "acc" : MMA_SHORT.includes(p) ? "short" : "long", values: emaStrict(base, p) }));
    return { ...row, label: rowLabel(row, tf, rsiPeriod, benchLabel), time, base, avgs, ...(ohlc ? { ohlc } : {}) };
  });
  return { tf, header, rows };
}
