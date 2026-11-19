// One pane of the Analyst-style screens (price / RSI / RSC with the yellow-red MMA groups or the
// ACC averages, black look), shared by the stacked screens and the multi-tile screen.
import { useMemo } from "react";
import { TvChart } from "./TvChart.jsx";
import { tfMonths } from "../../engine/calendar.js";
import { MMA_SHORT } from "../../engine/analyst.js";
import { priceSeries } from "../lib/chartStyle.js";

export const YELLOW = "#ffff00", RED = "#e00000", GREEN = "#00ff00", CYAN = "#00ffff", WHITE = "#ffffff", MAGENTA = "#ff00ff";
export const ACC_COLOR = { 4: CYAN, 14: RED, 26: WHITE, 39: YELLOW };
// raw-line colour per row in the ACC screens, as in the reference screenshots
export const ACC_BASE = { RSIACC: [GREEN, GREEN, YELLOW, MAGENTA], RSCACC: [GREEN, YELLOW, GREEN, CYAN, MAGENTA] };
export const PRESETS = [["D", "W"], ["M", "Q"], ["H", "N"], ["Y", "24M"]];
export const DEFAULT_VIEW = { avgOnly: false, log: true, short: true, long: true, acc: { 4: true, 14: true, 26: true, 39: true }, price: "line" };

export const DARK = {
  layout: { background: { color: "#000000" }, textColor: "#d4d4d4", fontSize: 10 },
  grid: { vertLines: { visible: false }, horzLines: { visible: false } },
  rightPriceScale: { borderColor: "#3f3f3f" },
  timeScale: { borderColor: "#3f3f3f" },
};
export const DARK_NO_AXIS = { ...DARK, timeScale: { ...DARK.timeScale, visible: false } };


export function Pane({ row, ri, last, mode, overlay, v, tf, from, height, sync, rangeKey }) {
  const built = useMemo(() => {
    if (!row.time.length) return null;
    const keep = (x) => x != null && Number.isFinite(x) && (!v.log || x > 0);
    const line = (vals) => { const out = []; for (let i = 0; i < row.time.length; i++) if (keep(vals[i])) out.push({ time: row.time[i], value: vals[i] }); return out; };
    const baseColor = overlay === "mma" ? YELLOW : (ACC_BASE[mode] || [])[ri] || GREEN;
    const lvl = row.kind === "rsi" ? [30, 50, 70].map((p) => ({ price: p, color: "#bdbdbd", lineWidth: 1, lineStyle: 0, axisLabelVisible: false, title: "" })) : [];
    // the base line is the crosshair anchor and carries the 30 / 50 / 70 lines, so "averages only"
    // makes it transparent rather than removing it (the scale and the level lines stay put)
    // the price row follows the chosen style (line green up / red down, bars, candles); the
    // other rows keep the Analyst colours
    const series = row.kind === "price" && row.ohlc && !v.avgOnly
      ? [priceSeries(row.time, row.ohlc, v.price || "line", { keep, id: "base", up: "#00e000", down: "#ff3030" })]
      : [{ id: "base", type: "line", data: line(row.base), priceLines: lvl,
        options: { color: v.avgOnly ? "rgba(0,0,0,0)" : baseColor, lineWidth: 1, lastValueVisible: false, crosshairMarkerVisible: !v.avgOnly } }];
    for (const a of row.avgs) {
      if (overlay === "mma" ? !(a.group === "short" ? v.short : v.long) : !v.acc[a.period]) continue;
      let color = overlay === "mma" ? (MMA_SHORT.includes(a.period) ? YELLOW : RED) : ACC_COLOR[a.period];
      if (overlay === "acc" && color === baseColor) color = GREEN;
      series.push({ id: `e${a.period}`, type: "line", data: line(a.values), options: { color, lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false } });
    }
    return series;
  }, [row, ri, mode, overlay, v]);

  // default window: about 2 years of daily candles, 10 years of weekly, everything from monthly up
  const visibleRange = useMemo(() => {
    const t = row.time, n = t.length;
    if (!n) return null;
    if (from) {
      // first candle holding a session on or after From (its stamp is its last session)
      const i = t.findIndex((x) => x >= from);
      return i < 0 ? null : { from: t[i], to: t[n - 1] };
    }
    const months = tfMonths(tf);
    if (months >= 1) return null;
    const show = months < 0.1 ? 500 : 520;
    return { from: t[Math.max(0, n - show)], to: t[n - 1] };
  }, [row.time, tf, from]);

  return (
    <div className="anl-pane">
      <div className="anl-label">{row.label}</div>
      {built ? <TvChart height={height} series={built} sync={sync} logScale={v.log} visibleRange={visibleRange} rangeKey={rangeKey} fit theme={last ? DARK : DARK_NO_AXIS} />
        : <div className="anl-empty" style={{ height }}>{row.missing || "no data"}</div>}
    </div>
  );
}
