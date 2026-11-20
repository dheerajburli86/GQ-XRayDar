// The four stacked screens in the look of the owner's "Analyst" software
// (black background, two timeframes side by side, log scale everywhere):
//   RSIMMA / RSIACC  Price | RSI | RSI of RSI | RSI of RSI of RSI
//   RSCMMA / RSCACC  Price | RSC | RSI of RSC | RSI of RSI of RSC | RSI of RSI of RSI of RSC
// MMA = short EMA 3-15 (yellow) + long EMA 30-60 (red); ACC = EMA 4 / 14 / 26 / 39.
// All maths is engine/analyst.js; this page only draws it.
import { rowBars } from "../lib/dataWindow.js";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useData } from "../data/store.jsx";
import { useAsync } from "../lib/useAsync.js";
import { navigate } from "../lib/router.js";
import { Seg, Check, Badge, Loading, Empty, Tabs } from "../components/ui.jsx";
import { ChartSync } from "../components/TvChart.jsx";
import { Pane, StudyPane, YELLOW, RED, ACC_COLOR, PRESETS, DEFAULT_VIEW } from "../components/AnalystPane.jsx";
import { StudiesPanel, FormulaPanel, ProjectionPanel } from "../components/ChartLabPanels.jsx";
import { studyOverlays, formulaOverlays, projectionOverlays } from "../lib/chartOverlays.js";
import { InstrumentPicker, TfPicker } from "../components/pickers.jsx";
import { QuickTicker } from "../components/QuickTicker.jsx";
import { useChartKeys } from "../lib/chartKeys.js";
import { decodeRef, encodeRef, useLastInstrument } from "../lib/instruments.js";
import { PRICE_STYLES } from "../lib/chartStyle.js";
import { loadInstrument, alignCurrency, defaultBenchmark } from "../lib/series.js";
import { usePersistent } from "../lib/storage.js";
import { captureStack, savePng, savePdf } from "../lib/snapshot.js";
import { tfLabel } from "../../engine/calendar.js";
import { ANALYST_MODES, ACC_PERIODS, MMA_SHORT, buildAnalystColumn, analystDate } from "../../engine/analyst.js";

const fmt = (v) => (v == null ? "—" : v.toFixed(2));

export default function StackedScreens({ route }) {
  const d = useData();
  const mode = ANALYST_MODES[route.args[0]] ? route.args[0] : "RSIMMA";
  const cfg = ANALYST_MODES[mode];
  // the instrument: from the address, else the one last opened on any chart screen (owner:
  // changing screen keeps the ticker), else the largest stock. Stocks, indices and extras all chart.
  const [lastInst, setLastInst] = useLastInstrument();
  const instKey = route.args[1] || (route.query.id ? `s:${route.query.id}` : null) || lastInst || null;
  const inst = useMemo(() => decodeRef(instKey, d), [instKey, d]);
  const secId = inst?.kind === "sec" ? inst.id : null;
  const sec = secId ? d.secById.get(secId) : null;
  const instLabel = sec ? `${sec.symbol} · ${sec.name}` : inst?.label || "";
  const instShort = sec ? sec.symbol : (inst?.label || "").split(" · ")[0];
  useEffect(() => { if (instKey && instKey !== lastInst) setLastInst(instKey); }, [instKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const [picking, setPicking] = useState(null);
  const [view, setView] = usePersistent("analyst.view", DEFAULT_VIEW);
  // stable identity: the panes rebuild (and redraw ~130 lines) only when a view setting really changes
  const v = useMemo(() => ({ ...DEFAULT_VIEW, ...view, acc: { ...DEFAULT_VIEW.acc, ...(view?.acc || {}) } }), [view]);
  const setV = (patch) => setView({ ...v, ...patch });
  const [tfs, setTfs] = usePersistent(`analyst.tf.${mode}`, null);
  const left = tfs?.left || "D", right = tfs?.right || "W";
  const setTf = (side, tf) => setTfs({ left, right, [side]: tf });
  // date range: From opens the window (and, when "candles from From" is on, starts the candle grid); To ends the data
  const [range, setRange] = usePersistent("analyst.range.v2", { from: "", to: "", anchor: false });
  const rg = { from: "", to: "", anchor: false, ...(range || {}) };
  const setRg = (patch) => setRange({ ...rg, ...patch });
  const badRange = rg.from && rg.to && rg.from > rg.to;
  const from = badRange ? "" : rg.from, to = badRange ? "" : rg.to;
  const anchor = from && rg.anchor ? from : null;
  const [rsiN, setRsiN] = usePersistent("analyst.rsiPeriod", null); // null = the methodology default (14)
  const [active, setActive] = useState(1);
  const [focus, setFocus] = useState(null);
  useEffect(() => {
    if (focus == null) return undefined;
    const h = (e) => { if (e.key === "Escape") setFocus(null); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [focus]);
  // studies, own formulas and projections on the price row (the same stores the chart lab uses)
  const [studies, setStudies] = usePersistent("analyst.studies", {});
  const [customs, setCustoms] = usePersistent("customIndicators", []);
  const [allProj, setAllProj] = usePersistent("projections", {});
  const projKey = secId || instKey || "";
  const projs = useMemo(() => allProj[projKey] || [], [allProj, projKey]);
  const setProjs = (list) => setAllProj({ ...allProj, [projKey]: list });
  const [tray, setTray] = usePersistent("analyst.tray", { open: false, tab: "studies" });
  const [rangeKey, setRangeKey] = useState(0);
  const [syncs] = useState(() => [new ChartSync(), new ChartSync()]);
  const [vh, setVh] = useState(window.innerHeight);
  useEffect(() => { const h = () => setVh(window.innerHeight); window.addEventListener("resize", h); return () => window.removeEventListener("resize", h); }, []);

  // benchmark: ?bench=, else BSE 500 for an Indian stock and the S&P 500 for a US one (the owner's references), else the country CW index
  const bse500 = useMemo(() => d.secs.find((x) => x.symbol === "BSE500"), [d.secs]);
  const spx = useMemo(() => d.secs.find((x) => x.symbol === "^GSPC" && x.assetClass === "Index"), [d.secs]); // US default: S&P 500 (owner, item 22)
  const benchRef = route.query.bench
    ? (route.query.bench.startsWith("idx:") ? { kind: "index", key: route.query.bench.slice(4) } : route.query.bench.startsWith("x:") ? { kind: "x", key: route.query.bench.slice(2) } : { kind: "sec", id: route.query.bench })
    : sec?.country === "India" && bse500 && bse500.id !== secId ? { kind: "sec", id: bse500.id }
    : sec?.country === "United States" && spx && spx.id !== secId ? { kind: "sec", id: spx.id } : sec ? defaultBenchmark(sec) : { kind: "index", key: "CW|USD|G", label: "Global CW (USD)" };
  const benchLabel = benchRef.kind === "index" ? d.indexByKey.get(benchRef.key)?.name || benchRef.key : benchRef.kind === "x" ? benchRef.key.replace(/^FX:/, "") : d.secById.get(benchRef.id)?.symbol;

  const { data, loading, error } = useAsync(async () => {
    if (!inst) return null;
    const bars = await loadInstrument(d.api, inst, d);
    let bench = null, aligned = null;
    if (bars && cfg.base === "rsc") {
      bench = await loadInstrument(d.api, benchRef, d);
      if (bench) aligned = await alignCurrency(d.api, bars, bench);
    }
    return { inst: bars, bench, aligned };
  }, [instKey, cfg.base, benchRef.kind, benchRef.key, benchRef.id]);

  useEffect(() => { setRangeKey((k) => k + 1); }, [instKey, mode, left, right, from, to, anchor]);

  const m0 = d.info.methodology.indicators;
  const rsiPer = Number.isInteger(rsiN) && rsiN >= 2 && rsiN <= 200 ? rsiN : m0.rsiPeriod;
  const m = useMemo(() => ({ ...m0, rsiPeriod: rsiPer }), [m0, rsiPer]);
  // one memo per side: changing the left timeframe does not rebuild (and redraw) the right column
  const buildCol = (tf) => {
    if (!data?.inst) return null;
    const { inst, bench, aligned } = data;
    return buildAnalystColumn({
      mode, tf, bars: inst, benchLabel,
      bench: bench && aligned ? { time: bench.time, close: aligned.b } : null, rscCloses: aligned?.a,
      rsiPeriod: m.rsiPeriod, rsiMethod: m.rsiMethod, rscBase: m.rscRebase, to: to || null, anchor,
    });
  };
  /* eslint-disable react-hooks/exhaustive-deps */
  const colL = useMemo(() => buildCol(left), [data, left, mode, benchLabel, m, to, anchor]);
  const colR = useMemo(() => buildCol(right), [data, right, mode, benchLabel, m, to, anchor]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const columns = useMemo(() => (colL && colR ? [colL, colR] : null), [colL, colR]);

  // overlays per column, from that column's own candles (a weekly ADX uses weekly candles)
  const extras = useMemo(() => (columns || []).map((col) => {
    const o = col.rows[0]?.ohlc;
    if (!o || !col.rows[0].time.length) return null;
    const b = { time: col.rows[0].time, open: o.open, high: o.high, low: o.low, close: o.close, volume: o.volume };
    const so = studyOverlays(b, studies, col.tf), fo = formulaOverlays(b, customs), pj = projectionOverlays(b, projs, col.tf);
    return { bars: b, price: [...so.price, ...fo.price, ...pj.price], levels: [...so.levels, ...pj.levels], markers: fo.markers, panes: [...so.panes, ...fo.panes], notes: so.notes, errors: fo.errors, projections: pj.results };
  }), [columns, studies, customs, projs]);
  const dwOf = (col) => { const b = rowBars(col.rows[0]); return b ? { name: instShort, tf: tfLabel(col.tf), bars: b } : null; };
  const nExtra = Math.max(0, ...extras.map((e) => e?.panes.length || 0));
  const nStudies = Object.values(studies).filter((x) => x?.on).length;

  const shotRef = useRef(null);
  const shotName = () => `${(instShort || "chart").replace(/[^\w.-]+/g, "_")}_${mode}_${left}-${right}_${columns?.[0]?.header?.date || ""}`;
  const shotMeta = () => ({
    title: `${instLabel} · ${mode}${cfg.base === "rsc" ? ` vs ${benchLabel}` : ""}`,
    subtitle: `${tfLabel(left)} | ${tfLabel(right)} · RSI ${rsiPer} · data to ${columns?.[0]?.header?.date ? analystDate(columns[0].header.date) : "n/a"} · GQ XRayDar`,
  });
  const savePicture = async (kind) => {
    if (!shotRef.current) return;
    const c = captureStack(shotRef.current, shotMeta());
    if (kind === "png") await savePng(c, `${shotName()}.png`);
    else await savePdf(c, `${shotName()}.pdf`, { footer: shotMeta().title });
  };

  const go = (r) => navigate(`screens/${mode}/${encodeURIComponent(encodeRef(r))}`, route.query.bench ? { bench: route.query.bench } : undefined);
  const setBench = (r) => navigate(`screens/${mode}/${encodeURIComponent(instKey)}`, { bench: r.kind === "index" ? `idx:${r.key}` : r.kind === "x" ? `x:${r.key}` : r.id });
  // keyboard: D W M Q H Y set the selected column's period; C (or typing) changes the instrument
  useChartKeys({ onTf: (tf) => setTf(active === 0 ? "left" : "right", tf), onSearch: (ch) => setPicking({ initial: ch }) });
  // panes fill the window below the toolbars, so the bottom row is visible without scrolling
  const nRows = (cfg.base === "rsc" ? 5 : 4) + nExtra * 0.8;
  const anlRef = useRef(null);
  const [top, setTop] = useState(170);
  const hasCols = !!columns;
  useLayoutEffect(() => { const el = anlRef.current; if (el) setTop(Math.max(60, el.getBoundingClientRect().top + window.scrollY)); }, [hasCols, vh, mode, v.avgOnly, rg.from, rg.to, picking, tray.open, tray.tab]);
  const paneH = Math.max(70, Math.floor((vh - top - 22 - 34) / (nRows + 0.35)));

  const renderCol = (col, ci, full) => {
    const rowsH = col.rows.map((_, ri) => (ri === 0 ? Math.round(paneH * 1.35) : paneH));
    const exH = (extras[ci]?.panes || []).map(() => Math.round(paneH * 0.8));
    const total = rowsH.reduce((x, y) => x + y, 0) + exH.reduce((x, y) => x + y, 0);
    const k = full ? Math.max(1, (window.innerHeight - 110) / Math.max(1, total + 26 * (rowsH.length + exH.length))) : 1;
    return (
      <div key={ci} className="anl-col" onMouseDown={() => setActive(ci)}>
        <div className={`anl-head ${active === ci ? "on" : ""}`} onDoubleClick={() => !full && setFocus(ci)}>
          <span>{tfLabel(col.tf)}{col.header ? `  ${fmt(col.header.open)}  ${fmt(col.header.high)}  ${fmt(col.header.low)}  ${fmt(col.header.close)}  [ ${col.header.chg == null ? "—" : `${col.header.chg >= 0 ? "" : "-"}${Math.abs(col.header.chg * 100).toFixed(2)}%`} ] - ${analystDate(col.header.date)}` : "  no data"}</span>
          {!full && <button className="anl-exp" title="Open this chart full screen" onClick={(e) => { e.stopPropagation(); setFocus(ci); }}>⤢</button>}
        </div>
        {col.rows.map((row, ri) => (
          <Pane key={`${full ? "f" : ""}${ci}-${ri}`} row={row} ri={ri} last={ri === col.rows.length - 1 && !(extras[ci]?.panes?.length)} mode={mode} overlay={cfg.overlay} v={v} tf={col.tf} from={from}
            height={Math.round(rowsH[ri] * k)} sync={full ? undefined : syncs[ci]} rangeKey={`${rangeKey}|${ci}${full ? "f" : ""}`} extra={ri === 0 ? extras[ci] : null} dw={dwOf(col)} />
        ))}
        {(extras[ci]?.panes || []).map((pn, pi, all) => (
          <StudyPane key={`${full ? "f" : ""}${pn.key}`} pane={pn} time={col.rows[0].time} last={pi === all.length - 1} tf={col.tf} from={from} height={Math.round(exH[pi] * k)} sync={full ? undefined : syncs[ci]} rangeKey={`${rangeKey}|${ci}${full ? "f" : ""}`} dw={dwOf(col)} />
        ))}
      </div>
    );
  };

  return (
    <div className="stack" style={{ gap: 6 }}>
      {picking && <QuickTicker initial={picking.initial} onClose={() => setPicking(null)} onPick={go} />}
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <Seg value={mode} options={Object.keys(ANALYST_MODES)} onChange={(x) => navigate(`screens/${x}/${encodeURIComponent(instKey || "")}`, route.query.bench ? { bench: route.query.bench } : undefined)} />
        <div className="seg" title="Period pairs (keys D W M Q H Y set the selected column)">{PRESETS.map(([a, b]) => <button key={a + b} className={left === a && right === b ? "on" : ""} onClick={() => setTfs({ left: a, right: b })}>{`${tfLabel(a)} | ${tfLabel(b)}`}</button>)}</div>
        <span className="small muted">Left</span><TfPicker value={left} onChange={(tf) => setTf("left", tf)} />
        <span className="small muted">Right</span><TfPicker value={right} onChange={(tf) => setTf("right", tf)} />
      </div>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <InstrumentPicker value={inst ? { label: instLabel } : null} onChange={go} placeholder="Instrument… (or press C)" width={230} />
        {cfg.base === "rsc" && <><span className="small muted">vs</span><InstrumentPicker value={{ label: benchLabel }} onChange={setBench} placeholder="Comparison stock or index…" width={200} category={false} /></>}
        <select className="input sm" value={v.price} onChange={(e) => setV({ price: e.target.value })} title="Price drawn as a line (green up / red down), OHLC bars or candles">
          {PRICE_STYLES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <button className={`btn sm ${v.avgOnly ? "primary" : ""}`} onClick={() => setV({ avgOnly: !v.avgOnly })} title="Hide every price / RSI / RSC line and keep only the averages">{v.avgOnly ? "Averages only: ON" : "Averages only"}</button>
        <Check checked={v.log} onChange={(x) => setV({ log: x })}>Log scale</Check>
        <span className="small muted">RSI period</span>
        <input type="number" min="2" max="200" value={rsiPer} style={{ width: 56 }} title="RSI length in candles (default 14)"
          onChange={(e) => { const n = parseInt(e.target.value, 10); setRsiN(Number.isFinite(n) ? n : null); }} />
        {rsiPer !== m0.rsiPeriod && <button className="btn sm" onClick={() => setRsiN(null)}>Reset to {m0.rsiPeriod}</button>}
        {cfg.overlay === "mma" ? <>
          <Check checked={v.short} onChange={(x) => setV({ short: x })} color={YELLOW}>Short EMA 3-15</Check>
          <Check checked={v.long} onChange={(x) => setV({ long: x })} color={RED}>Long EMA 30-60</Check>
        </> : ACC_PERIODS.map((p) => <Check key={p} checked={v.acc[p]} onChange={(x) => setV({ acc: { ...v.acc, [p]: x } })} color={ACC_COLOR[p]}>EMA {p}</Check>)}
        <span className="small muted">From</span>
        <input type="date" value={rg.from} max={rg.to || undefined} onChange={(e) => setRg({ from: e.target.value })} title="Start date: the chart opens here" />
        <span className="small muted">To</span>
        <input type="date" value={rg.to} min={rg.from || undefined} onChange={(e) => setRg({ to: e.target.value })} title="End date: nothing after it is used" />
        <Check checked={rg.anchor} onChange={(x) => setRg({ anchor: x })}>Candles start from From date</Check>
        {(rg.from || rg.to) && <button className="btn sm" onClick={() => setRg({ from: "", to: "" })}>Clear dates</button>}
        {badRange && <Badge kind="r">From is after To: dates ignored</Badge>}
        <button className="btn sm" onClick={() => setRangeKey((k) => k + 1)} title="Back to the default window">⇥ Latest</button>
        <button className={`btn sm ${tray.open ? "primary" : ""}`} onClick={() => setTray({ ...tray, open: !tray.open })} title="Indicators, your own formulas and projections on the price row">
          Indicators{nStudies + customs.filter((c) => c.on).length + projs.filter((p) => !p.hidden).length ? ` (${nStudies + customs.filter((c) => c.on).length + projs.filter((p) => !p.hidden).length})` : ""}</button>
        {sec && <a className="btn sm" href={`#/stock/${sec.id}`}>Stock page</a>}
        <a className="btn sm" href={`#/tiles?inst=${encodeURIComponent(instKey)}&mode=${mode}`} title="Open this instrument's peers in the multi-tile screen">Tiles</a>
        {columns && <><button className="btn sm" onClick={() => savePicture("png")} title="Download this whole screen as a picture">Download PNG</button>
        <button className="btn sm" onClick={() => savePicture("pdf")} title="Download this whole screen as a PDF page">Download PDF</button></>}
        {data?.aligned && data.aligned.currency === "USD" && data.inst.currency !== "USD" && <Badge>RSC in USD (different currencies)</Badge>}
        {data?.inst?.adjustments?.length > 0 && <Badge kind="b">split-adjusted ({data.inst.adjustments.length})</Badge>}
      </div>
      {tray.open && (
        <div className="card" style={{ padding: 8 }}>
          <Tabs value={tray.tab} onChange={(tab) => setTray({ ...tray, tab })} tabs={[{ value: "studies", label: "Indicators" }, { value: "formula", label: `My formulas (${customs.length})` }, { value: "proj", label: `Projections (${projs.length})` }]} />
          {tray.tab === "studies" && <StudiesPanel studies={studies} onChange={setStudies} />}
          {tray.tab === "formula" && <FormulaPanel list={customs} setList={setCustoms} />}
          {tray.tab === "proj" && (extras[active] || extras[0] ? <ProjectionPanel list={projs} setList={setProjs} results={(extras[active] || extras[0]).projections} bars={(extras[active] || extras[0]).bars} tf={columns[extras[active] ? active : 0]?.tf || left} /> : <Empty>No candles yet</Empty>)}
          {extras.flatMap((e) => e?.errors || []).slice(0, 3).map((m, i) => <div key={i} className="note warn small">{m}</div>)}
          {(extras[0]?.notes || []).map((m, i) => <div key={i} className="small muted">{m}</div>)}
        </div>
      )}
      {!inst ? <Empty>Pick an instrument</Empty> : loading ? <Loading what="series" /> : error ? <div className="note warn">{String(error.message)}</div> : !columns ? <Empty>No price history</Empty> : (
        <>
          <div className="anl" ref={(el) => { shotRef.current = el; anlRef.current = el; }}>
            {columns.map((col, ci) => renderCol(col, ci, false))}
          </div>
          {focus != null && columns[focus] && (
            <div className="anl-full">
              <button className="anl-x" title="Back to all charts (Esc)" onClick={() => setFocus(null)}>✕</button>
              <div className="anl anl-one">{renderCol(columns[focus], focus, true)}</div>
            </div>
          )}
        </>
      )}
      <div className="small muted">Keys: D W M Q H Y change the selected column's period · C (or start typing) changes the instrument. RSI {m.rsiPeriod} and every EMA are counted in candles of that column. {anchor ? `Candles of 2 months and longer are counted from ${analystDate(anchor)}; data before it still warms up the RSIs and averages.` : "n-month candles run on a fixed grid from January 2000 (2M, 4M and 2Y line up with the calendar)."}{to ? ` Nothing after ${analystDate(to)} is used.` : ""} Click a column to select it.</div>
    </div>
  );
}

