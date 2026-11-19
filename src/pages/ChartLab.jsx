// Chart lab (features 1.3-1.9, 4.4, 5.4, 6.8): one instrument with
//   chart styles   candles, Heikin-Ashi, line, Renko, Kagi, Point & Figure
//   overlays       EMA 20/50/200, MMA groups, support/resistance, compare line,
//                  busiest price levels (volume profile)
//   panes          volume, RSI (+ RSI of RSI), MACD
//   drawing        trend line, horizontal line, channel, text note (saved per stock)
//   explain        a plain-English read of the chart; ask the GQ Agent about it
//   export         PNG, PDF; notes saved next to the chart
// Everything shown is computed by the engine from stored prices.
import { isHidden } from "../lib/features.js";
import { OhlcvLegend } from "../components/DataWindow.jsx";
import { reportHover } from "../lib/dataWindow.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { createChart, CandlestickSeries, BarSeries, LineSeries, HistogramSeries, createSeriesMarkers, LineStyle } from "lightweight-charts";
import { useData } from "../data/store.jsx";
import { useAsync } from "../lib/useAsync.js";
import { navigate } from "../lib/router.js";
import { PageHead, Seg, Check, Loading, Badge, Empty } from "../components/ui.jsx";
import { InstrumentPicker, TfPicker } from "../components/pickers.jsx";
import { loadInstrument } from "../lib/series.js";
import { aggregate, emaStrict, rsi, macd } from "../../engine/indicators.js";
import { heikinAshi, supportResistance, renko, kagi, pointFigure, volumeProfile, fibonacci, valueArea } from "../../engine/chartTools.js";
import { chartPatterns } from "../../engine/patterns.js";
import { countryFamily } from "../../engine/geography.js";
import { getDerivApi } from "../data/derivApi.js";
import { NSE_INDEX_UNDERLYINGS } from "../../engine/deriv/nse.js";
import { candlePatternsAt, CANDLE_PATTERNS } from "../../engine/candles.js";
import { describeChart } from "../../engine/chartRead.js";
import { usePersistent, uid } from "../lib/storage.js";
import { NoteBox } from "./Notes.jsx";
import { setAgentContext, openAgent } from "../components/AgentPanel.jsx";
import { downloadBlob } from "../lib/exporters.js";
import { cleanSeriesData } from "../components/TvChart.jsx";
import { QuickTicker } from "../components/QuickTicker.jsx";
import { useChartKeys } from "../lib/chartKeys.js";
import { useLastInstrument } from "../lib/instruments.js";
import { priceSeries } from "../lib/chartStyle.js";
import { Tabs } from "../components/ui.jsx";
import { StudiesPanel, FormulaPanel, DrawingsPanel, ProjectionPanel, ReplayPanel, SeasonalityPanel, TpoView, ConfluencePanel, EventsPanel, eventColor } from "../components/ChartLabPanels.jsx";
import { studyOverlays, drawingOverlays, formulaOverlays, projectionOverlays, indexAt } from "../lib/chartOverlays.js";
import { DRAW_TOOLS } from "../../engine/drawings.js";
import { evalFormula } from "../../engine/formula.js";
import { seasonality, seasonalOverlay } from "../../engine/seasonality.js";
import { rsc } from "../../engine/indicators.js";
import { alignCurrency } from "../lib/series.js";
import { rowRankCmp } from "../../engine/turnover.js";

const UP = "#16a34a", DOWN = "#dc2626";
const STYLES = [["candles", "Candles"], ["ha", "Heikin-Ashi"], ["line", "Line"], ["bar", "Bars"], ["renko", "Renko"], ["kagi", "Kagi"], ["pnf", "Point & Figure"], ["tpo", "Market profile"]];
const TIME_STYLES = new Set(["candles", "ha", "line", "bar"]);
const DEFAULT_VIEW = { tf: "D", style: "candles", ema: true, mma: false, sr: true, vp: false, vol: true, rsi: true, macd: false, cmp: null, fib: false, pat: true, fo: true, studies: {} };

/** F&O underlying for a security (NSE stock symbol, or the index an NSE index contract tracks). */
function foUnderlying(sec) {
  if (!sec) return null;
  if (sec.universe === "india_stocks") return String(sec.symbol).replace(/-(EQ|BE|BZ|ST|SM)$/, "");
  if (sec.universe === "india_indices") { const e = Object.entries(NSE_INDEX_UNDERLYINGS).find(([, v]) => v.toUpperCase() === String(sec.symbol).toUpperCase()); return e ? e[0] : null; }
  return null;
}

function themeOpts() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim() || undefined;
  return { layout: { background: { color: "transparent" }, textColor: v("--chart-text"), fontFamily: v("--font"), fontSize: 11, attributionLogo: false, panes: { separatorColor: v("--line") } },
    grid: { vertLines: { color: v("--chart-grid") }, horzLines: { color: v("--chart-grid") } }, rightPriceScale: { borderColor: v("--line") }, timeScale: { borderColor: v("--line"), rightOffset: 6, minBarSpacing: 0.05, rightBarStaysOnScroll: true }, crosshair: { mode: 0 } };
}
const L = (time, vals) => { const out = []; for (let i = 0; i < time.length; i++) if (vals[i] != null && Number.isFinite(vals[i])) out.push({ time: time[i], value: vals[i] }); return out; };

export default function ChartLab({ route }) {
  const d = useData();
  const first = useMemo(() => [...d.rows].sort(rowRankCmp)[0]?.id, [d.rows]);
  const [lastInst, setLastInst] = useLastInstrument();
  const lastSecId = lastInst?.startsWith("s:") ? lastInst.slice(2) : null;
  const id = route.args[0] || (lastSecId && d.secById.has(lastSecId) ? lastSecId : null) || first;
  const sec = d.secById.get(id);
  useEffect(() => { if (id && lastInst !== `s:${id}`) setLastInst(`s:${id}`); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [picking, setPicking] = useState(null);
  const [view, setView] = usePersistent("chartlab", DEFAULT_VIEW);
  const v = { ...DEFAULT_VIEW, ...view };
  const set = (patch) => setView({ ...v, ...patch });
  useChartKeys({ onTf: (tf) => set({ tf }), onSearch: (ch) => setPicking({ initial: ch }) });
  const [allDrawings, setAllDrawings] = usePersistent("drawings", {});
  const drawings = useMemo(() => allDrawings[id] || [], [allDrawings, id]);
  const setDrawings = (list) => setAllDrawings({ ...allDrawings, [id]: list });
  const [tool, setTool] = useState("none");
  const [explain, setExplain] = useState(null);
  const chartRef = useRef(null);

  const { data, loading } = useAsync(async () => {
    if (!id) return null;
    const [inst, snap, cmp] = await Promise.all([loadInstrument(d.api, { kind: "sec", id }, d), d.api.snapshot(id), v.cmp ? loadInstrument(d.api, v.cmp, d) : null]);
    const aligned = inst && cmp ? await alignCurrency(d.api, inst, cmp) : null;
    return { inst, snap, cmp, aligned };
  }, [id, v.cmp?.id, v.cmp?.key]);

  const fullBars0 = useMemo(() => (data?.inst ? aggregate({ ...data.inst, volume: data.inst.volume || data.inst.close.map(() => 0) }, v.tf) : null), [data, v.tf]);
  // relative strength vs the "Compare with" series on these candles (formula name: rsc)
  const fullBars = useMemo(() => {
    if (!fullBars0 || !data?.aligned || !data?.cmp) return fullBars0;
    const r = rsc(data.inst.time, data.aligned.a, data.cmp.time, data.aligned.b, v.tf, 100);
    const m = new Map(r.time.map((t, i) => [t, r.value[i]]));
    return { ...fullBars0, rsc: fullBars0.time.map((t) => m.get(t) ?? null) };
  }, [fullBars0, data, v.tf]);
  // bar replay: everything after the replay point is hidden
  const [replay, setReplay] = useState(null);
  useEffect(() => { setReplay(null); }, [id, v.tf]);
  useEffect(() => {
    if (!replay?.playing || !fullBars) return undefined;
    const h = setInterval(() => setReplay((r) => (r && r.playing ? (r.idx >= fullBars.time.length - 1 ? { ...r, playing: false } : { ...r, idx: r.idx + 1 }) : r)), 1000 / (replay.speed || 1));
    return () => clearInterval(h);
  }, [replay?.playing, replay?.speed, fullBars]);
  const bars = useMemo(() => {
    if (!fullBars || !replay) return fullBars;
    const k = replay.idx + 1, cut = (a) => (Array.isArray(a) ? a.slice(0, k) : a);
    return { ...fullBars, time: cut(fullBars.time), open: cut(fullBars.open), high: cut(fullBars.high), low: cut(fullBars.low), close: cut(fullBars.close), volume: cut(fullBars.volume), rsc: cut(fullBars.rsc) };
  }, [fullBars, replay?.idx]); // eslint-disable-line react-hooks/exhaustive-deps
  const [customs, setCustoms] = usePersistent("customIndicators", []);
  const [allProj, setAllProj] = usePersistent("projections", {});
  const projs = useMemo(() => allProj[id] || [], [allProj, id]);
  const setProjs = (list) => setAllProj({ ...allProj, [id]: list });
  const [seasonOn, setSeasonOn] = useState(false);
  // events typed in by the user (no calendar feed): per instrument, or on every chart
  const [allEvents, setAllEvents] = usePersistent("events", {});
  const events = useMemo(() => allEvents[id] || [], [allEvents, id]);
  const setEvents = (list) => setAllEvents({ ...allEvents, [id]: list });
  const everyEvents = useMemo(() => Object.values(allEvents).flat().filter((e) => e.all), [allEvents]);
  const [toolTab, setToolTab] = usePersistent("chartlab.toolTab", "studies");
  const [scan, setScan] = useState(null);
  const overlays = useMemo(() => {
    if (!bars || !TIME_STYLES.has(v.style)) return null;
    const so = studyOverlays(bars, v.studies, v.tf), dw = drawingOverlays(bars, drawings), fo = formulaOverlays(bars, customs), pj = projectionOverlays(bars, projs, v.tf);
    const price = [...so.price, ...dw.price, ...fo.price, ...pj.price];
    if (seasonOn && data?.inst) {
      const s = seasonality(data.inst.time, data.inst.close);
      const y = bars.time.at(-1).slice(0, 4), i0 = bars.time.findIndex((t) => t >= `${y}-01-01`);
      if (s.path.length && i0 >= 0) price.push({ type: "line", data: seasonalOverlay(s.path, `${y}-01-01`, bars.close[Math.max(0, i0 - 1)]), options: { color: "#c084fc", lineWidth: 2, lineStyle: 2, title: `seasonal (${s.years}y avg)`, lastValueVisible: false, priceLineVisible: false } });
    }
    const evMarks = [...events, ...everyEvents.filter((e) => !events.some((x) => x.id === e.id))].filter((e) => e.date >= bars.time[0] && e.date <= bars.time.at(-1))
      .map((e) => ({ time: bars.time[indexAt(bars.time, e.date)], position: "aboveBar", shape: "circle", color: eventColor(e.kind), text: e.label.slice(0, 18) }));
    const markers = [...dw.markers, ...fo.markers, ...evMarks, ...(replay?.trades || []).map((t) => ({ time: t.date, position: t.side === "buy" ? "belowBar" : "aboveBar", shape: t.side === "buy" ? "arrowUp" : "arrowDown", color: t.side === "buy" ? "#16a34a" : "#dc2626", text: `${t.side} ${t.price.toFixed(2)}` }))];
    return { price, panes: [...so.panes, ...fo.panes], markers, levels: [...so.levels, ...dw.levels, ...pj.levels], notes: [...so.notes, ...dw.notes], errors: fo.errors, projections: pj.results };
  }, [bars, v.style, v.studies, v.tf, drawings, customs, projs, seasonOn, data, replay?.trades, events, everyEvents]);
  const levels = useMemo(() => (bars && v.sr ? supportResistance(bars, { lookback: v.tf === "D" ? 250 : 150 }) : []), [bars, v.sr, v.tf]);
  const lastPatterns = useMemo(() => (bars ? candlePatternsAt(bars, bars.time.length - 1).map((p) => CANDLE_PATTERNS[p]) : []), [bars]);
  const fib = useMemo(() => (bars && v.fib ? fibonacci(bars, { lookback: v.tf === "D" ? 250 : 120 }) : null), [bars, v.fib, v.tf]);
  const patterns = useMemo(() => (bars && v.pat ? chartPatterns(bars) : []), [bars, v.pat]);
  const und = foUnderlying(sec);
  const foStats = useAsync(async () => { if (!und || !v.fo) return null; const h = await getDerivApi().history(und); return h?.at(-1) || null; }, [und, v.fo]);
  const foLevels = useMemo(() => { const s = foStats.data; if (!s) return []; return [["Call OI wall", s.callWall, "#dc2626"], ["Put OI wall", s.putWall, "#16a34a"], ["Max pain", s.maxPain, "#a78bfa"], ["Gamma flip (est.)", s.gammaFlip, "#f59e0b"]].filter((x) => x[1] > 0).map(([title, price, color]) => ({ title, price, color, asOf: s.date })); }, [foStats.data]);
  const extraLines = useMemo(() => [...(fib ? fib.levels.map((l) => ({ price: l.price, color: l.kind === "extension" ? "#94a3b8" : "#38bdf8", title: `Fib ${(l.ratio * 100).toFixed(1)}%` })) : []), ...foLevels], [fib, foLevels]);

  useEffect(() => { if (sec) setAgentContext({ page: "chart", instrumentId: id, symbol: sec.symbol, name: sec.name, tf: v.tf, view: STYLES.find((s) => s[0] === v.style)?.[1] }); return () => setAgentContext(null); }, [id, sec, v.tf, v.style]);
  useEffect(() => { setExplain(null); }, [id, v.tf]);

  // an alert from a drawing: a one-instrument custom rule with the drawing's level(s) / line
  const [alertRules, setAlertRules] = usePersistent("alerts.rules", null);
  const [alertMsg, setAlertMsg] = useState(null);
  const alertFromDrawing = (dw, lv) => {
    const last = bars.close.at(-1);
    const conds = lv === "line"
      ? [{ kind: "line", a: dw.a, b: dw.b, side: (() => { const ta = Date.parse(dw.a.time), tb = Date.parse(dw.b.time), tl = Date.parse(bars.time.at(-1)); const at = dw.a.price + ((dw.b.price - dw.a.price) * (tl - ta)) / (tb - ta || 1); return last > at ? "below" : "above"; })(), label: "trend line" }]
      : lv.map((x) => ({ kind: "level", price: +x.price.toFixed(4), side: last > x.price ? "below" : "above", label: x.label }));
    const rule = { id: uid(), name: `${sec.symbol}: ${dw.type === "projection" ? `projection "${dw.name}" target` : DRAW_TOOLS.find((x) => x.value === dw.type)?.label || dw.type} crossed`, template: "custom", match: "any", once: false, conditions: conds, universe: { ids: [id] }, enabled: true };
    setAlertRules([...(alertRules || []), rule]);
    setAlertMsg(`Alert added: ${rule.name} (${conds.length} level${conds.length > 1 ? "s" : ""}; it fires when the close crosses ${conds.length > 1 ? "any of them" : "it"}). Manage it under Alerts → Combination alerts.`);
  };
  // practice order at the latest stored close (the practice portfolio)
  const [paper, setPaper] = usePersistent("paper", { cash: 100000, start: 100000, trades: [], createdAt: new Date().toISOString() });
  const practice = (side) => {
    const r = d.rowById.get(id), n = Math.floor(+prompt(`${side === "buy" ? "Buy" : "Sell"} how many ${sec.symbol} shares at the latest close?`, "10"));
    if (!r?.flat?.closeUsd || !(n > 0)) return;
    const held = paper.trades.filter((t) => t.id === id).reduce((q, t) => q + (t.side === "buy" ? t.qty : -t.qty), 0);
    if (side === "buy" && n * r.flat.closeUsd > paper.cash) { alert("Not enough practice cash."); return; }
    if (side === "sell" && n > held) { alert(`You hold ${held} practice shares.`); return; }
    setPaper({ ...paper, cash: paper.cash + (side === "buy" ? -1 : 1) * n * r.flat.closeUsd, trades: [...paper.trades, { tid: uid(), id, side, qty: n, priceUsd: r.flat.closeUsd, priceLocal: r.flat.close, date: d.info.asOf, at: new Date().toISOString() }] });
    setAlertMsg(`Practice ${side} of ${n} ${sec.symbol} recorded at ${r.flat.close}. See Practice portfolio.`);
  };
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
      {picking && <QuickTicker initial={picking.initial} secOnly onClose={() => setPicking(null)} onPick={(r) => navigate(`chart/${r.id}`)} />}
      <PageHead title={`${sec.symbol} · ${sec.name}`} sub={`${sec.country} · ${sec.sector}${sec.assetClass !== "Stock" ? ` · ${sec.assetClass}` : ""} · chart lab: styles, levels, drawings, compare and a plain-English read`}>
        <InstrumentPicker secOnly value={{ label: `${sec.symbol} · ${sec.name}` }} onChange={(r) => r.kind === "sec" && navigate(`chart/${r.id}`)} width={240} />
        <a className="btn sm" href={`#/stock/${id}`}>Stock page</a>
      </PageHead>
      <div className="card tight">
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          <TfPicker value={v.tf} onChange={(tf) => set({ tf })} />
          <Seg value={v.style} options={STYLES.map(([value, label]) => ({ value, label }))} onChange={(style) => set({ style })} />
          <span className="sep" />
          <Check checked={v.ema} onChange={(x) => set({ ema: x })}>EMA 20/50/200</Check>
          <Check checked={v.mma} onChange={(x) => set({ mma: x })}>MMA groups</Check>
          <Check checked={v.sr} onChange={(x) => set({ sr: x })}>Key levels</Check>
          <Check checked={v.vp} onChange={(x) => set({ vp: x })}>Volume profile (visible range)</Check>
          <Check checked={v.fib} onChange={(x) => set({ fib: x })}>Fibonacci</Check>
          <Check checked={v.pat} onChange={(x) => set({ pat: x })}>Chart patterns</Check>
          {und && <Check checked={v.fo} onChange={(x) => set({ fo: x })}>F&O levels</Check>}
          <span className="sep" />
          <Check checked={v.vol} onChange={(x) => set({ vol: x })}>Volume</Check>
          <Check checked={v.rsi} onChange={(x) => set({ rsi: x })}>RSI</Check>
          <Check checked={v.macd} onChange={(x) => set({ macd: x })}>MACD</Check>
        </div>
        <div className="row" style={{ flexWrap: "wrap", gap: 8, marginTop: 8 }}>
          <span className="small muted">Compare with</span>
          <InstrumentPicker value={v.cmp} onChange={(r) => set({ cmp: r })} width={220} placeholder="Index or stock…" />
          {v.cmp && <button className="btn sm ghost" onClick={() => set({ cmp: null })}>✕</button>}
          <button className="btn sm" onClick={() => set({ cmp: { kind: "index", key: `${countryFamily(sec.country)}|LCL|C:${sec.country}`, label: `${sec.country} ${countryFamily(sec.country)} (local)` } })}>vs its market</button>
          <span className="sep" />
          <span className="small muted">Draw</span>
          <select className="input sm" value={tool} onChange={(e) => setTool(e.target.value)} title="Drawing tools (saved for this instrument)">
            <option value="none">Off</option>
            {DRAW_TOOLS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
          </select>
          {drawings.length > 0 && <button className="btn sm ghost" onClick={() => setDrawings(drawings.slice(0, -1))} title="Undo last drawing">↶</button>}
          {drawings.length > 0 && <button className="btn sm ghost" onClick={() => confirm("Remove every drawing on this chart?") && setDrawings([])}>Clear</button>}
          <span className="sep" />
          <button className="btn sm primary" onClick={doExplain}>Explain this chart</button>
          <button className="btn sm" onClick={() => openAgent(`Read the ${v.tf === "W" ? "weekly" : v.tf === "M" ? "monthly" : "daily"} chart of ${sec.symbol} and explain what it shows`, { page: "chart", instrumentId: id, symbol: sec.symbol, tf: v.tf })}>Ask GQ Agent</button>
          <button className="btn sm" style={{ color: "#16a34a" }} onClick={() => practice("buy")} title="Practice portfolio: buy at the latest close">Practice buy</button>
          <button className="btn sm" style={{ color: "#dc2626" }} onClick={() => practice("sell")} title="Practice portfolio: sell at the latest close">Practice sell</button>
          <button className="btn sm" onClick={png}>PNG</button>
          <button className="btn sm" onClick={pdf}>PDF</button>
        </div>
        {tool !== "none" && !timeStyle && <div className="note small" style={{ marginTop: 6 }}>Drawings work on Candles, Heikin-Ashi and Line.</div>}
        {tool !== "none" && timeStyle && <div className="small muted" style={{ marginTop: 6 }}>{({ trend: "Click two points.", hline: "Click a price.", channel: "Click two points for the line, then a third for the parallel.", note: "Click where the note goes.",
          fib: "Click the start and the end of the move.", fibext: "Click the start and end of the move, then the point to project from.", fibfan: "Click the start and end of the move.", fibarc: "Click the start and end of the move.", fibtime: "Click two candles: their distance is the time unit.",
          pitchfork: "Click the handle, then the two reaction points.", schiff: "Click the handle, then the two reaction points.", modschiff: "Click the handle, then the two reaction points.",
          gannfan: "Click the origin, then a point that sets the 1x1.", ganngrid: "Click two points: span and slope of the grid.", rr: "Click entry, then stop, then target.", measure: "Click two points.",
          avwap: "Click the candle to anchor the VWAP on.", avp: "Click the candle the volume profile starts from." })[tool]}</div>}
      </div>
      {loading || !bars ? <Loading what="prices" /> : v.style === "tpo" ? <div className="card"><TpoView bars={bars} /></div> : (
        <div className="card" style={{ padding: 6, position: "relative" }}>
          <ChartCanvas key={`${id}|${v.style}`} name={sec.symbol} bars={bars} v={v} levels={levels} extraLines={extraLines} patterns={patterns} cmp={data.cmp} drawings={timeStyle ? drawings.filter((x) => !x.hidden) : []} tool={timeStyle ? tool : "none"}
            onDraw={(dw) => setDrawings([...drawings, { id: uid(), ...dw }])} onChart={(c) => { chartRef.current = c; }} extra={overlays} />
          {overlays?.errors?.length > 0 && <div className="note warn small">{overlays.errors.join(" · ")}</div>}
          {replay && <div className="note small">Replay: candles after {bars.time.at(-1)} are hidden.</div>}
          <div className="row small" style={{ gap: 8, marginTop: 4, flexWrap: "wrap" }}>
            <span className="muted">{bars.time.length} candles · {bars.time[0]} → {bars.time.at(-1)}</span>
            {lastPatterns.filter((p) => p.dir !== 0).map((p) => <Badge key={p.label} kind={p.dir > 0 ? "g" : "r"}>{p.label}</Badge>)}
            {levels.map((l) => <Badge key={l.kind + l.price} kind={l.kind === "support" ? "g" : "r"}>{l.kind} {l.price.toFixed(2)} · {l.touches}×</Badge>)}
            {patterns.map((p) => <Badge key={p.key} kind={p.dir > 0 ? "g" : p.dir < 0 ? "r" : ""} title={`${p.start} → ${p.end}${p.level ? ` · level ${p.level.toFixed(2)}` : ""}${p.target ? ` · measured move ${p.target.toFixed(2)}` : ""}`}>{p.label} · {p.status}</Badge>)}
            {foLevels.length > 0 && <span className="muted">F&O levels from the {foLevels[0].asOf} session (OI walls and max pain are exchange OI; gamma flip is a model estimate)</span>}
            {fib && <span className="muted">Fibonacci: {fib.note}</span>}
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
      {fullBars && v.style !== "tpo" && (
        <div className="card">
          <Tabs value={toolTab} onChange={setToolTab} tabs={[{ value: "studies", label: "Indicators" }, { value: "formula", label: `My formulas (${customs.length})` }, { value: "draw", label: `Drawings (${drawings.length})` },
            { value: "proj", label: `Projections (${projs.length})` }, { value: "replay", label: replay ? "Replay ●" : "Replay & practice" }, { value: "season", label: "Seasonality" }, { value: "conf", label: "Confluence" }, ...(isHidden("chartEvents") ? [] : [{ value: "events", label: `Events (${events.length})` }])]} />
          <div style={{ marginTop: 8 }}>
            {toolTab === "studies" && <StudiesPanel studies={v.studies} onChange={(studies) => set({ studies })} />}
            {toolTab === "formula" && <FormulaPanel list={customs} setList={setCustoms} onScan={(f) => setScan({ f })} />}
            {toolTab === "draw" && <DrawingsPanel drawings={drawings} setDrawings={setDrawings} bars={fullBars} sec={sec} notes={overlays?.notes || []} onAlert={alertFromDrawing} />}
            {toolTab === "proj" && <ProjectionPanel list={projs} setList={setProjs} results={overlays?.projections} bars={fullBars} tf={v.tf} onAlert={alertFromDrawing} />}
            {toolTab === "replay" && <ReplayPanel replay={replay} setReplay={setReplay} fullBars={fullBars} sec={sec} />}
            {toolTab === "conf" && <ConfluencePanel snap={data?.snap} />}
            {toolTab === "events" && !isHidden("chartEvents") && <EventsPanel list={events} setList={setEvents} />}
            {toolTab === "season" && <SeasonalityPanel daily={data?.inst} overlay={seasonOn} setOverlay={setSeasonOn} />}
          </div>
          {alertMsg && <div className="note small" style={{ marginTop: 6 }}>{alertMsg}</div>}
        </div>
      )}
      {scan && <FormulaScan f={scan.f} onClose={() => setScan(null)} />}
      <div className="card"><h3>Notes on {sec.symbol}</h3><NoteBox target={`sec:${id}`} label={sec.symbol} /></div>
    </div>
  );
}

/** The chart itself. Re-created when the instrument or style changes; series are rebuilt on option changes. */
function ChartCanvas({ name = "", bars, v, levels, extraLines = [], patterns = [], cmp, drawings, tool, onDraw, onChart, extra = null }) {
  const el = useRef(null), chartRef = useRef(null), mainRef = useRef(null), seriesRef = useRef([]), pending = useRef([]);
  const toolRef = useRef(tool), onDrawRef = useRef(onDraw), srcRef = useRef(null);
  const src = useMemo(() => ({ name, tf: v.tf, bars }), [name, v.tf, bars]);
  useEffect(() => { toolRef.current = tool; onDrawRef.current = onDraw; srcRef.current = src; });
  const [vpBars, setVpBars] = useState([]);
  const [vpInfo, setVpInfo] = useState(null);
  const timeStyle = TIME_STYLES.has(v.style);
  const panes = (v.vol && timeStyle ? 1 : 0) + (v.rsi ? 1 : 0) + (v.macd ? 1 : 0) + (timeStyle ? extra?.panes?.length || 0 : 0);
  const height = 430 + panes * 110;

  useEffect(() => {
    const chart = createChart(el.current, { ...themeOpts(), autoSize: true, height });
    chartRef.current = chart;
    onChart?.(chart);
    if (!timeStyle) chart.applyOptions({ timeScale: { visible: false }, localization: { timeFormatter: () => "" } });
    const mo = new MutationObserver(() => { try { chart.applyOptions(themeOpts()); } catch { /* removed */ } });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const onClick = (p) => {
      const t = toolRef.current;
      if (t === "none" || !p.point || p.time == null || !mainRef.current) return;
      const price = mainRef.current.coordinateToPrice(p.point.y);
      if (price == null) return;
      const pt = { time: p.time, price: +price.toFixed(4) };
      if (t === "hline") return onDrawRef.current({ type: "hline", a: pt });
      if (t === "note") { const text = prompt("Note text"); if (text) onDrawRef.current({ type: "note", a: pt, text: text.slice(0, 60) }); return; }
      const need = DRAW_TOOLS.find((x) => x.value === t)?.clicks || 2;
      if (need === 1) return onDrawRef.current({ type: t, a: pt });
      pending.current.push(pt);
      if (pending.current.length >= need) { const [a, b, c] = pending.current; pending.current = []; if (a.time !== b.time || need === 3) onDrawRef.current({ type: t, a, b, c }); }
    };
    // a quick second click arrives as a double-click, not a click
    chart.subscribeCrosshairMove((p) => { if (srcRef.current) reportHover(srcRef.current, p?.time ?? null); });
    chart.subscribeClick(onClick);
    chart.subscribeDblClick(onClick);
    return () => { mo.disconnect(); try { chart.remove(); } catch { /* already removed */ } chartRef.current = null; onChart?.(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { pending.current = []; }, [tool]);
  useEffect(() => { chartRef.current?.applyOptions({ height }); }, [height]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    for (const s of seriesRef.current) { try { chart.removeSeries(s); } catch { /* gone */ } }
    seriesRef.current = [];
    try {
    const add = (type, raw, opts = {}, pane = 0) => {
      const data = cleanSeriesData(raw);
      if (!data.length) return null;
      let s = null;
      try { s = chart.addSeries(type, { priceLineVisible: false, lastValueVisible: false, ...opts }, pane); s.setData(data); }
      catch (e) { console.warn(`[chart lab] a series was skipped: ${e.message}`); if (s) { try { chart.removeSeries(s); } catch { /* not added */ } } return null; }
      seriesRef.current.push(s); return s;
    };
    const t = bars.time;
    let main = null, pane = 0;

    if (timeStyle) {
      const src = v.style === "ha" ? heikinAshi(bars) : bars;
      main = v.style === "line"
        ? add(LineSeries, priceSeries(t, bars, "line").data, { color: "#e5e7eb", lineWidth: 2, lastValueVisible: true })
        : v.style === "bar" ? add(BarSeries, t.map((x, i) => ({ time: x, open: src.open[i], high: src.high[i], low: src.low[i], close: src.close[i] })), { upColor: UP, downColor: DOWN, lastValueVisible: true })
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
      for (const l of extraLines) main?.createPriceLine({ price: l.price, color: l.color, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: l.title });
      // chart patterns: their pivots as a thin line, the breakout level as a price line
      for (const p of patterns) {
        const pts = p.points.filter((q, i, a) => i === 0 || q.time > a[i - 1].time).map((q) => ({ time: q.time, value: q.price }));
        if (pts.length >= 2) add(LineSeries, pts, { color: p.dir > 0 ? "#4ade80" : p.dir < 0 ? "#f87171" : "#cbd5e1", lineWidth: 1, lineStyle: LineStyle.Dotted, crosshairMarkerVisible: false, title: p.label });
        if (p.level) main?.createPriceLine({ price: p.level, color: p.dir > 0 ? UP : p.dir < 0 ? DOWN : "#94a3b8", lineStyle: LineStyle.SparseDotted, lineWidth: 1, axisLabelVisible: false, title: `${p.label} level` });
      }
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
      // studies, drawing tools, custom formulas, projections and the seasonal path
      if (extra) {
        for (const sp of extra.price || []) add(sp.type === "histogram" ? HistogramSeries : LineSeries, sp.data, sp.options);
        for (const l of extra.levels || []) if (Number.isFinite(l.price)) main?.createPriceLine({ price: l.price, color: l.color, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: l.title || "" });
        notes.push(...(extra.markers || []));
      }
      if (notes.length && main) createSeriesMarkers(main, notes.filter((m) => m.time >= t[0] && m.time <= t[t.length - 1]).sort((x, y) => (x.time < y.time ? -1 : 1)));
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
    if (extra?.panes?.length && timeStyle) {
      for (const pn of extra.panes) {
        pane++;
        let first = null;
        for (const sp of pn.specs) {
          const s = add(sp.type === "histogram" ? HistogramSeries : LineSeries, sp.data, sp.options, pane);
          if (s && !first) first = s;
          for (const pl of sp.priceLines || []) s?.createPriceLine({ lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false, ...pl });
        }
        if (!first) pane--;
      }
    }
    const panesNow = chart.panes();
    panesNow.forEach((p, i) => { try { p.setStretchFactor(i === 0 ? 4 : 1); } catch { /* older api */ } });
    const nPts = main ? main.data().length : 0, show = timeStyle ? 400 : 250;
    const fit = () => { if (chartRef.current !== chart) return; try { if (nPts > show) chart.timeScale().setVisibleLogicalRange({ from: nPts - show, to: nPts + 5 }); else chart.timeScale().fitContent(); } catch { /* chart removed */ } };
    fit(); setTimeout(fit, 60);
    } catch (e) { console.warn(`[chart lab] drawing failed: ${e.message}`); }
  }, [bars, v.ema, v.mma, v.vol, v.rsi, v.macd, v.style, levels, extraLines, patterns, cmp, drawings, timeStyle, v.tf, extra]);

  // busiest price levels, drawn as bars against the price axis of the visible window
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !v.vp || !timeStyle) { setVpBars([]); return; }
    const draw = () => {
      try { drawVp(); } catch (e) { console.warn(`[chart lab] volume profile: ${e.message}`); setVpBars([]); }
    };
    const drawVp = () => {
      const r = chart.timeScale().getVisibleLogicalRange();
      if (!r || !mainRef.current) return;
      const from = Math.max(0, Math.floor(r.from)), to = Math.min(bars.time.length - 1, Math.ceil(r.to));
      const sub = { time: bars.time.slice(from, to + 1), open: bars.open.slice(from, to + 1), high: bars.high.slice(from, to + 1), low: bars.low.slice(from, to + 1), close: bars.close.slice(from, to + 1), volume: bars.volume.slice(from, to + 1) };
      const vp = volumeProfile(sub, { bins: 28 });
      const max = Math.max(...vp.bins.map((b) => b.volume), 1);
      const va = valueArea(vp);
      setVpBars(vp.bins.map((b) => {
        const y1 = mainRef.current.priceToCoordinate(b.hi), y2 = mainRef.current.priceToCoordinate(b.lo);
        return y1 == null || y2 == null ? null : { top: Math.min(y1, y2), h: Math.max(1, Math.abs(y2 - y1) - 1), w: (b.volume / max) * 100, poc: b === vp.poc,
          inVa: va && b.lo >= va.val - 1e-9 && b.hi <= va.vah + 1e-9, hvn: va?.hvn.includes(b), lvn: va?.lvn.includes(b) };
      }).filter(Boolean));
      setVpInfo(va ? `Visible range: POC ${va.poc.toFixed(2)} · value area ${va.val.toFixed(2)} – ${va.vah.toFixed(2)} (${Math.round(va.share * 100)}% of volume) · ${va.hvn.length} high / ${va.lvn.length} low volume nodes` : null);
    };
    draw();
    chart.timeScale().subscribeVisibleLogicalRangeChange(draw);
    return () => { try { chart.timeScale().unsubscribeVisibleLogicalRangeChange(draw); } catch { /* removed */ } };
  }, [v.vp, bars, timeStyle, v.style, v.vol, v.rsi, v.macd]);

  return (
    <div style={{ position: "relative" }}>
      <div ref={el} className="chartbox" style={{ height, cursor: tool !== "none" ? "crosshair" : undefined }} />
      {timeStyle && <OhlcvLegend src={src} />}
      {vpInfo && v.vp && <div className="small muted" style={{ position: "absolute", left: 8, bottom: 2, zIndex: 4 }}>{vpInfo}</div>}
      {vpBars.length > 0 && (
        <div className="vp-overlay" title="Busiest price levels in view: volume traded at each price band">
          {vpBars.map((b, i) => <div key={i} title={b.poc ? "point of control" : b.hvn ? "high volume node" : b.lvn ? "low volume node" : b.inVa ? "value area" : ""} style={{ top: b.top, height: b.h, width: `${b.w}%`, background: b.poc ? "rgba(245,158,11,.55)" : b.inVa ? "rgba(96,165,250,.32)" : "rgba(148,163,184,.16)", outline: b.hvn ? "1px solid rgba(34,197,94,.7)" : b.lvn ? "1px dashed rgba(244,63,94,.6)" : "none" }} />)}
        </div>
      )}
    </div>
  );
}

/** A formula condition run over a watchlist (or the 40 largest stocks): who meets it on the last candle. */
function FormulaScan({ f, onClose }) {
  const d = useData();
  const [wls] = usePersistent("watchlists", {});
  const [wl, setWl] = useState(Object.keys(wls)[0] || "");
  const [tf, setTf] = useState("D");
  const ids = useMemo(() => (wl && wls[wl]?.ids?.length ? wls[wl].ids : [...d.rows].sort(rowRankCmp).slice(0, 40).map((r) => r.id)).slice(0, 80), [wl, wls, d.rows]);
  const { data, loading } = useAsync(async () => {
    const out = [];
    for (const sid of ids) {
      try {
        const inst = await loadInstrument(d.api, { kind: "sec", id: sid }, d);
        if (!inst) continue;
        const b = aggregate({ ...inst, volume: inst.volume || inst.close.map(() => 0) }, tf);
        const vals = evalFormula(f.formula, b);
        out.push({ id: sid, sec: d.secById.get(sid), now: vals.at(-1) === 1, started: vals.at(-1) === 1 && vals.at(-2) !== 1, date: b.time.at(-1) });
      } catch (e) { out.push({ id: sid, sec: d.secById.get(sid), err: e.message }); }
    }
    return out;
  }, [ids.join(","), f.formula, tf]);
  const hits = (data || []).filter((x) => x.now);
  return (
    <div className="card">
      <div className="row between"><h3>"{f.name}" on {wl && wls[wl] ? wls[wl].name : "the 40 largest stocks"}</h3><button className="btn sm ghost" onClick={onClose}>✕</button></div>
      <div className="row small" style={{ gap: 6 }}>
        <select className="input sm" value={wl} onChange={(e) => setWl(e.target.value)}><option value="">40 largest stocks</option>{Object.entries(wls).map(([k, w]) => <option key={k} value={k}>{w.name}</option>)}</select>
        <TfPicker value={tf} onChange={setTf} />
        <span className="muted mono">{f.formula}</span>
      </div>
      {loading ? <Loading what={`${ids.length} charts`} /> : (
        <div className="small" style={{ marginTop: 6 }}>
          <b>{hits.length} of {data.length}</b> meet it on their last candle{hits.length ? ":" : "."} {hits.map((x) => <a key={x.id} href={`#/chart/${x.id}`} style={{ marginRight: 8 }}>{x.sec?.symbol}{x.started ? " (new)" : ""}</a>)}
          {data.some((x) => x.err) && <div className="muted">Could not run on {data.filter((x) => x.err).length}: {data.find((x) => x.err).err}</div>}
        </div>
      )}
    </div>
  );
}
