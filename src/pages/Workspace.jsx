// Multi-chart workspace: any securities, indices, benchmarks and indicator
// panels side by side, saved as named layouts.
import { useEffect, useMemo, useState } from "react";
import { useData } from "../data/store.jsx";
import { useAsync } from "../lib/useAsync.js";
import { PageHead, Seg, Select, Loading } from "../components/ui.jsx";
import { TvChart, ChartSync, lineData } from "../components/TvChart.jsx";
import { InstrumentPicker, TfPicker } from "../components/pickers.jsx";
import { PRESETS } from "../components/AnalystPane.jsx";
import { tfLabel } from "../../engine/calendar.js";
import { loadInstrument, alignCurrency } from "../lib/series.js";
import { aggregate, ema, emaStrict, rsi, macd, rsc } from "../../engine/indicators.js";
import { priceSeries } from "../lib/chartStyle.js";
import { STUDIES, movingAverage } from "../../engine/studies.js";
import { useIndSettings, linesLabel, listLabel } from "../lib/indSettings.js";
import { IndicatorSettingsButton } from "../components/IndicatorSettings.jsx";
import { studyOverlays, projectionOverlays } from "../lib/chartOverlays.js";
import { usePersistent, uid } from "../lib/storage.js";
import { useChartKeys } from "../lib/chartKeys.js";
import { rowRankCmp } from "../../engine/turnover.js";

const indicatorList = (ind) => [{ value: "price", label: `Price + ${linesLabel(ind.lines.filter((l) => !l.off))}` }, { value: "line", label: "Price line (green up / red down)" }, { value: "rsi", label: `RSI ${ind.rsi}` }, { value: "macd", label: `MACD ${ind.macdFast}/${ind.macdSlow}/${ind.macdSignal}` }, { value: "rsc", label: "RSC vs benchmark" }, { value: "volume", label: "Volume" }, { value: "mma", label: `Price + MMA ${listLabel(ind.mmaShort)} | ${listLabel(ind.mmaLong)}` },
  ...STUDIES.filter((x) => !["avwap", "pivots"].includes(x.key)).map((x) => ({ value: `st:${x.key}`, label: x.label }))];
const newPanel = (inst) => ({ id: uid(), inst, tf: "D", ind: "price", bench: { kind: "index", key: "CW|USD|G", label: "Global CW (USD)" } });

export default function Workspace() {
  const d = useData();
  const top = useMemo(() => [...d.rows].sort(rowRankCmp).slice(0, 4), [d.rows]);
  const [layouts, setLayouts] = usePersistent("workspaces", {});
  const [cur, setCur] = usePersistent("workspace.current", null);
  const panels = cur?.panels || top.map((r) => newPanel({ kind: "sec", id: r.id, label: `${r.sec.symbol} · ${r.sec.name}` }));
  const cols = cur?.cols || 2;
  const linked = cur?.linked ?? true;
  const update = (patch) => setCur({ panels, cols, linked, ...patch });
  const [sync] = useState(() => new ChartSync());
  const [name, setName] = useState("");
  // D W M Q H Y set every panel's period
  useChartKeys({ onTf: (tf) => update({ panels: panels.map((p) => ({ ...p, tf })) }) });

  return (
    <div className="stack">
      <PageHead title="Multi-chart workspace" sub="Several instruments, benchmarks and indicator panels at once. Layouts are saved in this browser.">
        <div className="seg" title="Period pairs: the panels take the left and right period in turn">{PRESETS.map(([a, b]) => <button key={a + b} className={panels.length > 0 && panels.every((x, k) => x.tf === (k % 2 ? b : a)) ? "on" : ""} onClick={() => update({ panels: panels.map((x, k) => ({ ...x, tf: k % 2 ? b : a })) })}>{`${tfLabel(a)} | ${tfLabel(b)}`}</button>)}</div>
        <Seg value={cols} options={[1, 2, 3].map((c) => ({ value: c, label: `${c} col` }))} onChange={(c) => update({ cols: c })} />
        <Seg value={linked ? "on" : "off"} options={[{ value: "on", label: "Linked scroll" }, { value: "off", label: "Independent" }]} onChange={(v) => update({ linked: v === "on" })} />
        <button className="btn sm" onClick={() => update({ panels: [...panels, newPanel(panels[0]?.inst || { kind: "index", key: "CW|USD|G", label: "Global CW (USD)" })] })}>+ Panel</button>
        <input placeholder="Layout name" value={name} onChange={(e) => setName(e.target.value)} style={{ width: 130 }} />
        <button className="btn sm" disabled={!name} onClick={() => { setLayouts({ ...layouts, [name]: { panels, cols, linked } }); setName(""); }}>Save</button>
        <Select label="Load" value="" options={Object.keys(layouts)} onChange={(v) => v && setCur(layouts[v])} allowEmpty="—" />
        <IndicatorSettingsButton />
      </PageHead>
      <div className="grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {panels.map((p, i) => (
          <ChartPanel key={p.id} p={p} sync={linked ? sync : null}
            onChange={(patch) => update({ panels: panels.map((x, k) => (k === i ? { ...x, ...patch } : x)) })}
            onRemove={() => update({ panels: panels.filter((_, k) => k !== i) })} />
        ))}
      </div>
    </div>
  );
}

function ChartPanel({ p, onChange, onRemove, sync }) {
  const d = useData();
  const { data, loading } = useAsync(async () => {
    const inst = await loadInstrument(d.api, p.inst, d);
    let bench = null, aligned = null;
    if (p.ind === "rsc" && p.bench) { bench = await loadInstrument(d.api, p.bench, d); if (inst && bench) aligned = await alignCurrency(d.api, inst, bench); }
    return { inst, bench, aligned };
  }, [p.inst?.id, p.inst?.key, p.ind, p.bench?.key, p.bench?.id]);
  // projections drawn in the chart lab are shared by instrument; shown here on the price panels (edit them in the lab)
  const [allProj] = usePersistent("projections", {});
  const [ind] = useIndSettings();
  const INDICATORS = useMemo(() => indicatorList(ind), [ind]);
  // studies take the settings typed in the chart lab's Indicators list (same boxes, one place)
  const [lab] = usePersistent("chartlab", {});
  const labStudies = useMemo(() => lab?.studies || {}, [lab]);
  const projList = useMemo(() => allProj[p.inst?.id ?? p.inst?.key] || [], [allProj, p.inst?.id, p.inst?.key]);
  const bars = useMemo(() => (data?.inst ? aggregate({ ...data.inst, volume: data.inst.volume || data.inst.close.map(() => 0) }, p.tf) : null), [data, p.tf]);
  const series = useMemo(() => {
    if (!data?.inst) return [];
    const b = aggregate({ ...data.inst, volume: data.inst.volume || data.inst.close.map(() => 0) }, p.tf);
    const C = ind.colors;
    const L = (vals, color, w = 1, title) => ({ type: "line", data: lineData(b.time, vals), options: { color, lineWidth: w, title, lastValueVisible: false } });
    if (p.ind === "rsi") return [{ ...L(rsi(b.close, ind.rsi), C.rsi, 2, `RSI ${ind.rsi}`), priceLines: [{ price: ind.rsiHigh, color: C.rsiHighLine }, { price: ind.rsiLow, color: C.rsiLowLine }] }];
    if (p.ind === "macd") { const m = macd(b.close, ind.macdFast, ind.macdSlow, ind.macdSignal); return [{ type: "histogram", data: lineData(b.time, m.hist).map((x) => ({ ...x, color: x.value >= 0 ? C.histUp : C.histDown })) }, L(m.line, C.macd, 2, "MACD"), L(m.signal, C.macdSignal, 1, "signal")]; }
    if (p.ind === "volume") return [{ type: "histogram", data: lineData(b.time, b.volume), options: { color: C.volume } }];
    if (p.ind === "rsc") { if (!data.aligned) return []; const r = rsc(data.inst.time, data.aligned.a, data.bench.time, data.aligned.b, p.tf, ind.rscBase); return [{ type: "line", data: lineData(r.time, r.value), options: { color: C.rsc, lineWidth: 2, title: "RSC" } }, { type: "line", data: lineData(r.time, ema(r.value, ind.rscAvg)), options: { color: C.rscAvg, lineWidth: 1, title: `EMA${ind.rscAvg}` } }]; }
    const base = data.inst.kind === "sec"
      ? { type: "candles", data: b.time.map((t, i) => ({ time: t, open: b.open[i], high: b.high[i], low: b.low[i], close: b.close[i] })), options: { upColor: C.up, downColor: C.down, borderVisible: false, wickUpColor: C.up, wickDownColor: C.down } }
      : L(b.close, C.priceLine, 2);
    if (p.ind === "line") return [priceSeries(b.time, b, "line", { up: C.up, down: C.down })];
    if (p.ind.startsWith("st:")) {
      // a study from the chart lab's library on this panel's candles: price studies over the price,
      // the others on their own
      const k = p.ind.slice(3), o = studyOverlays(b, { [k]: { ...(labStudies[k] || {}), on: true } }, p.tf);
      if (o.panes.length) return o.panes[0].specs;
      return [{ type: "candles", data: b.time.map((t, i) => ({ time: t, open: b.open[i], high: b.high[i], low: b.low[i], close: b.close[i] })), options: { upColor: C.up, downColor: C.down, borderVisible: false, wickUpColor: C.up, wickDownColor: C.down } }, ...o.price];
    }
    let proj = [];
    try { proj = projList.length ? projectionOverlays(b, projList, p.tf).price : []; } catch { proj = []; }
    if (p.ind === "mma") return [base, ...ind.mmaShort.map((n) => L(emaStrict(b.close, n), C.mmaShort)), ...ind.mmaLong.map((n) => L(emaStrict(b.close, n), C.mmaLong)), ...proj];
    return [base, ...ind.lines.filter((l) => !l.off).map((l) => L(movingAverage(l.kind, b.close, l.n), l.color, 1, `${l.kind}${l.n}`)), ...proj];
  }, [data, p.tf, p.ind, projList, ind, labStudies]);
  const [big, setBig] = useState(false);
  useEffect(() => {
    if (!big) return undefined;
    const h = (e) => { if (e.key === "Escape") setBig(false); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [big]);
  const chart = (h) => (loading ? <Loading /> : <TvChart height={h} series={series} sync={big ? null : sync} ohlcv={bars ? { name: data?.inst?.label || p.inst?.label || "", tf: p.tf, bars } : null} legend={!["rsi", "macd", "rsc", "volume"].includes(p.ind)} />);
  return (
    <div className="card tight" style={{ padding: 0 }}>
      {big && (
        <div className="anl-full">
          <div className="anl-fbar">
            <InstrumentPicker value={p.inst} onChange={(r) => onChange({ inst: r })} width={240} />
            <span className="small">Period</span><TfPicker dark value={p.tf} onChange={(tf) => onChange({ tf })} />
            <div className="seg">{["D", "W", "M", "Q", "H", "N", "Y"].map((t) => <button key={t} className={p.tf === t ? "on" : ""} onClick={() => onChange({ tf: t })}>{tfLabel(t)}</button>)}</div>
            <Select value={p.ind} options={INDICATORS} onChange={(ind) => onChange({ ind })} />
          </div>
          <button className="anl-x" title="Back to all charts (Esc)" onClick={() => setBig(false)}>✕</button>
          <div>{chart(Math.max(320, window.innerHeight - 70))}</div>
        </div>
      )}
      <div className="panel-head">
        <InstrumentPicker value={p.inst} onChange={(r) => onChange({ inst: r })} width={210} />
        <div className="row">
          <TfPicker value={p.tf} onChange={(tf) => onChange({ tf })} />
          <Select value={p.ind} options={INDICATORS} onChange={(ind) => onChange({ ind })} />
          {p.ind === "rsc" && <InstrumentPicker value={p.bench} onChange={(r) => onChange({ bench: r })} width={170} placeholder="Benchmark…" />}
          <button className="btn sm ghost" onClick={() => setBig(true)} title="Open this chart full screen">⤢</button>
          <button className="btn sm ghost" onClick={onRemove} title="Remove panel">✕</button>
        </div>
      </div>
      {chart(280)}
    </div>
  );
}
