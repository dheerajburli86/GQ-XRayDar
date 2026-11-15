import { CHART_TFS } from "../../engine/calendar.js";
// Chart lab (features 1.3-1.9, 4.4, 5.4, 6.8): one instrument with
//   chart styles   candles, Heikin-Ashi, line, Renko, Kagi, Point & Figure
//   overlays       EMA 20/50/200, MMA groups, support/resistance, compare line,
//                  busiest price levels (volume profile)
//   panes          volume, RSI (+ RSI of RSI), MACD
//   drawing        trend line, horizontal line, channel, text note (saved per stock)
//   explain        a plain-English read of the chart; ask the GQ Agent about it
//   export         PNG, PDF; notes saved next to the chart
// Everything shown is computed by the engine from stored prices.
import { useEffect, useMemo, useRef, useState } from "react";
import { createChart, CandlestickSeries, LineSeries, HistogramSeries, createSeriesMarkers, LineStyle } from "lightweight-charts";
import { useData } from "../data/store.jsx";
import { useAsync } from "../lib/useAsync.js";
import { navigate } from "../lib/router.js";
import { PageHead, Seg, Check, Loading, Badge, Empty } from "../components/ui.jsx";
import { InstrumentPicker } from "../components/pickers.jsx";
import { loadInstrument } from "../lib/series.js";
import { aggregate, emaStrict, rsi, macd } from "../../engine/indicators.js";
import { heikinAshi, supportResistance, renko, kagi, pointFigure, volumeProfile } from "../../engine/chartTools.js";
import { candlePatternsAt, CANDLE_PATTERNS } from "../../engine/candles.js";
import { describeChart } from "../../engine/chartRead.js";
import { usePersistent, uid } from "../lib/storage.js";
import { NoteBox } from "./Notes.jsx";
import { setAgentContext, openAgent } from "../components/AgentPanel.jsx";
import { downloadBlob } from "../lib/exporters.js";

const UP = "#16a34a", DOWN = "#dc2626";
const STYLES = [["candles", "Candles"], ["ha", "Heikin-Ashi"], ["line", "Line"], ["renko", "Renko"], ["kagi", "Kagi"], ["pnf", "Point & Figure"]];
const TIME_STYLES = new Set(["candles", "ha", "line"]);
const DEFAULT_VIEW = { tf: "D", style: "candles", ema: true, mma: false, sr: true, vp: false, vol: true, rsi: true, macd: false, cmp: null };

function themeOpts() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim() || undefined;
  return { layout: { background: { color: "transparent" }, textColor: v("--chart-text"), fontFamily: v("--font"), fontSize: 11, attributionLogo: false, panes: { separatorColor: v("--line") } },
    grid: { vertLines: { color: v("--chart-grid") }, horzLines: { color: v("--chart-grid") } }, rightPriceScale: { borderColor: v("--line") }, timeScale: { borderColor: v("--line"), rightOffset: 6, minBarSpacing: 0.05 }, crosshair: { mode: 0 } };
}
const L = (time, vals) => { const out = []; for (let i = 0; i < time.length; i++) if (vals[i] != null && Number.isFinite(vals[i])) out.push({ time: time[i], value: vals[i] }); return out; };

export default function ChartLab({ route }) {
  const d = useData();
  const first = useMemo(() => [...d.rows].sort((a, b) => (b.sec.capUsdNow || 0) - (a.sec.capUsdNow || 0))[0]?.id, [d.rows]);
  const id = route.args[0] || first;
  const sec = d.secById.get(id);
  const [view, setView] = usePersistent("chartlab", DEFAULT_VIEW);
  const v = { ...DEFAULT_VIEW, ...view };
  const set = (patch) => setView({ ...v, ...patch });
  const [allDrawings, setAllDrawings] = usePersistent("drawings", {});
  const drawings = allDrawings[id] || [];
  const setDrawings = (list) => setAllDrawings({ ...allDrawings, [id]: list });
  const [tool, setTool] = useState("none");
  const [explain, setExplain] = useState(null);
  const chartRef = useRef(null);

  const { data, loading } = useAsync(async () => {
    if (!id) return null;
    const [inst, snap, cmp] = await Promise.all([loadInstrument(d.api, { kind: "sec", id }, d), d.api.snapshot(id), v.cmp ? loadInstrument(d.api, v.cmp, d) : null]);
    return { inst, snap, cmp };
  }, [id, v.cmp?.id, v.cmp?.key]);

  const bars = useMemo(() => (data?.inst ? aggregate({ ...data.inst, volume: data.inst.volume || data.inst.close.map(() => 0) }, v.tf) : null), [data, v.tf]);
  const levels = useMemo(() => (bars && v.sr ? supportResistance(bars, { lookback: v.tf === "D" ? 250 : 150 }) : []), [bars, v.sr, v.tf]);
  const lastPatterns = useMemo(() => (bars ? candlePatternsAt(bars, bars.time.length - 1).map((p) => CANDLE_PATTERNS[p]) : []), [bars]);

  useEffect(() => { if (sec) setAgentContext({ page: "chart", instrumentId: id, symbol: sec.symbol, name: sec.name, tf: v.tf, view: STYLES.find((s) => s[0] === v.style)?.[1] }); return () => setAgentContext(null); }, [id, sec, v.tf, v.style]);
  useEffect(() => { setExplain(null); }, [id, v.tf]);

  if (!sec) return <Empty>Pick a stock to chart.</Empty>;
  const timeStyle = TIME_STYLES.has(v.style);

  const doExplain = () => {
    if (!data?.snap || !data?.inst) return;
    const tfs = [...new Set([v.tf, "D", "W", "M"].filter((t) => data.snap.snap.tf[t]))].slice(0, 3);
    setExplain(describeChart({ sec, snap: data.snap.snap, bars: data.inst, tfs, mode: STYLES.find((s) => s[0] === v.style)?.[1] }));
  };
  const png = () => {
    const c = chartRef.current?.takeScreenshot?.();
    if (!c) return;
    c.toBlob((b) => downloadBlob(b, `${sec.symbol}_${v.tf}_${bars?.time.at(-1)}.png`));
  };
  const pdf = async () => {
    const c = chartRef.current?.takeScreenshot?.();
    if (!c) return;
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    const W = doc.internal.pageSize.getWidth();
    doc.setFontSize(14); doc.text(`${sec.symbol} · ${sec.name}`, 30, 32);
    doc.setFontSize(9); doc.text(`${sec.country} · ${sec.sector} · ${v.tf} · ${STYLES.find((s) => s[0] === v.style)?.[1]} · data to ${bars?.time.at(-1)} · GQ Technical Analysis`, 30, 46);
    const ratio = c.height / c.width, w = W - 60;
    doc.addImage(c.toDataURL("image/png"), "PNG", 30, 56, w, w * ratio);
    const ex = explain || describeChart({ sec, snap: data.snap.snap, bars: data.inst, tfs: [v.tf], mode: null });
    const lines = doc.splitTextToSize(ex.lines.join("\n\n"), w);
    doc.addPage(); doc.setFontSize(11); doc.text("What the chart shows", 30, 32); doc.setFontSize(9); doc.text(lines, 30, 50);
    doc.text(ex.note, 30, doc.internal.pageSize.getHeight() - 24);
    doc.save(`${sec.symbol}_${v.tf}_${bars?.time.at(-1)}.pdf`);
  };

  return (
    <div className="stack">
      <PageHead title={`${sec.symbol} · ${sec.name}`} sub={`${sec.country} · ${sec.sector}${sec.assetClass !== "Stock" ? ` · ${sec.assetClass}` : ""} · chart lab: styles, levels, drawings, compare and a plain-English read`}>
        <InstrumentPicker allowIndex={false} value={{ label: `${sec.symbol} · ${sec.name}` }} onChange={(r) => r.kind === "sec" && navigate(`chart/${r.id}`)} width={240} />
        <a className="btn sm" href={`#/stock/${id}`}>Stock page</a>
      </PageHead>
      <div className="card tight">
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          <Seg value={v.tf} options={CHART_TFS} onChange={(tf) => set({ tf })} title="Candle period" />
          <Seg value={v.style} options={STYLES.map(([value, label]) => ({ value, label }))} onChange={(style) => set({ style })} />
          <span className="sep" />
          <Check checked={v.ema} onChange={(x) => set({ ema: x })}>EMA 20/50/200</Check>
          <Check checked={v.mma} onChange={(x) => set({ mma: x })}>MMA groups</Check>
          <Check checked={v.sr} onChange={(x) => set({ sr: x })}>Key levels</Check>
          <Check checked={v.vp} onChange={(x) => set({ vp: x })}>Busiest prices</Check>
          <span className="sep" />
          <Check checked={v.vol} onChange={(x) => set({ vol: x })}>Volume</Check>
          <Check checked={v.rsi} onChange={(x) => set({ rsi: x })}>RSI</Check>
          <Check checked={v.macd} onChange={(x) => set({ macd: x })}>MACD</Check>
        </div>
        <div className="row" style={{ flexWrap: "wrap", gap: 8, marginTop: 8 }}>
          <span className="small muted">Compare with</span>
          <InstrumentPicker value={v.cmp} onChange={(r) => set({ cmp: r })} width={220} placeholder="Index or stock…" />
          {v.cmp && <button className="btn sm ghost" onClick={() => set({ cmp: null })}>✕</button>}
          <button className="btn sm" onClick={() => set({ cmp: { kind: "index", key: `CW|LCL|C:${sec.country}`, label: `${sec.country} CW (local)` } })}>vs its market</button>
          <span className="sep" />
          <span className="small muted">Draw</span>
          <Seg value={tool} options={[{ value: "none", label: "Off" }, { value: "trend", label: "Trend line" }, { value: "hline", label: "Horizontal" }, { value: "channel", label: "Channel" }, { value: "note", label: "Note" }]} onChange={setTool} />
          {drawings.length > 0 && <button className="btn sm ghost" onClick={() => setDrawings(drawings.slice(0, -1))} title="Undo last drawing">↶</button>}
          {drawings.length > 0 && <button className="btn sm ghost" onClick={() => confirm("Remove every drawing on this chart?") && setDrawings([])}>Clear</button>}
          <span className="sep" />
          <button className="btn sm primary" onClick={doExplain}>Explain this chart</button>
          <button className="btn sm" onClick={() => openAgent(`Read the ${v.tf === "W" ? "weekly" : v.tf === "M" ? "monthly" : "daily"} chart of ${sec.symbol} and explain what it shows`, { page: "chart", instrumentId: id, symbol: sec.symbol, tf: v.tf })}>Ask GQ Agent</button>
          <button className="btn sm" onClick={png}>PNG</button>
          <button className="btn sm" onClick={pdf}>PDF</button>
        </div>
        {tool !== "none" && !timeStyle && <div className="note small" style={{ marginTop: 6 }}>Drawings work on Candles, Heikin-Ashi and Line.</div>}
        {tool !== "none" && timeStyle && <div className="small muted" style={{ marginTop: 6 }}>{tool === "trend" ? "Click two points." : tool === "hline" ? "Click a price." : tool === "channel" ? "Click two points for the line, then a third for the parallel." : "Click where the note goes."}</div>}
      </div>
      {loading || !bars ? <Loading what="prices" /> : (
        <div className="card" style={{ padding: 6, position: "relative" }}>
          <ChartCanvas key={`${id}|${v.style}`} bars={bars} v={v} levels={levels} cmp={data.cmp} drawings={timeStyle ? drawings : []} tool={timeStyle ? tool : "none"}
            onDraw={(dw) => setDrawings([...drawings, { id: uid(), ...dw }])} onChart={(c) => { chartRef.current = c; }} />
          <div className="row small" style={{ gap: 8, marginTop: 4, flexWrap: "wrap" }}>
            <span className="muted">{bars.time.length} candles · {bars.time[0]} → {bars.time.at(-1)}</span>
            {lastPatterns.filter((p) => p.dir !== 0).map((p) => <Badge key={p.label} kind={p.dir > 0 ? "g" : "r"}>{p.label}</Badge>)}
            {levels.map((l) => <Badge key={l.kind + l.price} kind={l.kind === "support" ? "g" : "r"}>{l.kind} {l.price.toFixed(2)} · {l.touches}×</Badge>)}
            {v.cmp && <span className="muted">Compare line rebased to {sec.symbol}'s first close in view</span>}
          </div>
        </div>
      )}
      {explain && (
        <div className="card brief">
          <div className="row" style={{ justifyContent: "space-between" }}><h3>What the chart shows · data to {explain.asOf}</h3><button className="btn sm ghost" onClick={() => setExplain(null)}>✕</button></div>
          {explain.lines.map((l, i) => <p key={i}>{l}</p>)}
          <div className="small muted">{explain.note}</div>
        </div>
      )}
      <div className="card"><h3>Notes on {sec.symbol}</h3><NoteBox target={`sec:${id}`} label={sec.symbol} /></div>
    </div>
  );
}

/** The chart itself. Re-created when the instrument or style changes; series are rebuilt on option changes. */
function ChartCanvas({ bars, v, levels, cmp, drawings, tool, onDraw, onChart }) {
  const el = useRef(null), chartRef = useRef(null), mainRef = useRef(null), seriesRef = useRef([]), pending = useRef([]);
  const toolRef = useRef(tool), onDrawRef = useRef(onDraw);
  useEffect(() => { toolRef.current = tool; onDrawRef.current = onDraw; });
  const [vpBars, setVpBars] = useState([]);
  const timeStyle = TIME_STYLES.has(v.style);
  const panes = (v.vol && timeStyle ? 1 : 0) + (v.rsi ? 1 : 0) + (v.macd ? 1 : 0);
  const height = 430 + panes * 110;

  useEffect(() => {
    const chart = createChart(el.current, { ...themeOpts(), autoSize: true, height });
    chartRef.current = chart;
    onChart?.(chart);
    if (!timeStyle) chart.applyOptions({ timeScale: { visible: false }, localization: { timeFormatter: () => "" } });
    const mo = new MutationObserver(() => chart.applyOptions(themeOpts()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const onClick = (p) => {
      const t = toolRef.current;
      if (t === "none" || !p.point || p.time == null || !mainRef.current) return;
      const price = mainRef.current.coordinateToPrice(p.point.y);
      if (price == null) return;
      const pt = { time: p.time, price: +price.toFixed(4) };
      if (t === "hline") return onDrawRef.current({ type: "hline", a: pt });
      if (t === "note") { const text = prompt("Note text"); if (text) onDrawRef.current({ type: "note", a: pt, text: text.slice(0, 60) }); return; }
      pending.current.push(pt);
      const need = t === "channel" ? 3 : 2;
      if (pending.current.length >= need) { const [a, b, c] = pending.current; pending.current = []; if (a.time !== b.time) onDrawRef.current({ type: t, a, b, c }); }
    };
    // a quick second click arrives as a double-click, not a click
    chart.subscribeClick(onClick);
    chart.subscribeDblClick(onClick);
    return () => { mo.disconnect(); chart.remove(); chartRef.current = null; onChart?.(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { pending.current = []; }, [tool]);
  useEffect(() => { chartRef.current?.applyOptions({ height }); }, [height]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    for (const s of seriesRef.current) { try { chart.removeSeries(s); } catch { /* gone */ } }
    seriesRef.current = [];
    const add = (type, data, opts = {}, pane = 0) => { if (!data.length) return null; const s = chart.addSeries(type, { priceLineVisible: false, lastValueVisible: false, ...opts }, pane); s.setData(data); seriesRef.current.push(s); return s; };
    const t = bars.time;
    let main = null, pane = 0;

    if (timeStyle) {
      const src = v.style === "ha" ? heikinAshi(bars) : bars;
      main = v.style === "line"
        ? add(LineSeries, L(t, bars.close), { color: "#e5e7eb", lineWidth: 2, lastValueVisible: true })
        : add(CandlestickSeries, t.map((x, i) => ({ time: x, open: src.open[i], high: src.high[i], low: src.low[i], close: src.close[i] })), { upColor: UP, downColor: DOWN, borderVisible: false, wickUpColor: UP, wickDownColor: DOWN, lastValueVisible: true });
      if (v.ema) [[20, "#22d3ee"], [50, "#14a44d"], [200, "#d97706"]].forEach(([n, c]) => add(LineSeries, L(t, emaStrict(bars.close, n)), { color: c, lineWidth: 1, title: `EMA${n}` }));
      if (v.mma) { [3, 5, 8, 10, 12, 15].forEach((n) => add(LineSeries, L(t, emaStrict(bars.close, n)), { color: "#facc15", lineWidth: 1 })); [30, 35, 40, 45, 50, 60].forEach((n) => add(LineSeries, L(t, emaStrict(bars.close, n)), { color: "#ef4444", lineWidth: 1 })); }
      if (cmp?.close?.length) {
        const idx = new Map(cmp.time.map((x, i) => [x, i]));
        const cb = aggregate({ time: cmp.time, open: cmp.close, high: cmp.close, low: cmp.close, close: cmp.close, volume: cmp.close.map(() => 0) }, v.tf);
        const cm = new Map(cb.time.map((x, i) => [x, cb.close[i]]));
        const firstT = t.find((x) => cm.has(x));
        if (firstT && idx) {
          const k = bars.close[t.indexOf(firstT)] / cm.get(firstT);
          add(LineSeries, t.filter((x) => cm.has(x) && x >= firstT).map((x) => ({ time: x, value: cm.get(x) * k })), { color: "#60a5fa", lineWidth: 2, title: (cmp.label || "compare").split(" · ")[0] });
        }
      }
      for (const l of levels) main?.createPriceLine({ price: l.price, color: l.kind === "support" ? UP : DOWN, lineStyle: LineStyle.Dotted, lineWidth: 1, axisLabelVisible: true, title: `${l.kind === "support" ? "S" : "R"} ${l.touches}×` });
      // drawings
      const notes = [];
      for (const dw of drawings) {
        if (dw.type === "hline") main?.createPriceLine({ price: dw.a.price, color: "#f59e0b", lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: "" });
        else if (dw.type === "note") notes.push({ time: dw.a.time, position: "aboveBar", shape: "square", color: "#f59e0b", text: dw.text });
        else if (dw.type === "trend" || dw.type === "channel") {
          const [a, b] = [dw.a, dw.b].sort((x, y) => (x.time < y.time ? -1 : 1));
          const line = (off) => add(LineSeries, [{ time: a.time, value: a.price + off }, { time: b.time, value: b.price + off }], { color: "#f59e0b", lineWidth: 2, crosshairMarkerVisible: false });
          line(0);
          if (dw.type === "channel" && dw.c) {
            // offset of the third point from the line at its own time (linear in index space)
            const ia = t.indexOf(a.time), ib = t.indexOf(b.time), ic = t.indexOf(dw.c.time);
            const atC = ia >= 0 && ib > ia && ic >= 0 ? a.price + ((b.price - a.price) * (ic - ia)) / (ib - ia) : (a.price + b.price) / 2;
            line(dw.c.price - atC);
          }
        }
      }
      if (notes.length && main) createSeriesMarkers(main, notes.sort((x, y) => (x.time < y.time ? -1 : 1)));
      if (v.vol) { pane++; add(HistogramSeries, t.map((x, i) => ({ time: x, value: bars.volume[i] || 0, color: bars.close[i] >= bars.open[i] ? "rgba(22,163,74,.55)" : "rgba(220,38,38,.55)" })), { priceFormat: { type: "volume" }, title: "Volume" }, pane); }
    } else {
      // non-time styles: one point per brick / swing / column on a sequence axis
      const seq = (i) => i + 1;
      if (v.style === "renko") {
        const r = renko(bars);
        main = add(CandlestickSeries, r.bricks.map((b, i) => ({ time: seq(i), open: b.open, high: b.high, low: b.low, close: b.close })), { upColor: UP, downColor: DOWN, borderVisible: false, wickVisible: false, lastValueVisible: true, title: `Renko box ${r.box}` });
      } else if (v.style === "kagi") {
        const k = kagi(bars, 4);
        main = add(LineSeries, k.map((p, i) => ({ time: seq(i), value: p.price, color: p.yang === false ? DOWN : UP })), { lineWidth: 2, lineType: 1, lastValueVisible: true, title: "Kagi 4%" });
      } else {
        const p = pointFigure(bars);
        main = add(CandlestickSeries, p.cols.map((c, i) => ({ time: seq(i), open: c.kind === "X" ? c.from : c.from, close: c.to, high: Math.max(c.from, c.to), low: Math.min(c.from, c.to) })), { upColor: UP, downColor: DOWN, borderVisible: true, borderUpColor: UP, borderDownColor: DOWN, wickVisible: false, lastValueVisible: true, title: `P&F box ${p.box} × ${p.rev}` });
      }
    }
    mainRef.current = main;
    if (v.rsi) {
      pane++;
      const r = rsi(bars.close, 14), rr = rsi(r.map((x) => (x == null ? null : x)), 14);
      const series = timeStyle ? (vals) => L(t, vals) : null;
      if (series) {
        const s = add(LineSeries, series(r), { color: "#a78bfa", lineWidth: 2, title: "RSI 14", lastValueVisible: true }, pane);
        add(LineSeries, series(rr), { color: "#64748b", lineWidth: 1, title: "RSI of RSI" }, pane);
        s?.createPriceLine({ price: 70, color: DOWN, lineStyle: LineStyle.Dashed, lineWidth: 1 }); s?.createPriceLine({ price: 30, color: UP, lineStyle: LineStyle.Dashed, lineWidth: 1 });
      } else pane--;
    }
    if (v.macd && timeStyle) {
      pane++;
      const m = macd(bars.close);
      add(HistogramSeries, L(t, m.hist).map((x) => ({ ...x, color: x.value >= 0 ? UP : DOWN })), { title: "MACD hist" }, pane);
      add(LineSeries, L(t, m.line), { color: "#14a44d", lineWidth: 2, title: "MACD" }, pane);
      add(LineSeries, L(t, m.signal), { color: "#d97706", lineWidth: 1, title: "signal" }, pane);
    }
    const panesNow = chart.panes();
    panesNow.forEach((p, i) => { try { p.setStretchFactor(i === 0 ? 4 : 1); } catch { /* older api */ } });
    const nPts = main ? main.data().length : 0, show = timeStyle ? 400 : 250;
    const fit = () => { if (chartRef.current !== chart) return; if (nPts > show) chart.timeScale().setVisibleLogicalRange({ from: nPts - show, to: nPts + 5 }); else chart.timeScale().fitContent(); };
    fit(); setTimeout(fit, 60);
  }, [bars, v.ema, v.mma, v.vol, v.rsi, v.macd, v.style, levels, cmp, drawings, timeStyle, v.tf]);

  // busiest price levels, drawn as bars against the price axis of the visible window
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !v.vp || !timeStyle) { setVpBars([]); return; }
    const draw = () => {
      const r = chart.timeScale().getVisibleLogicalRange();
      if (!r || !mainRef.current) return;
      const from = Math.max(0, Math.floor(r.from)), to = Math.min(bars.time.length - 1, Math.ceil(r.to));
      const sub = { time: bars.time.slice(from, to + 1), open: bars.open.slice(from, to + 1), high: bars.high.slice(from, to + 1), low: bars.low.slice(from, to + 1), close: bars.close.slice(from, to + 1), volume: bars.volume.slice(from, to + 1) };
      const vp = volumeProfile(sub, { bins: 28 });
      const max = Math.max(...vp.bins.map((b) => b.volume), 1);
      setVpBars(vp.bins.map((b) => {
        const y1 = mainRef.current.priceToCoordinate(b.hi), y2 = mainRef.current.priceToCoordinate(b.lo);
        return y1 == null || y2 == null ? null : { top: Math.min(y1, y2), h: Math.max(1, Math.abs(y2 - y1) - 1), w: (b.volume / max) * 100, poc: b === vp.poc };
      }).filter(Boolean));
    };
    draw();
    chart.timeScale().subscribeVisibleLogicalRangeChange(draw);
    return () => { try { chart.timeScale().unsubscribeVisibleLogicalRangeChange(draw); } catch { /* removed */ } };
  }, [v.vp, bars, timeStyle, v.style, v.vol, v.rsi, v.macd]);

  return (
    <div style={{ position: "relative" }}>
      <div ref={el} className="chartbox" style={{ height, cursor: tool !== "none" ? "crosshair" : undefined }} />
      {vpBars.length > 0 && (
        <div className="vp-overlay" title="Busiest price levels in view: volume traded at each price band">
          {vpBars.map((b, i) => <div key={i} style={{ top: b.top, height: b.h, width: `${b.w}%`, background: b.poc ? "rgba(245,158,11,.45)" : "rgba(96,165,250,.22)" }} />)}
        </div>
      )}
    </div>
  );
}
