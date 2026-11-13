// The four mandatory stacked screens:
//   RSIACC  Price | RSI | RSI of RSI | RSI of RSI of RSI      + EMA 4/14/26/39
//   RSCACC  Price | RSC | RSI of RSC | RSI of RSI of RSC      + EMA 4/14/26/39
//   RSIMMA  as RSIACC                                        + short EMA 3..15 (yellow), long EMA 30..60 (red)
//   RSCMMA  as RSCACC                                        + short / long MMA groups
// Every window picks its own timeframe; EMA N is N candles OF THAT timeframe.
// All windows share the instrument, the latest endpoint, horizontal scroll /
// zoom (by date) and the crosshair.
import { useEffect, useMemo, useState } from "react";
import { useData } from "../data/store.jsx";
import { useAsync } from "../lib/useAsync.js";
import { navigate } from "../lib/router.js";
import { PageHead, Seg, Check, Badge, Loading, Empty } from "../components/ui.jsx";
import { TvChart, ChartSync, lineData } from "../components/TvChart.jsx";
import { InstrumentPicker } from "../components/pickers.jsx";
import { loadInstrument, alignCurrency, defaultBenchmark } from "../lib/series.js";
import { aggregate, rsi, emaStrict, rsc } from "../../engine/indicators.js";
import { usePersistent } from "../lib/storage.js";
import { TF_LABEL } from "../../engine/calendar.js";

const ACC = [4, 14, 26, 39];
const ACC_COLORS = { 4: "#22d3ee", 14: "#a3e635", 26: "#f472b6", 39: "#fb923c" };
const SHORT = [3, 5, 8, 10, 12, 15], LONG = [30, 35, 40, 45, 50, 60];
const MODES = {
  RSIACC: { base: "rsi", overlay: "acc", panels: ["Price", "RSI", "RSI of RSI", "RSI of RSI of RSI"] },
  RSCACC: { base: "rsc", overlay: "acc", panels: ["Price", "RSC", "RSI of RSC", "RSI of RSI of RSC"] },
  RSIMMA: { base: "rsi", overlay: "mma", panels: ["Price", "RSI", "RSI of RSI", "RSI of RSI of RSI"] },
  RSCMMA: { base: "rsc", overlay: "mma", panels: ["Price", "RSC", "RSI of RSC", "RSI of RSI of RSC"] },
};
const defaultPanel = (overlay) => ({
  tf: "W", base: true,
  emas: Object.fromEntries((overlay === "acc" ? ACC : [...SHORT, ...LONG]).map((p) => [p, true])),
  short: true, long: true,
});

export default function StackedScreens({ route }) {
  const d = useData();
  const mode = MODES[route.args[0]] ? route.args[0] : "RSIMMA";
  const cfg = MODES[mode];
  const secId = route.args[1] || route.query.id || [...d.rows].sort((a, b) => (b.sec.capUsdNow || 0) - (a.sec.capUsdNow || 0))[0]?.id;
  const sec = d.secById.get(secId);
  const [layout, setLayout] = usePersistent(`layout.${mode}`, null);
  const panels = layout?.panels?.length === 4 ? layout.panels : cfg.panels.map(() => defaultPanel(cfg.overlay));
  const setPanel = (i, patch) => setLayout({ panels: panels.map((p, k) => (k === i ? { ...p, ...patch } : p)) });
  const benchRef = route.query.bench ? (route.query.bench.startsWith("idx:") ? { kind: "index", key: route.query.bench.slice(4) } : { kind: "sec", id: route.query.bench }) : defaultBenchmark(sec);
  const benchLabel = benchRef.kind === "index" ? d.indexByKey.get(benchRef.key)?.name || benchRef.key : d.secById.get(benchRef.id)?.symbol;
  const [sync] = useState(() => new ChartSync());
  const [rangeKey, setRangeKey] = useState(0);
  const height = Math.max(150, Math.floor((window.innerHeight - 260) / 4));

  const { data, loading, error } = useAsync(async () => {
    if (!secId) return null;
    const inst = await loadInstrument(d.api, { kind: "sec", id: secId }, d);
    let bench = null, aligned = null;
    if (cfg.base === "rsc") {
      bench = await loadInstrument(d.api, benchRef, d);
      if (bench) aligned = await alignCurrency(d.api, inst, bench);
    }
    return { inst, bench, aligned };
  }, [secId, cfg.base, benchRef.kind, benchRef.key, benchRef.id]);

  // reset the visible window to the latest ~2 years whenever the instrument changes
  useEffect(() => { setRangeKey((k) => k + 1); }, [secId, mode]);

  const go = (r) => navigate(`screens/${mode}/${r.id}`, route.query.bench ? { bench: route.query.bench } : undefined);
  const setBench = (r) => navigate(`screens/${mode}/${secId}`, { bench: r.kind === "index" ? `idx:${r.key}` : r.id });

  return (
    <div className="stack" style={{ gap: 8 }}>
      <PageHead title={`${mode} screen`} sub={`${cfg.panels.join("  |  ")} · ${cfg.overlay === "acc" ? "EMA 4 / 14 / 26 / 39" : "short EMA 3-15 (yellow) · long EMA 30-60 (red)"} · each window has its own timeframe`}>
        <Seg value={mode} options={Object.keys(MODES)} onChange={(m) => navigate(`screens/${m}/${secId || ""}`, route.query.bench ? { bench: route.query.bench } : undefined)} />
      </PageHead>
      <div className="row">
        <InstrumentPicker value={sec ? { label: `${sec.symbol} · ${sec.name}` } : null} onChange={(r) => r.kind === "sec" && go(r)} allowIndex={false} placeholder="Instrument…" />
        {cfg.base === "rsc" && <><span className="small muted">RSC vs</span><InstrumentPicker value={{ label: benchLabel }} onChange={setBench} placeholder="Comparison stock or index…" /></>}
        <button className="btn sm" onClick={() => setRangeKey((k) => k + 1)} title="Show the latest two years in every window">⇥ Latest</button>
        <button className="btn sm" onClick={() => setLayout(null)} title="Restore default windows">Reset layout</button>
        {sec && <a className="btn sm" href={`#/stock/${sec.id}`}>Stock page</a>}
        {data?.aligned && <Badge>{data.aligned.currency === "USD" && data.inst.currency !== "USD" ? "compared in USD (different currencies)" : `compared in ${data.aligned.currency}`}</Badge>}
        {data?.inst?.adjustments?.length > 0 && <Badge kind="b">split-adjusted ({data.inst.adjustments.length})</Badge>}
      </div>
      {!secId ? <Empty>Pick an instrument</Empty> : loading ? <Loading what="series" /> : error ? <div className="note warn">{String(error.message)}</div> : !data?.inst ? <Empty>No price history</Empty> : (
        cfg.panels.map((title, i) => (
          <Panel key={i} idx={i} title={title} mode={cfg} p={panels[i]} set={(patch) => setPanel(i, patch)} data={data} sync={sync} height={height} rangeKey={rangeKey} benchLabel={benchLabel} m={d.info.methodology} />
        ))
      )}
    </div>
  );
}

function Panel({ idx, title, mode, p, set, data, sync, height, rangeKey, benchLabel, m }) {
  const { inst, bench, aligned } = data;
  const built = useMemo(() => {
    const method = m.indicators.rsiMethod, per = m.indicators.rsiPeriod;
    const bars = aggregate({ time: inst.time, open: inst.open, high: inst.high, low: inst.low, close: inst.close, volume: inst.volume || inst.close.map(() => 0) }, p.tf);
    let times, base, kind;
    if (idx === 0) { times = bars.time; base = bars.close; kind = "price"; }
    else if (mode.base === "rsi") {
      times = bars.time; let s = bars.close;
      for (let k = 0; k < idx; k++) s = rsi(s, per, method);
      base = s; kind = "osc";
    } else {
      if (!bench || !aligned) return null;
      const r = rsc(inst.time, aligned.a, bench.time, aligned.b, p.tf, m.indicators.rscRebase);
      times = r.time; let s = r.value;
      for (let k = 1; k < idx; k++) s = rsi(s, per, method);
      base = s; kind = idx === 1 ? "rsc" : "osc";
    }
    const lines = [];
    const periods = mode.overlay === "acc" ? ACC : [...SHORT, ...LONG];
    for (const per2 of periods) {
      const isShort = SHORT.includes(per2);
      if (!p.emas[per2]) continue;
      if (mode.overlay === "mma" && ((isShort && !p.short) || (!isShort && !p.long))) continue;
      const e = emaStrict(base, per2);
      const color = mode.overlay === "acc" ? ACC_COLORS[per2] : isShort ? "#facc15" : "#ef4444";
      lines.push({ id: `e${per2}`, type: "line", data: lineData(times, e), options: { color, lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false } });
    }
    const series = [];
    if (kind === "price" && inst.kind === "sec") {
      series.push({ id: "base", type: "candles", data: bars.time.map((t, i) => ({ time: t, open: bars.open[i], high: bars.high[i], low: bars.low[i], close: bars.close[i] })),
        options: { upColor: "#16a34a", downColor: "#dc2626", borderVisible: false, wickUpColor: "#16a34a", wickDownColor: "#dc2626", visible: p.base } });
    } else {
      series.push({ id: "base", type: "line", data: lineData(times, base), options: { color: kind === "rsc" ? "#e5e7eb" : "#a78bfa", lineWidth: 2, visible: p.base },
        priceLines: kind === "osc" ? [{ price: 70, color: "#dc2626", title: "" }, { price: 50, color: "#6b7280", title: "" }, { price: 30, color: "#16a34a", title: "" }] : kind === "rsc" ? [{ price: 100, color: "#6b7280", title: "" }] : [] });
    }
    // the anchor (first series) must keep data for crosshair sync even when hidden
    return { series: [...series, ...lines], last: base[base.length - 1], lastTime: times[times.length - 1], n: times.length };
  }, [inst, bench, aligned, p, idx, mode, m]);

  const visibleRange = useMemo(() => {
    if (!inst.time.length) return null;
    const to = inst.time[inst.time.length - 1];
    const y = +to.slice(0, 4) - (p.tf === "M" || p.tf === "Q" || p.tf === "Y" ? 10 : 2);
    return { from: `${y}${to.slice(4)}`, to };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inst, rangeKey]);

  const periods = mode.overlay === "acc" ? ACC : [...SHORT, ...LONG];
  return (
    <div className="card tight" style={{ padding: 0 }}>
      <div className="panel-head">
        <div className="row" style={{ gap: 10 }}>
          <b>{title}{idx > 0 && mode.base === "rsc" ? <span className="muted small"> vs {benchLabel}</span> : null}</b>
          <Seg value={p.tf} options={["D", "W", "M", "Q", "Y"].map((t) => ({ value: t, label: t }))} onChange={(tf) => set({ tf })} title="Timeframe of this window" />
          <span className="small muted">{TF_LABEL[p.tf]} · {built ? `${built.n} candles · last ${built.lastTime} = ${built.last != null ? built.last.toFixed(2) : "—"}` : "no comparison series"}</span>
        </div>
        <div className="legend">
          <Check checked={p.base} onChange={(v) => set({ base: v })}>{idx === 0 ? "Price" : idx === 1 && mode.base === "rsc" ? "RSC" : idx === 1 ? "RSI" : "Line"}</Check>
          {mode.overlay === "mma" && <><Check checked={p.short} onChange={(v) => set({ short: v })} color="#facc15">Short group</Check><Check checked={p.long} onChange={(v) => set({ long: v })} color="#ef4444">Long group</Check></>}
          {periods.map((per) => (
            <Check key={per} checked={p.emas[per]} onChange={(v) => set({ emas: { ...p.emas, [per]: v } })} color={mode.overlay === "acc" ? ACC_COLORS[per] : SHORT.includes(per) ? "#facc15" : "#ef4444"}>{per}</Check>
          ))}
        </div>
      </div>
      {built ? <TvChart height={height} series={built.series} sync={sync} visibleRange={visibleRange} rangeKey={rangeKey} fit={false} /> : <div className="empty">Select a comparison instrument</div>}
    </div>
  );
}
