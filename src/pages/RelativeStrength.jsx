// Relative strength: rankings, the RSC pair matrix and RSC signal detection.
import { useMemo, useState } from "react";
import { useData } from "../data/store.jsx";
import { useAsync } from "../lib/useAsync.js";
import { navigate } from "../lib/router.js";
import { PageHead, Seg, Select, Tabs, Badge, Pct, Loading } from "../components/ui.jsx";
import { DataTable } from "../components/DataTable.jsx";
import { TvChart, lineData } from "../components/TvChart.jsx";
import { InstrumentPicker, ScopeFilter, applyScope, idColumns, fieldColumn } from "../components/pickers.jsx";
import { loadInstrument, alignCurrency } from "../lib/series.js";
import { analyzeRsc as rscSignals } from "../../engine/signals.js";
import { changeOver, HBARS } from "../lib/indexMath.js";

const BENCH = [{ value: "country", label: "Country" }, { value: "countrySector", label: "Sector (in country)" }, { value: "region", label: "Region" }, { value: "global", label: "Global" }];

export default function RelativeStrength({ route }) {
  const [tab, setTab] = useState(route.query.tab || "rank");
  return (
    <div className="stack">
      <PageHead title="Relative strength" sub="RSC = instrument / benchmark, both on the same candle timeframe and in one currency (USD when they differ), rebased to 100. Rising RSC = outperforming." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "rank", label: "Stock ranking" }, { value: "sectors", label: "Sector & country ranking" }, { value: "pair", label: "Pair matrix" }, { value: "signals", label: "RSC signals" }]} />
      {tab === "rank" && <Ranking />}
      {tab === "sectors" && <GroupRanking />}
      {tab === "pair" && <PairMatrix route={route} />}
      {tab === "signals" && <Signals />}
    </div>
  );
}

function Ranking() {
  const d = useData();
  const [scope, setScope] = useState({});
  const [bench, setBench] = useState("country");
  const [h, setH] = useState("3M");
  const rows = useMemo(() => applyScope(d.rows, scope).filter((r) => r.flat[`rscChg_${bench}_${h}`] != null), [d.rows, scope, bench, h]);
  const ranked = useMemo(() => { const s = [...rows].sort((a, b) => b.flat[`rscChg_${bench}_${h}`] - a.flat[`rscChg_${bench}_${h}`]); return s.map((r, i) => ({ ...r, rank: i + 1, pctile: Math.round(100 - (i / s.length) * 100) })); }, [rows, bench, h]);
  return (
    <div className="stack">
      <div className="row"><ScopeFilter scope={scope} onChange={setScope} /><Select label="Benchmark" value={bench} options={BENCH} onChange={setBench} /><Seg value={h} options={["1M", "3M", "6M", "12M"]} onChange={setH} /></div>
      <DataTable exportName="rs_ranking" rows={ranked} initialSort={{ key: "rank", dir: "asc" }}
        columns={[{ key: "rank", label: "#", num: true, value: (r) => r.rank }, ...idColumns(["country", "sector", "cap"]), fieldColumn(`rscChg_${bench}_${h}`, { label: `RSC Δ ${h}` }),
          { key: "pct", label: "Percentile", num: true, value: (r) => r.pctile }, fieldColumn(`rscRising_${bench}_W`, { label: "Rising (W)" }), fieldColumn(`rscTurnUp_${bench}_W`, { label: "Inflection (W)" }), fieldColumn(`rscHigh_${bench}_W`, { label: "RSC high (W)" }), fieldColumn(`ret${h}`)]} />
    </div>
  );
}

function GroupRanking() {
  const d = useData();
  const [scope, setScope] = useState("G");
  const [kind, setKind] = useState("sector");
  const [h, setH] = useState("3M");
  const scopes = [{ value: "G", label: "Global" }, ...d.regions.map((r) => ({ value: `R:${r}`, label: r })), ...d.countries.map((c) => ({ value: `C:${c}`, label: c }))];
  const ccy = scope.startsWith("C:") ? "LCL" : "USD";
  const items = useMemo(() => {
    if (kind === "country") return d.countries.filter((c) => scope === "G" || d.secs.some((s) => s.country === c && `R:${s.region}` === scope)).map((c) => ({ name: c, key: `CW|USD|C:${c}` }));
    if (kind === "cap") return ["Large", "Mid", "Small"].map((c) => ({ name: `${c} Cap`, key: scope === "G" ? `CW|USD|G|K:${c}` : `CW|${ccy}|${scope}|K:${c}` }));
    return d.sectors.map((s) => ({ name: s, key: `CW|${ccy}|${scope}|S:${s}` }));
  }, [kind, scope, d, ccy]);
  const benchKey = kind === "country" ? `CW|USD|${scope}` : `CW|${ccy}|${scope}`;
  const { data, loading } = useAsync(async () => {
    const b = await d.api.indexSeries(benchKey);
    const s = await Promise.all(items.map((x) => (d.indexByKey.has(x.key) ? d.api.indexSeries(x.key) : null)));
    return { b, s };
  }, [benchKey, items.map((x) => x.key).join()]);
  const rows = useMemo(() => !data ? [] : items.map((x, i) => {
    const s = data.s[i]; if (!s) return null;
    const rel = (k) => { const a = changeOver(s, HBARS[k]), b = changeOver(data.b, HBARS[k]); return a != null && b != null ? ((1 + a / 100) / (1 + b / 100) - 1) * 100 : null; };
    const sig = rscSignals(s.dates, s.level, { time: data.b.dates, close: data.b.level }, "W");
    return { id: x.key, name: x.name, ret: changeOver(s, HBARS[h]), rel: rel(h), r1: rel("1M"), r12: rel("12M"), rising: sig?.rising, turnUp: sig?.turnUp, atHigh: sig?.atHigh };
  }).filter(Boolean), [data, items, h]);
  return (
    <div className="stack">
      <div className="row"><Select label="Within" value={scope} options={scopes} onChange={setScope} /><Seg value={kind} options={[{ value: "sector", label: "Sectors" }, { value: "country", label: "Countries" }, { value: "cap", label: "Cap segments" }]} onChange={setKind} /><Seg value={h} options={["1M", "3M", "6M", "12M"]} onChange={setH} /></div>
      {loading ? <Loading /> : <DataTable exportName="group_rs" rows={rows} initialSort={{ key: "rel", dir: "desc" }} onRowClick={(r) => navigate("indices", { key: r.id })}
        columns={[{ key: "name", label: "Name", value: (r) => r.name }, { key: "ret", label: `Return ${h}`, num: true, value: (r) => r.ret, render: (r) => <Pct v={r.ret} /> },
          { key: "rel", label: `RSC Δ ${h}`, num: true, value: (r) => r.rel, render: (r) => <Pct v={r.rel} /> }, { key: "r1", label: "RSC Δ 1M", num: true, value: (r) => r.r1, render: (r) => <Pct v={r.r1} /> }, { key: "r12", label: "RSC Δ 12M", num: true, value: (r) => r.r12, render: (r) => <Pct v={r.r12} /> },
          { key: "rising", label: "Rising (W)", value: (r) => r.rising }, { key: "turn", label: "Inflection (W)", value: (r) => r.turnUp }, { key: "hi", label: "RSC high (W)", value: (r) => r.atHigh }]} />}
    </div>
  );
}

function presetPairs(d, sec) {
  const out = [];
  if (sec) {
    out.push(["Stock vs its sector", { kind: "sec", id: sec.id }, { kind: "index", key: `CW|LCL|C:${sec.country}|S:${sec.sector}` }]);
    out.push(["Stock vs its country", { kind: "sec", id: sec.id }, { kind: "index", key: `CW|LCL|C:${sec.country}` }]);
    out.push(["Stock vs its region", { kind: "sec", id: sec.id }, { kind: "index", key: `CW|USD|R:${sec.region}` }]);
    out.push(["Stock vs global", { kind: "sec", id: sec.id }, { kind: "index", key: "CW|USD|G" }]);
    out.push(["Sector vs country", { kind: "index", key: `CW|LCL|C:${sec.country}|S:${sec.sector}` }, { kind: "index", key: `CW|LCL|C:${sec.country}` }]);
    out.push(["Sector vs global sector", { kind: "index", key: `CW|USD|C:${sec.country}|S:${sec.sector}` }, { kind: "index", key: `CW|USD|G|S:${sec.sector}` }]);
    out.push(["Country vs region", { kind: "index", key: `CW|USD|C:${sec.country}` }, { kind: "index", key: `CW|USD|R:${sec.region}` }]);
    out.push(["Country vs global", { kind: "index", key: `CW|USD|C:${sec.country}` }, { kind: "index", key: "CW|USD|G" }]);
    out.push(["Country EW vs CW", { kind: "index", key: `EW|LCL|C:${sec.country}` }, { kind: "index", key: `CW|LCL|C:${sec.country}` }]);
    out.push(["Country small vs large cap", { kind: "index", key: `CW|LCL|C:${sec.country}|K:Small` }, { kind: "index", key: `CW|LCL|C:${sec.country}|K:Large` }]);
    out.push(["Country mid vs large cap", { kind: "index", key: `CW|LCL|C:${sec.country}|K:Mid` }, { kind: "index", key: `CW|LCL|C:${sec.country}|K:Large` }]);
  }
  out.push(["Global EW vs CW", { kind: "index", key: "EW|USD|G" }, { kind: "index", key: "CW|USD|G" }]);
  out.push(["Global small vs large cap", { kind: "index", key: "CW|USD|G|K:Small" }, { kind: "index", key: "CW|USD|G|K:Large" }]);
  out.push(["Emerging vs global", { kind: "index", key: "CW|USD|M:Emerging Markets" }, { kind: "index", key: "CW|USD|G" }]);
  for (const r of d.regions) out.push([`${r} vs global`, { kind: "index", key: `CW|USD|R:${r}` }, { kind: "index", key: "CW|USD|G" }]);
  return out.filter(([, a, b]) => (a.kind === "sec" || d.indexByKey.has(a.key)) && d.indexByKey.has(b.key));
}

function PairMatrix({ route }) {
  const d = useData();
  const secId = route.query.id || [...d.rows].sort((a, b) => (b.sec.capUsdNow || 0) - (a.sec.capUsdNow || 0))[0]?.id;
  const sec = d.secById.get(secId);
  const presets = useMemo(() => presetPairs(d, sec), [d, sec]);
  const [num, setNum] = useState(null), [den, setDen] = useState(null), [tf, setTf] = useState("W");
  const A = num || presets[0]?.[1], B = den || presets[0]?.[2];
  const { data, loading } = useAsync(async () => {
    const [a, b] = await Promise.all([loadInstrument(d.api, A, d), loadInstrument(d.api, B, d)]);
    if (!a || !b) return null;
    const al = await alignCurrency(d.api, a, b);
    return { a, b, al };
  }, [A?.id, A?.key, B?.id, B?.key]);
  const sig = useMemo(() => (data ? rscSignals(data.a.time, data.al.a, { time: data.b.time, close: data.al.b }, tf) : null), [data, tf]);
  const label = (x) => (x?.kind === "sec" ? d.secById.get(x.id)?.symbol : d.indexByKey.get(x?.key)?.name || x?.key);
  const row = d.rowById.get(secId);
  return (
    <div className="stack">
      <div className="row"><span className="small muted">Stock for stock-level pairs:</span>
        <InstrumentPicker value={sec ? { label: `${sec.symbol} · ${sec.name}` } : null} onChange={(r) => r.kind === "sec" && navigate("rs", { tab: "pair", id: r.id })} secOnly /></div>
      <div className="row">{presets.map(([l, a, b]) => <button key={l} className={`btn sm ${A === a ? "primary" : ""}`} onClick={() => { setNum(a); setDen(b); }}>{l}</button>)}</div>
      <div className="row"><span className="small">Numerator</span><InstrumentPicker value={{ label: label(A) }} onChange={setNum} /><span className="small">÷ Benchmark</span><InstrumentPicker value={{ label: label(B) }} onChange={setDen} /><Seg value={tf} options={["D", "W", "M"]} onChange={setTf} /></div>
      {loading ? <Loading /> : sig ? (
        <div className="grid" style={{ gridTemplateColumns: "minmax(0,1fr) 300px" }}>
          <div className="card tight"><TvChart height={340} series={[{ type: "line", data: lineData(sig.time, sig.value), options: { color: "#e5e7eb", lineWidth: 2, title: `${label(A)} / ${label(B)}` }, priceLines: [{ price: 100, color: "#6b7280" }] }, { type: "line", data: lineData(sig.time, sig.ema), options: { color: "#14a44d", lineWidth: 1, title: "EMA10" } }]} /></div>
          <div className="card"><h3>Signals ({tf})</h3>
            <div className="stack" style={{ gap: 4 }}>
              <div>{sig.rising ? <Badge kind="g">RSC rising</Badge> : sig.falling ? <Badge kind="r">RSC falling</Badge> : <Badge>Flat</Badge>}</div>
              {sig.turnUp && <Badge kind="g">Upward inflection</Badge>}{sig.turnDown && <Badge kind="r">Downward inflection</Badge>}
              {sig.atHigh && <Badge kind="g">RSC at 52-bar high</Badge>}{sig.atLow && <Badge kind="r">RSC at 52-bar low</Badge>}
              {Object.entries(sig.chg).map(([k, v]) => <div key={k} className="row between small"><span>Δ {k}</span><Pct v={v} /></div>)}
              <div className="small muted">Compared in {data.al.currency}.</div>
            </div>
          </div>
        </div>) : <div className="note">Pick two instruments.</div>}
      {row && <div className="card"><h3>{sec.symbol}: RSC against every benchmark</h3>
        <table className="tbl"><thead><tr><th>Benchmark</th><th className="num">Δ 1M</th><th className="num">Δ 3M</th><th className="num">Δ 6M</th><th className="num">Δ 12M</th><th>Rising (D/W)</th><th>Inflection (W)</th><th>52-bar high (W)</th></tr></thead><tbody>
          {BENCH.map((b) => <tr key={b.value}><td>{b.label}</td>{["1M", "3M", "6M", "12M"].map((h) => <td key={h} className="num"><Pct v={row.flat[`rscChg_${b.value}_${h}`]} /></td>)}
            <td>{String(row.flat[`rscRising_${b.value}_D`] ?? "—")} / {String(row.flat[`rscRising_${b.value}_W`] ?? "—")}</td><td>{String(row.flat[`rscTurnUp_${b.value}_W`] ?? "—")}</td><td>{String(row.flat[`rscHigh_${b.value}_W`] ?? "—")}</td></tr>)}
        </tbody></table></div>}
    </div>
  );
}

function Signals() {
  const d = useData();
  const [scope, setScope] = useState({});
  const [bench, setBench] = useState("country");
  const [sigType, setSig] = useState("turnUp");
  const SIG = { turnUp: [`rscTurnUp_${bench}_W`, "Upward inflection (W)"], rising: [`rscRising_${bench}_W`, "Rising (W)"], high: [`rscHigh_${bench}_W`, "RSC 52-bar high break (W)"], low: [`rscLow_${bench}_W`, "RSC 52-bar low (W)"], divBull: ["rscDivergence", "Bullish price-RSC divergence"], divBear: ["rscDivergence", "Bearish price-RSC divergence"] };
  const sigField = SIG[sigType][0];
  const rows = useMemo(() => applyScope(d.rows, scope).filter((r) => (sigType === "divBull" ? r.flat.rscDivergence === "bullish" : sigType === "divBear" ? r.flat.rscDivergence === "bearish" : r.flat[sigField] === true)), [d.rows, scope, sigType, sigField]);
  return (
    <div className="stack">
      <div className="row"><ScopeFilter scope={scope} onChange={setScope} /><Select label="Benchmark" value={bench} options={BENCH} onChange={setBench} />
        <Select label="Signal" value={sigType} options={Object.entries(SIG).map(([v, [, l]]) => ({ value: v, label: l }))} onChange={setSig} /></div>
      <DataTable exportName="rsc_signals" rows={rows} initialSort={{ key: `rscChg_${bench}_3M`, dir: "desc" }}
        columns={[...idColumns(["country", "sector", "cap"]), fieldColumn(`rscChg_${bench}_1M`), fieldColumn(`rscChg_${bench}_3M`), fieldColumn("rscDivergence"), fieldColumn("mmaW"), fieldColumn("ret3M")]} />
    </div>
  );
}
