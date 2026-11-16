// Multi-chart workspace: any securities, indices, benchmarks and indicator
// panels side by side, saved as named layouts.
import { useMemo, useState } from "react";
import { useData } from "../data/store.jsx";
import { useAsync } from "../lib/useAsync.js";
import { PageHead, Seg, Select, Loading } from "../components/ui.jsx";
import { TvChart, ChartSync, lineData } from "../components/TvChart.jsx";
import { InstrumentPicker, TfPicker } from "../components/pickers.jsx";
import { loadInstrument, alignCurrency } from "../lib/series.js";
import { aggregate, ema, emaStrict, rsi, macd, rsc } from "../../engine/indicators.js";
import { usePersistent, uid } from "../lib/storage.js";

const INDICATORS = [{ value: "price", label: "Price + EMA 20/50/200" }, { value: "rsi", label: "RSI" }, { value: "macd", label: "MACD" }, { value: "rsc", label: "RSC vs benchmark" }, { value: "volume", label: "Volume" }, { value: "mma", label: "Price + MMA groups" }];
const newPanel = (inst) => ({ id: uid(), inst, tf: "D", ind: "price", bench: { kind: "index", key: "CW|USD|G", label: "Global CW (USD)" } });

export default function Workspace() {
  const d = useData();
  const top = useMemo(() => [...d.rows].sort((a, b) => (b.sec.capUsdNow || 0) - (a.sec.capUsdNow || 0)).slice(0, 4), [d.rows]);
  const [layouts, setLayouts] = usePersistent("workspaces", {});
  const [cur, setCur] = usePersistent("workspace.current", null);
  const panels = cur?.panels || top.map((r) => newPanel({ kind: "sec", id: r.id, label: `${r.sec.symbol} · ${r.sec.name}` }));
  const cols = cur?.cols || 2;
  const linked = cur?.linked ?? true;
  const update = (patch) => setCur({ panels, cols, linked, ...patch });
  const [sync] = useState(() => new ChartSync());
  const [name, setName] = useState("");

  return (
    <div className="stack">
      <PageHead title="Multi-chart workspace" sub="Several instruments, benchmarks and indicator panels at once. Layouts are saved in this browser.">
        <Seg value={cols} options={[1, 2, 3].map((c) => ({ value: c, label: `${c} col` }))} onChange={(c) => update({ cols: c })} />
        <Seg value={linked ? "on" : "off"} options={[{ value: "on", label: "Linked scroll" }, { value: "off", label: "Independent" }]} onChange={(v) => update({ linked: v === "on" })} />
        <button className="btn sm" onClick={() => update({ panels: [...panels, newPanel(panels[0]?.inst || { kind: "index", key: "CW|USD|G", label: "Global CW (USD)" })] })}>+ Panel</button>
        <input placeholder="Layout name" value={name} onChange={(e) => setName(e.target.value)} style={{ width: 130 }} />
        <button className="btn sm" disabled={!name} onClick={() => { setLayouts({ ...layouts, [name]: { panels, cols, linked } }); setName(""); }}>Save</button>
        <Select label="Load" value="" options={Object.keys(layouts)} onChange={(v) => v && setCur(layouts[v])} allowEmpty="—" />
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
  const series = useMemo(() => {
    if (!data?.inst) return [];
    const b = aggregate({ ...data.inst, volume: data.inst.volume || data.inst.close.map(() => 0) }, p.tf);
    const L = (vals, color, w = 1, title) => ({ type: "line", data: lineData(b.time, vals), options: { color, lineWidth: w, title, lastValueVisible: false } });
    if (p.ind === "rsi") return [{ ...L(rsi(b.close, 14), "#a78bfa", 2, "RSI 14"), priceLines: [{ price: 70, color: "#dc2626" }, { price: 30, color: "#16a34a" }] }];
    if (p.ind === "macd") { const m = macd(b.close); return [{ type: "histogram", data: lineData(b.time, m.hist).map((x) => ({ ...x, color: x.value >= 0 ? "#16a34a" : "#dc2626" })) }, L(m.line, "#14a44d", 2, "MACD"), L(m.signal, "#d97706", 1, "signal")]; }
    if (p.ind === "volume") return [{ type: "histogram", data: lineData(b.time, b.volume), options: { color: "#4b5563" } }];
    if (p.ind === "rsc") { if (!data.aligned) return []; const r = rsc(data.inst.time, data.aligned.a, data.bench.time, data.aligned.b, p.tf); return [{ type: "line", data: lineData(r.time, r.value), options: { color: "#e5e7eb", lineWidth: 2, title: "RSC" } }, { type: "line", data: lineData(r.time, ema(r.value, 10)), options: { color: "#14a44d", lineWidth: 1, title: "EMA10" } }]; }
    const base = data.inst.kind === "sec"
      ? { type: "candles", data: b.time.map((t, i) => ({ time: t, open: b.open[i], high: b.high[i], low: b.low[i], close: b.close[i] })), options: { upColor: "#16a34a", downColor: "#dc2626", borderVisible: false, wickUpColor: "#16a34a", wickDownColor: "#dc2626" } }
      : L(b.close, "#e5e7eb", 2);
    if (p.ind === "mma") return [base, ...[3, 5, 8, 10, 12, 15].map((n) => L(emaStrict(b.close, n), "#facc15")), ...[30, 35, 40, 45, 50, 60].map((n) => L(emaStrict(b.close, n), "#ef4444"))];
    return [base, L(emaStrict(b.close, 20), "#22d3ee", 1, "20"), L(emaStrict(b.close, 50), "#14a44d", 1, "50"), L(emaStrict(b.close, 200), "#d97706", 1, "200")];
  }, [data, p.tf, p.ind]);
  return (
    <div className="card tight" style={{ padding: 0 }}>
      <div className="panel-head">
        <InstrumentPicker value={p.inst} onChange={(r) => onChange({ inst: r })} width={210} />
        <div className="row">
          <TfPicker value={p.tf} onChange={(tf) => onChange({ tf })} />
          <Select value={p.ind} options={INDICATORS} onChange={(ind) => onChange({ ind })} />
          {p.ind === "rsc" && <InstrumentPicker value={p.bench} onChange={(r) => onChange({ bench: r })} width={170} placeholder="Benchmark…" />}
          <button className="btn sm ghost" onClick={onRemove} title="Remove panel">✕</button>
        </div>
      </div>
      {loading ? <Loading /> : <TvChart height={280} series={series} sync={sync} />}
    </div>
  );
}
