// The four stacked screens in the look of the owner's "Analyst" software
// (black background, two timeframes side by side, log scale everywhere):
//   RSIMMA / RSIACC  Price | RSI | RSI of RSI | RSI of RSI of RSI
//   RSCMMA / RSCACC  Price | RSC | RSI of RSC | RSI of RSI of RSC | RSI of RSI of RSI of RSC
// MMA = short EMA 3-15 (yellow) + long EMA 30-60 (red); ACC = EMA 4 / 14 / 26 / 39.
// All maths is engine/analyst.js; this page only draws it.
import { useEffect, useMemo, useState } from "react";
import { useData } from "../data/store.jsx";
import { useAsync } from "../lib/useAsync.js";
import { navigate } from "../lib/router.js";
import { Seg, Check, Badge, Loading, Empty } from "../components/ui.jsx";
import { TvChart, ChartSync } from "../components/TvChart.jsx";
import { InstrumentPicker, TfPicker } from "../components/pickers.jsx";
import { loadInstrument, alignCurrency, defaultBenchmark } from "../lib/series.js";
import { usePersistent } from "../lib/storage.js";
import { tfLabel, tfMonths } from "../../engine/calendar.js";
import { ANALYST_MODES, ACC_PERIODS, MMA_SHORT, buildAnalystColumn, analystDate } from "../../engine/analyst.js";

const YELLOW = "#ffff00", RED = "#e00000", GREEN = "#00ff00", CYAN = "#00ffff", WHITE = "#ffffff", MAGENTA = "#ff00ff";
const ACC_COLOR = { 4: CYAN, 14: RED, 26: WHITE, 39: YELLOW };
// raw-line colour per row in the ACC screens, as in the reference screenshots
const ACC_BASE = { RSIACC: [GREEN, GREEN, YELLOW, MAGENTA], RSCACC: [GREEN, YELLOW, GREEN, CYAN, MAGENTA] };
const PRESETS = [["D", "W"], ["M", "Q"], ["H", "N"], ["Y", "24M"]];
const DEFAULT_VIEW = { avgOnly: false, log: true, short: true, long: true, acc: { 4: true, 14: true, 26: true, 39: true } };

const DARK = {
  layout: { background: { color: "#000000" }, textColor: "#d4d4d4", fontSize: 10 },
  grid: { vertLines: { visible: false }, horzLines: { visible: false } },
  rightPriceScale: { borderColor: "#3f3f3f" },
  timeScale: { borderColor: "#3f3f3f" },
};
const DARK_NO_AXIS = { ...DARK, timeScale: { ...DARK.timeScale, visible: false } };

const fmt = (v) => (v == null ? "—" : v.toFixed(2));

export default function StackedScreens({ route }) {
  const d = useData();
  const mode = ANALYST_MODES[route.args[0]] ? route.args[0] : "RSIMMA";
  const cfg = ANALYST_MODES[mode];
  const secId = route.args[1] || route.query.id || [...d.rows].sort((a, b) => (b.sec.capUsdNow || 0) - (a.sec.capUsdNow || 0))[0]?.id;
  const sec = d.secById.get(secId);
  const [view, setView] = usePersistent("analyst.view", DEFAULT_VIEW);
  const v = { ...DEFAULT_VIEW, ...view, acc: { ...DEFAULT_VIEW.acc, ...(view?.acc || {}) } };
  const setV = (patch) => setView({ ...v, ...patch });
  const [tfs, setTfs] = usePersistent(`analyst.tf.${mode}`, null);
  const left = tfs?.left || "D", right = tfs?.right || "W";
  const setTf = (side, tf) => setTfs({ left, right, [side]: tf });
  const [active, setActive] = useState(1);
  const [rangeKey, setRangeKey] = useState(0);
  const [syncs] = useState(() => [new ChartSync(), new ChartSync()]);
  const [vh, setVh] = useState(window.innerHeight);
  useEffect(() => { const h = () => setVh(window.innerHeight); window.addEventListener("resize", h); return () => window.removeEventListener("resize", h); }, []);

  // benchmark: ?bench=, else BSE 500 for an Indian stock (the owner's reference), else the country CW index
  const bse500 = useMemo(() => d.secs.find((x) => x.symbol === "BSE500"), [d.secs]);
  const benchRef = route.query.bench
    ? (route.query.bench.startsWith("idx:") ? { kind: "index", key: route.query.bench.slice(4) } : { kind: "sec", id: route.query.bench })
    : sec?.country === "India" && bse500 && bse500.id !== secId ? { kind: "sec", id: bse500.id } : defaultBenchmark(sec);
  const benchLabel = benchRef.kind === "index" ? d.indexByKey.get(benchRef.key)?.name || benchRef.key : d.secById.get(benchRef.id)?.symbol;

  const { data, loading, error } = useAsync(async () => {
    if (!secId) return null;
    const inst = await loadInstrument(d.api, { kind: "sec", id: secId }, d);
    let bench = null, aligned = null;
    if (inst && cfg.base === "rsc") {
      bench = await loadInstrument(d.api, benchRef, d);
      if (bench) aligned = await alignCurrency(d.api, inst, bench);
    }
    return { inst, bench, aligned };
  }, [secId, cfg.base, benchRef.kind, benchRef.key, benchRef.id]);

  useEffect(() => { setRangeKey((k) => k + 1); }, [secId, mode, left, right]);

  const m = d.info.methodology.indicators;
  const columns = useMemo(() => {
    if (!data?.inst) return null;
    const { inst, bench, aligned } = data;
    return [left, right].map((tf) => buildAnalystColumn({
      mode, tf, bars: inst, benchLabel,
      bench: bench && aligned ? { time: bench.time, close: aligned.b } : null, rscCloses: aligned?.a,
      rsiPeriod: m.rsiPeriod, rsiMethod: m.rsiMethod, rscBase: m.rscRebase,
    }));
  }, [data, left, right, mode, benchLabel, m]);

  const go = (r) => navigate(`screens/${mode}/${r.id}`, route.query.bench ? { bench: route.query.bench } : undefined);
  const setBench = (r) => navigate(`screens/${mode}/${secId}`, { bench: r.kind === "index" ? `idx:${r.key}` : r.id });
  const nRows = cfg.base === "rsc" ? 5 : 4;
  const paneH = Math.max(90, Math.floor((vh - 200) / (nRows + 0.35)));

  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <Seg value={mode} options={Object.keys(ANALYST_MODES)} onChange={(x) => navigate(`screens/${x}/${secId || ""}`, route.query.bench ? { bench: route.query.bench } : undefined)} />
        <InstrumentPicker value={sec ? { label: `${sec.symbol} · ${sec.name}` } : null} onChange={(r) => r.kind === "sec" && go(r)} allowIndex={false} placeholder="Instrument…" width={230} />
        {cfg.base === "rsc" && <><span className="small muted">vs</span><InstrumentPicker value={{ label: benchLabel }} onChange={setBench} placeholder="Comparison stock or index…" width={200} /></>}
        <span className="small muted">Left</span><TfPicker value={left} onChange={(tf) => setTf("left", tf)} />
        <span className="small muted">Right</span><TfPicker value={right} onChange={(tf) => setTf("right", tf)} />
        <div className="seg">{PRESETS.map(([a, b]) => <button key={a + b} className={left === a && right === b ? "on" : ""} onClick={() => setTfs({ left: a, right: b })}>{`${tfLabel(a)} | ${tfLabel(b)}`}</button>)}</div>
      </div>
      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        <button className={`btn sm ${v.avgOnly ? "primary" : ""}`} onClick={() => setV({ avgOnly: !v.avgOnly })} title="Hide every price / RSI / RSC line and keep only the averages">{v.avgOnly ? "Averages only: ON" : "Averages only"}</button>
        <Check checked={v.log} onChange={(x) => setV({ log: x })}>Log scale</Check>
        {cfg.overlay === "mma" ? <>
          <Check checked={v.short} onChange={(x) => setV({ short: x })} color={YELLOW}>Short EMA 3-15</Check>
          <Check checked={v.long} onChange={(x) => setV({ long: x })} color={RED}>Long EMA 30-60</Check>
        </> : ACC_PERIODS.map((p) => <Check key={p} checked={v.acc[p]} onChange={(x) => setV({ acc: { ...v.acc, [p]: x } })} color={ACC_COLOR[p]}>EMA {p}</Check>)}
        <button className="btn sm" onClick={() => setRangeKey((k) => k + 1)} title="Back to the default window">⇥ Latest</button>
        {sec && <a className="btn sm" href={`#/stock/${sec.id}`}>Stock page</a>}
        {data?.aligned && data.aligned.currency === "USD" && data.inst.currency !== "USD" && <Badge>RSC in USD (different currencies)</Badge>}
        {data?.inst?.adjustments?.length > 0 && <Badge kind="b">split-adjusted ({data.inst.adjustments.length})</Badge>}
      </div>
      {!secId ? <Empty>Pick an instrument</Empty> : loading ? <Loading what="series" /> : error ? <div className="note warn">{String(error.message)}</div> : !columns ? <Empty>No price history</Empty> : (
        <div className="anl">
          {columns.map((col, ci) => (
            <div key={ci} className="anl-col" onMouseDown={() => setActive(ci)}>
              <div className={`anl-head ${active === ci ? "on" : ""}`}>
                {tfLabel(col.tf)}{col.header ? `  ${fmt(col.header.open)}  ${fmt(col.header.high)}  ${fmt(col.header.low)}  ${fmt(col.header.close)}  [ ${col.header.chg == null ? "—" : `${col.header.chg >= 0 ? "" : "-"}${Math.abs(col.header.chg * 100).toFixed(2)}%`} ] - ${analystDate(col.header.date)}` : "  no data"}
              </div>
              {col.rows.map((row, ri) => (
                <Pane key={`${ci}-${ri}`} row={row} ri={ri} last={ri === col.rows.length - 1} mode={mode} overlay={cfg.overlay} v={v} tf={col.tf}
                  height={ri === 0 ? Math.round(paneH * 1.35) : paneH} sync={syncs[ci]} rangeKey={`${rangeKey}|${ci}`} />
              ))}
            </div>
          ))}
        </div>
      )}
      <div className="small muted">RSI {m.rsiPeriod} and every EMA are counted in candles of that column. n-month candles run on a fixed grid from January 2000 (2M, 4M and 2Y line up with the calendar). Click a column to select it.</div>
    </div>
  );
}

function Pane({ row, ri, last, mode, overlay, v, tf, height, sync, rangeKey }) {
  const built = useMemo(() => {
    if (!row.time.length) return null;
    const keep = (x) => x != null && Number.isFinite(x) && (!v.log || x > 0);
    const line = (vals) => { const out = []; for (let i = 0; i < row.time.length; i++) if (keep(vals[i])) out.push({ time: row.time[i], value: vals[i] }); return out; };
    const baseColor = overlay === "mma" ? YELLOW : (ACC_BASE[mode] || [])[ri] || GREEN;
    const lvl = row.kind === "rsi" ? [30, 50, 70].map((p) => ({ price: p, color: "#bdbdbd", lineWidth: 1, lineStyle: 0, axisLabelVisible: false, title: "" })) : [];
    // the base line is the crosshair anchor and carries the 30 / 50 / 70 lines, so "averages only"
    // makes it transparent rather than removing it (the scale and the level lines stay put)
    const series = [{ id: "base", type: "line", data: line(row.base), priceLines: lvl,
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
    const months = tfMonths(tf);
    if (months >= 1) return null;
    const show = months < 0.1 ? 500 : 520;
    return { from: t[Math.max(0, n - show)], to: t[n - 1] };
  }, [row.time, tf]);

  return (
    <div className="anl-pane">
      <div className="anl-label">{row.label}</div>
      {built ? <TvChart height={height} series={built} sync={sync} logScale={v.log} visibleRange={visibleRange} rangeKey={rangeKey} fit theme={last ? DARK : DARK_NO_AXIS} />
        : <div className="anl-empty" style={{ height }}>{row.missing || "no data"}</div>}
    </div>
  );
}
