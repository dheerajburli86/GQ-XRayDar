// lightweight-charts wrapper. One <TvChart> = one chart instance; charts that
// belong to a ChartSync share horizontal scroll / zoom (by TIME, so a weekly
// and a daily window stay on the same dates) and the crosshair.
import { useEffect, useRef } from "react";
import { createChart, CandlestickSeries, LineSeries, HistogramSeries, AreaSeries, createSeriesMarkers, LineStyle } from "lightweight-charts";

const TYPES = { candles: CandlestickSeries, line: LineSeries, histogram: HistogramSeries, area: AreaSeries };

function themeOptions() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim() || undefined;
  return {
    layout: { background: { color: "transparent" }, textColor: v("--chart-text"), fontFamily: v("--font"), fontSize: 11, attributionLogo: false },
    grid: { vertLines: { color: v("--chart-grid") }, horzLines: { color: v("--chart-grid") } },
    rightPriceScale: { borderColor: v("--line") },
    timeScale: { borderColor: v("--line"), rightOffset: 4, minBarSpacing: 0.05 },
    crosshair: { mode: 0 },
  };
}

/** Shared scroll/zoom/crosshair across charts. */
export class ChartSync {
  constructor() { this.members = new Set(); this.busy = false; }
  add(m) { this.members.add(m); return () => this.members.delete(m); }
  range(src, r) {
    if (this.busy || !r) return;
    this.busy = true;
    for (const m of this.members) if (m !== src) { try { m.chart.timeScale().setVisibleRange(r); } catch { /* chart without data */ } }
    this.busy = false;
  }
  cross(src, time) {
    for (const m of this.members) {
      if (m === src) continue;
      if (time == null) { m.chart.clearCrosshairPosition(); continue; }
      const p = m.valueAt?.(time);
      if (p) { try { m.chart.setCrosshairPosition(p.value, p.time, p.series); } catch { /* ignore */ } }
    }
  }
}

/**
 * series: [{ id, type, data: [{time, value} | {time, open, high, low, close}], options, priceLines?: [...], markers?: [...] }]
 * The first series is the "anchor" used for crosshair sync.
 */
/** Merge a fixed look (e.g. the black Analyst screens) over the app theme, one level deep. */
function withTheme(base, theme) {
  if (!theme) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(theme)) out[k] = v && typeof v === "object" && !Array.isArray(v) ? { ...(base[k] || {}), ...v } : v;
  return out;
}

export function TvChart({ series, height = 300, sync, onReady, logScale = false, scaleMargins, visibleRange, fit = true, rangeKey, theme }) {
  const el = useRef(null), chartRef = useRef(null), seriesRef = useRef([]), memberRef = useRef(null);
  const viewKey = useRef(undefined); // the view is set once per rangeKey, so toggling a line never resets the zoom

  useEffect(() => {
    const chart = createChart(el.current, { ...withTheme(themeOptions(), theme), autoSize: true, height });
    chartRef.current = chart;
    const member = { chart, valueAt: null };
    memberRef.current = member;
    let unsub = null;
    if (sync) {
      unsub = sync.add(member);
      chart.timeScale().subscribeVisibleTimeRangeChange((r) => sync.range(member, r));
      chart.subscribeCrosshairMove((p) => sync.cross(member, p?.time ?? null));
    }
    onReady?.(chart);
    const mo = new MutationObserver(() => chart.applyOptions(withTheme(themeOptions(), theme)));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => { mo.disconnect(); unsub?.(); chart.remove(); chartRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync]);

  useEffect(() => { chartRef.current?.applyOptions({ height }); }, [height]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    for (const s of seriesRef.current) { try { chart.removeSeries(s); } catch { /* already gone */ } }
    seriesRef.current = [];
    let anchor = null, anchorData = null;
    for (const spec of series || []) {
      if (!spec || !spec.data?.length) continue;
      const s = chart.addSeries(TYPES[spec.type || "line"], { priceLineVisible: false, lastValueVisible: true, ...spec.options }, spec.pane || 0);
      s.setData(spec.data);
      for (const pl of spec.priceLines || []) s.createPriceLine({ lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, ...pl });
      if (spec.markers?.length) createSeriesMarkers(s, spec.markers);
      seriesRef.current.push(s);
      if (!anchor) { anchor = s; anchorData = spec.data; }
    }
    chart.priceScale("right").applyOptions({ mode: logScale ? 1 : 0, ...(scaleMargins ? { scaleMargins } : {}) });
    if (memberRef.current && anchor) {
      const times = anchorData.map((d) => d.time);
      memberRef.current.valueAt = (t) => {
        let lo = 0, hi = times.length - 1, k = -1;
        while (lo <= hi) { const mid = (lo + hi) >> 1; if (times[mid] <= t) { k = mid; lo = mid + 1; } else hi = mid - 1; }
        if (k < 0) return null;
        const d = anchorData[k];
        return { time: d.time, value: d.value ?? d.close, series: anchor };
      };
    }
    const vk = rangeKey != null ? `k:${rangeKey}` : anchorData ? `d:${anchorData[0].time}|${anchorData.at(-1).time}|${anchorData.length}` : "";
    if (seriesRef.current.length && viewKey.current !== vk) {
      viewKey.current = vk;
      const apply = () => {
        if (chartRef.current !== chart) return;
        if (visibleRange) { try { chart.timeScale().setVisibleRange(visibleRange); } catch { /* no data */ } }
        else if (fit) chart.timeScale().fitContent();
      };
      apply();
      // autoSize measures the container after layout; re-apply once it has its real width
      setTimeout(apply, 60);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, logScale, rangeKey]);

  return <div ref={el} className="chartbox" style={{ height }} />;
}

/** Convert parallel arrays to line data, dropping nulls. */
export function lineData(times, values) {
  const out = [];
  for (let i = 0; i < times.length; i++) { const v = values[i]; if (v != null && Number.isFinite(v)) out.push({ time: times[i], value: v }); }
  return out;
}
export function candleData(b) {
  const out = [];
  for (let i = 0; i < b.time.length; i++) out.push({ time: b.time[i], open: b.open[i], high: b.high[i], low: b.low[i], close: b.close[i] });
  return out;
}
export const PALETTE = ["#14a44d", "#2563eb", "#d97706", "#db2777", "#7c3aed", "#0891b2", "#65a30d", "#dc2626", "#ca8a04", "#4f46e5", "#0d9488", "#9333ea", "#ea580c", "#475569"];
