// lightweight-charts wrapper. One <TvChart> = one chart instance; charts that
// belong to a ChartSync share horizontal scroll / zoom (by TIME, so a weekly
// and a daily window stay on the same dates) and the crosshair.
import { OhlcvLegend } from "./DataWindow.jsx";
import { reportHover } from "../lib/dataWindow.js";
import { useEffect, useRef, useState } from "react";
import { createChart, CandlestickSeries, BarSeries, LineSeries, HistogramSeries, AreaSeries, createSeriesMarkers, LineStyle } from "lightweight-charts";

const TYPES = { candles: CandlestickSeries, bar: BarSeries, line: LineSeries, histogram: HistogramSeries, area: AreaSeries };

function themeOptions() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim() || undefined;
  return {
    layout: { background: { color: "transparent" }, textColor: v("--chart-text"), fontFamily: v("--font"), fontSize: 11, attributionLogo: false },
    grid: { vertLines: { color: v("--chart-grid") }, horzLines: { color: v("--chart-grid") } },
    rightPriceScale: { borderColor: v("--line") },
    // rightBarStaysOnScroll: zooming with the wheel keeps the latest bar where it is; only a
    // click-and-drag moves the end point (owner, improvements 1)
    timeScale: { borderColor: v("--line"), rightOffset: 4, minBarSpacing: 0.05, rightBarStaysOnScroll: true },
    crosshair: { mode: 0 },
  };
}

/** Shared scroll/zoom/crosshair across charts. */
// chart containers -> chart, so a key press can zoom the chart under the mouse (owner: Z zooms out the window)
const CHART_BY_EL = new WeakMap();
/** Zoom out the chart under (x, y): widens the visible range to the left, the latest bar stays put. */
export function zoomOutAt(x, y, factor = 1.5) {
  if (typeof document === "undefined") return false;
  for (const node of document.elementsFromPoint(x, y)) {
    let n = node;
    while (n && n !== document.body) {
      const chart = CHART_BY_EL.get(n);
      if (chart) {
        try {
          const ts = chart.timeScale(), r = ts.getVisibleLogicalRange();
          if (!r) return false;
          ts.setVisibleLogicalRange({ from: r.to - (r.to - r.from) * factor, to: r.to });
          return true;
        } catch { return false; }
      }
      n = n.parentElement;
    }
  }
  return false;
}

export class ChartSync {
  /** logical: every member draws the SAME timeline (see `timeline` on TvChart), so panes follow each other by bar
   *  position. Time-range sync is wrong there: a pane whose line starts later (RSI warm-up) reports a clipped range
   *  and drags the others with it. */
  constructor({ logical = false } = {}) { this.members = new Set(); this.busy = false; this.logical = logical; }
  add(m) { this.members.add(m); return () => this.members.delete(m); }
  range(src, r) {
    if (this.busy || !r) return;
    this.busy = true;
    for (const m of this.members) if (m !== src) { try { const ts = m.chart.timeScale(); if (this.logical) ts.setVisibleLogicalRange(r); else ts.setVisibleRange(r); } catch { /* chart without data */ } }
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

/**
 * lightweight-charts throws (and takes the page down) on rows out of time order, duplicate
 * times or non-numeric prices. Bad rows are dropped here so one odd bar never blanks a chart.
 */
const num = (v) => typeof v === "number" && Number.isFinite(v);
/** A whitespace point ({time} only) keeps a bar slot on the time axis without drawing anything. */
const isWhite = (d) => d && d.time != null && !("value" in d) && !("open" in d);
const okPoint = (d) => d && d.time != null && (isWhite(d) || ("value" in d ? num(d.value) : num(d.open) && num(d.high) && num(d.low) && num(d.close)));

/** Give a series exactly the bar slots of `timeline` (sorted, a superset of the series' times): whitespace before its
 *  first and after its last point; inside, a missing slot repeats the previous value of a line (a day the other market
 *  was closed) and stays whitespace for candles. */
export function padToTimeline(data, timeline) {
  if (!data.length || !Array.isArray(timeline) || !timeline.length) return data;
  if (timeline.length === data.length && timeline[0] === data[0].time && timeline[timeline.length - 1] === data[data.length - 1].time) return data;
  const out = [];
  let j = 0, prev = null;
  for (const t of timeline) {
    while (j < data.length && data[j].time < t) j++;
    if (j < data.length && data[j].time === t) { prev = data[j]; out.push(data[j]); }
    else if (prev && j < data.length && "value" in prev) out.push({ time: t, value: prev.value });
    else out.push({ time: t });
  }
  // a series with a time outside the timeline cannot be aligned: leave it as it was
  return out.filter((d) => !isWhite(d)).length < data.length ? data : out;
}

export function cleanSeriesData(data) {
  if (!Array.isArray(data) || !data.length) return [];
  let ok = true, prev = null;
  for (const d of data) {
    if (!okPoint(d) || (prev != null && !(d.time > prev))) { ok = false; break; }
    prev = d.time;
  }
  if (ok) return data;
  const rows = data.filter(okPoint);
  rows.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
  const out = [];
  for (const d of rows) { if (out.length && out[out.length - 1].time === d.time) out[out.length - 1] = d; else out.push(d); }
  return out;
}

/**
 * hoverNames: line names are not printed on the price axis; the name of the line under the
 * cursor (nearest within 14 px) shows next to the pointer instead (owner: Weight Watcher).
 */
export function TvChart({ series, height = 300, sync, onReady, logScale = false, scaleMargins, visibleRange, fit = true, rangeKey, theme, hoverNames = false, downloadName, ohlcv = null, legend = false, timeline = null }) {
  const el = useRef(null), chartRef = useRef(null), seriesRef = useRef([]), memberRef = useRef(null), namesRef = useRef(new Map());
  const [hover, setHover] = useState(null);
  // bumped whenever the chart instance is (re)created, e.g. when `sync` changes, so the series
  // are drawn again on the new instance (it starts empty)
  const [gen, setGen] = useState(0);
  const ohlcvRef = useRef(ohlcv);
  useEffect(() => { ohlcvRef.current = ohlcv; });
  const viewKey = useRef(undefined); // the view is set once per rangeKey, so toggling a line never resets the zoom

  useEffect(() => {
    let chart;
    try { chart = createChart(el.current, { ...withTheme(themeOptions(), theme), autoSize: true, height }); }
    catch (e) { console.warn(`[chart] could not start: ${e.message}`); return undefined; }
    chartRef.current = chart;
    CHART_BY_EL.set(el.current, chart);
    if (typeof window !== "undefined" && window.__GQ_TEST_CHARTS) window.__GQ_TEST_CHARTS.push(chart); // headless tests only
    seriesRef.current = [];
    viewKey.current = undefined;
    setGen((g) => g + 1);
    const member = { chart, valueAt: null };
    memberRef.current = member;
    let unsub = null;
    if (sync) {
      unsub = sync.add(member);
      if (sync.logical) chart.timeScale().subscribeVisibleLogicalRangeChange((r) => sync.range(member, r));
      else chart.timeScale().subscribeVisibleTimeRangeChange((r) => sync.range(member, r));
      chart.subscribeCrosshairMove((p) => sync.cross(member, p?.time ?? null));
    }
    onReady?.(chart);
    // report the candle under the cursor to the legend and the Data window (Ctrl+D)
    chart.subscribeCrosshairMove((p) => { if (ohlcvRef.current) reportHover(ohlcvRef.current, p?.time ?? null); });
    if (hoverNames) {
      chart.subscribeCrosshairMove((p) => {
        if (!p?.point || p.time == null) { setHover(null); return; }
        let best = null, bd = 14;
        for (const [s, info] of namesRef.current) {
          const d = p.seriesData.get(s);
          const v = d?.value ?? d?.close;
          if (v == null) continue;
          const y = s.priceToCoordinate(v);
          if (y == null) continue;
          const dist = Math.abs(y - p.point.y);
          if (dist < bd) { bd = dist; best = { ...info, v, x: p.point.x, y }; }
        }
        setHover(best);
      });
    }
    const node = el.current;
    const mo = new MutationObserver(() => { try { chart.applyOptions(withTheme(themeOptions(), theme)); } catch { /* removed */ } });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => { mo.disconnect(); unsub?.(); try { CHART_BY_EL.delete(node); } catch { /* gone */ } try { chart.remove(); } catch { /* already removed */ } chartRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync]);

  useEffect(() => { chartRef.current?.applyOptions({ height }); }, [height]);
  // a theme changed after the chart was made (e.g. Settings -> Colours on the black screens)
  const themeKey = theme ? JSON.stringify(theme, (k, v) => (typeof v === "function" ? undefined : v)) : "";
  useEffect(() => { if (theme) try { chartRef.current?.applyOptions(withTheme(themeOptions(), theme)); } catch { /* removed */ } }, [themeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    for (const s of seriesRef.current) { try { chart.removeSeries(s); } catch { /* already gone */ } }
    seriesRef.current = [];
    namesRef.current = new Map();
    let anchor = null, anchorData = null;
    for (const spec of series || []) {
      if (!spec) continue;
      const clean = cleanSeriesData(spec.data).filter((d) => !isWhite(d));
      if (!clean.length) continue;
      const data = padToTimeline(clean, timeline);
      let s = null;
      try {
        s = chart.addSeries(TYPES[spec.type || "line"] || LineSeries, { priceLineVisible: false, lastValueVisible: true, ...spec.options }, spec.pane || 0);
        s.setData(data);
        for (const pl of spec.priceLines || []) if (num(pl?.price)) s.createPriceLine({ lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, ...pl });
        if (spec.markers?.length) {
          const t0 = clean[0].time, t1 = clean[clean.length - 1].time;
          const mk = spec.markers.filter((m) => m && m.time >= t0 && m.time <= t1).sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
          if (mk.length) createSeriesMarkers(s, mk);
        }
      } catch (e) {
        console.warn(`[chart] series ${spec.id || ""} skipped: ${e.message}`);
        if (s) { try { chart.removeSeries(s); } catch { /* not added */ } }
        continue;
      }
      seriesRef.current.push(s);
      if (spec.name) namesRef.current.set(s, { name: spec.name, color: spec.options?.color });
      if (!anchor) { anchor = s; anchorData = clean; }
    }
    try { chart.priceScale("right").applyOptions({ mode: logScale ? 1 : 0, ...(scaleMargins ? { scaleMargins } : {}) }); } catch { /* no price scale yet */ }
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
        else if (fit) { try { chart.timeScale().fitContent(); } catch { /* removed */ } }
      };
      apply();
      // autoSize measures the container after layout; re-apply once it has its real width
      setTimeout(apply, 60);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, logScale, rangeKey, gen]);

  // every chart carries a small download button (shown on hover; never part of a picture)
  const dl = () => {
    const c = chartRef.current?.takeScreenshot?.();
    if (c) c.toBlob((b) => { if (!b) return; const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `${downloadName || "chart"}_${new Date().toISOString().slice(0, 10)}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); });
  };
  return (
    <div className="tvwrap" style={{ position: "relative" }}>
      <div ref={el} className="chartbox" style={{ height }} />
      {legend && ohlcv && <OhlcvLegend src={ohlcv} />}
      <button className="chart-dl" title="Download this chart (PNG)" onClick={dl} data-html2canvas-ignore>⤓</button>
      {hover && (
        <div className="chart-hover" style={{ left: hover.x + 12, top: Math.max(0, hover.y - 22), borderColor: hover.color }}>
          <span style={{ color: hover.color }}>●</span> {hover.name} <b>{Number(hover.v).toFixed(Math.abs(hover.v) < 10 ? 3 : 2)}</b>
        </div>
      )}
    </div>
  );
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
