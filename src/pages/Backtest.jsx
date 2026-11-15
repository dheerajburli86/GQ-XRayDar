// Backtesting, historical pattern library and the inflection database.
// Entry is the close of the session AFTER a signal, forward returns run
// 1/3/6/12 months, excess is against the stock's country CW index for the same
// dates, and the universe includes delisted names (no survivorship bias).
import { useMemo, useState } from "react";
import { useData } from "../data/store.jsx";
import { useAsync } from "../lib/useAsync.js";
import { PageHead, Tabs, Select, Seg, Pct, Loading, StockLink, Badge } from "../components/ui.jsx";
import { DataTable } from "../components/DataTable.jsx";
import { ScopeFilter, applyScope, InstrumentPicker } from "../components/pickers.jsx";
import { backtestEvents, HORIZON_KEYS } from "../../engine/backtest.js";
import { EVENT_LABEL } from "../../engine/signals.js";
import { usePersistent } from "../lib/storage.js";
import { navigate } from "../lib/router.js";
import { RuleEditor, ReportCard } from "../components/RuleCard.jsx";
import { walkForward, sensitivity } from "../../engine/validation.js";
import { DEFAULT_PARAMS, RULES, describeRule } from "../../engine/rules.js";

const TYPES = Object.keys(EVENT_LABEL);

export default function Backtest({ route }) {
  const [tab, setTab] = useState(route.query.tab || "idea");
  return (
    <div className="stack">
      <PageHead title="Backtest, pattern library & inflection database" sub="Bias controls: signals use data up to the signal bar only; entry is the next session's close; delisted stocks stay in the universe; split adjustments are applied before any calculation." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "idea", label: "Test an idea" }, { value: "summary", label: "Signal scorecard" }, { value: "custom", label: "Custom backtest" }, { value: "wf", label: "Walk-forward & sensitivity" }, { value: "library", label: "Pattern library" }, { value: "log", label: "Inflection database" }]} />
      {tab === "idea" && <Idea />}
      {tab === "summary" && <Summary />}
      {tab === "custom" && <Custom />}
      {tab === "wf" && <WalkForward />}
      {tab === "library" && <Library route={route} />}
      {tab === "log" && <Log route={route} />}
    </div>
  );
}

function Idea() {
  const [wls] = usePersistent("watchlists", {});
  const [rule, setRule] = useState({ rule: "rsi_cross_below", params: { level: 30 }, tf: "D" });
  const [on, setOn] = useState("top");
  const [inst, setInst] = useState(null);
  const [wl, setWl] = useState(null);
  const ids = on === "stock" ? (inst ? [inst.id] : []) : on === "wl" ? wls[wl]?.ids || [] : null;
  return (
    <div className="stack">
      <div className="card stack">
        <div className="small">"What if I had acted every time this happened?" Pick a signal and where to test it; each past signal is followed for three periods, entering at the next candle's close.</div>
        <RuleEditor value={rule} onChange={setRule} />
        <div className="row">
          <Seg value={on} options={[{ value: "top", label: "Largest stocks" }, { value: "stock", label: "One stock" }, { value: "wl", label: "A watchlist" }]} onChange={setOn} />
          {on === "stock" && <InstrumentPicker allowIndex={false} value={inst} onChange={setInst} />}
          {on === "wl" && <Select value={wl} options={Object.entries(wls).map(([k, v]) => ({ value: k, label: v.name }))} onChange={setWl} allowEmpty="Pick" />}
        </div>
      </div>
      {(on === "top" || ids?.length > 0) && <ReportCard key={JSON.stringify([rule, on, ids])} rule={rule} ids={ids} title="Result" />}
    </div>
  );
}

function Summary() {
  const d = useData();
  const { data, loading } = useAsync(() => d.api.backtestSummary(), []);
  const [scope, setScope] = useState("G");
  const [h, setH] = useState("3M");
  const scopes = useMemo(() => [...new Set((data || []).map((r) => r.scope))].sort((a, b) => (a === "G" ? -1 : b === "G" ? 1 : a.localeCompare(b))), [data]);
  const rows = (data || []).filter((r) => r.scope === scope && r.horizon === h).map((r) => ({ ...r, id: r.type }));
  if (loading) return <Loading />;
  return (
    <div className="stack">
      <div className="row"><Select label="Universe" value={scope} options={scopes.map((s) => ({ value: s, label: s === "G" ? "Global" : s.slice(2) }))} onChange={setScope} /><Seg value={h} options={HORIZON_KEYS} onChange={setH} /></div>
      <DataTable exportName={`scorecard_${scope}_${h}`} rows={rows} initialSort={{ key: "ex", dir: "desc" }}
        columns={[{ key: "type", label: "Signal", value: (r) => EVENT_LABEL[r.type] || r.type }, { key: "n", label: "Occurrences", num: true, value: (r) => r.n },
          { key: "mean", label: `Mean ${h}`, num: true, value: (r) => r.mean, render: (r) => <Pct v={r.mean} /> }, { key: "med", label: "Median", num: true, value: (r) => r.median, render: (r) => <Pct v={r.median} /> },
          { key: "hit", label: "Hit rate %", num: true, value: (r) => r.hitRate }, { key: "ex", label: "Mean excess vs country", num: true, value: (r) => r.excessMean, render: (r) => <Pct v={r.excessMean} /> },
          { key: "exh", label: "Excess hit %", num: true, value: (r) => r.excessHitRate }, { key: "mfe", label: "Avg max gain 3M", num: true, value: (r) => r.mfe, render: (r) => <Pct v={r.mfe} /> }, { key: "mae", label: "Avg max loss 3M", num: true, value: (r) => r.mae, render: (r) => <Pct v={r.mae} /> }]} />
      <div className="small muted">Medians are binned at 0.5% resolution over the full history. Excess = stock return in its country currency minus the country CW index over the same dates.</div>
    </div>
  );
}

function Custom() {
  const d = useData();
  const [wls] = usePersistent("watchlists", {});
  const [scope, setScope] = useState({});
  const [wl, setWl] = useState(null);
  const [type, setType] = useState("mma_bull_align");
  const [run, setRun] = useState(0);
  const universe = useMemo(() => {
    if (wl && wls[wl]) return wls[wl].ids;
    return applyScope(d.rows, scope).sort((a, b) => (b.sec.capUsdNow || 0) - (a.sec.capUsdNow || 0)).slice(0, 400).map((r) => r.id);
  }, [wl, wls, scope, d.rows]);
  const { data, loading } = useAsync(async () => (run ? d.api.eventsMany(universe) : null), [run]);
  const events = useMemo(() => (data ? Object.entries(data).flatMap(([id, ev]) => ev.filter((e) => e.type === type).map((e) => ({ ...e, id, sec: d.secById.get(id) }))) : []), [data, type, d.secById]);
  const stats = useMemo(() => backtestEvents(events), [events]);
  return (
    <div className="stack">
      <div className="row"><Select label="Signal" value={type} options={TYPES.map((t) => ({ value: t, label: EVENT_LABEL[t] }))} onChange={setType} />
        <Select label="Watchlist" value={wl} options={Object.entries(wls).map(([k, v]) => ({ value: k, label: v.name }))} onChange={setWl} allowEmpty="— use filters —" />
        {!wl && <ScopeFilter scope={scope} onChange={setScope} />}
        <button className="btn primary" onClick={() => setRun((x) => x + 1)}>Run on {universe.length} stocks</button></div>
      {!run ? <div className="note">Choose a signal and a universe (up to 400 stocks, largest first), then run. The batch scorecard covers the whole market.</div> : loading ? <Loading what="events" /> : (
        <>
          <div className="grid g4">{HORIZON_KEYS.map((h) => <div key={h} className="card"><div className="kpi"><div className="l">{h} forward (n={stats[h].n})</div><div className="v"><Pct v={stats[h].mean} /></div>
            <div className="small muted">median {stats[h].median ?? "—"}% · hit {stats[h].hitRate ?? "—"}% · IQR {stats[h].p25 ?? "—"} to {stats[h].p75 ?? "—"}% · excess <Pct v={stats[h].excessMean} /> (hit {stats[h].excessHitRate ?? "—"}%)</div></div></div>)}</div>
          {stats.excursion && <div className="small">Over the next 63 sessions: average maximum favourable move <Pct v={stats.excursion.mfe} />, average maximum adverse move <Pct v={stats.excursion.mae} /> (n={stats.excursion.n}).</div>}
          <Histogram values={events.map((e) => e.fwd["3M"]).filter((v) => v != null)} />
          <DataTable exportName={`backtest_${type}`} rows={events.map((e, i) => ({ ...e, rid: i }))} rowKey={(r) => r.rid} initialSort={{ key: "date", dir: "desc" }}
            columns={[{ key: "sym", label: "Symbol", value: (e) => e.sec?.symbol, render: (e) => <StockLink sec={e.sec} /> }, { key: "date", label: "Signal", value: (e) => e.date }, { key: "entry", label: "Entry", value: (e) => e.entryDate },
              ...HORIZON_KEYS.map((h) => ({ key: h, label: h, num: true, value: (e) => e.fwd[h], render: (e) => <Pct v={e.fwd[h]} /> })), { key: "x3", label: "Excess 3M", num: true, value: (e) => e.excess["3M"], render: (e) => <Pct v={e.excess["3M"]} /> },
              { key: "mfe", label: "MFE", num: true, value: (e) => e.mfe, render: (e) => <Pct v={e.mfe} /> }, { key: "mae", label: "MAE", num: true, value: (e) => e.mae, render: (e) => <Pct v={e.mae} /> }]} />
        </>)}
    </div>
  );
}

function Histogram({ values }) {
  if (!values.length) return null;
  const lo = -40, hi = 60, bins = 25, w = (hi - lo) / bins;
  const c = new Array(bins).fill(0);
  for (const v of values) c[Math.max(0, Math.min(bins - 1, Math.floor((v - lo) / w)))]++;
  const mx = Math.max(...c);
  return (
    <div className="card"><h3>Distribution of 3-month forward returns</h3>
      <svg viewBox="0 0 500 120" style={{ width: "100%", height: 140 }}>
        {c.map((n, i) => { const x0 = lo + i * w; return <rect key={i} x={i * 20} y={110 - (n / mx) * 100} width={18} height={(n / mx) * 100} fill={x0 + w <= 0 ? "#dc2626" : x0 >= 0 ? "#16a34a" : "#6b7280"}><title>{`${x0.toFixed(0)}% to ${(x0 + w).toFixed(0)}%: ${n}`}</title></rect>; })}
        <text x="0" y="119" fontSize="8" fill="var(--muted)">{lo}%</text><text x="480" y="119" fontSize="8" fill="var(--muted)">{hi}%+</text>
      </svg>
    </div>);
}

function Library({ route }) {
  const d = useData();
  const id = route.query.id || [...d.rows].sort((a, b) => (b.sec.capUsdNow || 0) - (a.sec.capUsdNow || 0))[0]?.id;
  const sec = d.secById.get(id);
  const peers = useMemo(() => d.rows.filter((r) => r.sec.country === sec?.country && r.sec.sector === sec?.sector).map((r) => r.id).slice(0, 200), [d.rows, sec]);
  const { data, loading } = useAsync(() => d.api.eventsMany(peers), [peers.join()]);
  const own = data?.[id] || [];
  const latestTypes = [...new Set(own.slice(-6).map((e) => e.type))];
  return (
    <div className="stack">
      <div className="row"><InstrumentPicker value={sec ? { label: `${sec.symbol} · ${sec.name}` } : null} onChange={(r) => r.kind === "sec" && navigate("backtest", { tab: "library", id: r.id })} allowIndex={false} /><span className="small muted">Matches the stock's latest setups against every past occurrence in its own history and in its {peers.length} country-sector peers.</span></div>
      {loading ? <Loading /> : latestTypes.map((t) => {
        const mine = own.filter((e) => e.type === t), peer = Object.entries(data || {}).filter(([k]) => k !== id).flatMap(([k, ev]) => ev.filter((e) => e.type === t).map((e) => ({ ...e, id: k })));
        const sm = backtestEvents(mine), sp = backtestEvents(peer);
        return (
          <div key={t} className="card">
            <div className="row between"><b>{EVENT_LABEL[t]}</b><span className="small muted">latest {mine.at(-1)?.date}</span></div>
            <table className="tbl" style={{ marginTop: 6 }}><thead><tr><th>History</th><th className="num">n</th>{HORIZON_KEYS.map((h) => <th key={h} className="num">{h} mean / hit</th>)}<th className="num">Excess 3M</th></tr></thead><tbody>
              {[[`${sec?.symbol} itself`, sm], ["Country-sector peers", sp]].map(([l, s]) => <tr key={l}><td>{l}</td><td className="num">{s["1M"].n}</td>{HORIZON_KEYS.map((h) => <td key={h} className="num"><Pct v={s[h].mean} /> / {s[h].hitRate ?? "—"}%</td>)}<td className="num"><Pct v={s["3M"].excessMean} /></td></tr>)}
            </tbody></table>
            <div className="small muted" style={{ marginTop: 4 }}>Past occurrences in {sec?.symbol}: {mine.slice(-8).map((e) => `${e.date} (${e.fwd["3M"] != null ? `${e.fwd["3M"] > 0 ? "+" : ""}${e.fwd["3M"]}%` : "open"})`).join(" · ")}</div>
          </div>);
      })}
      {!loading && !latestTypes.length && <div className="note">No stored inflections for this stock.</div>}
    </div>
  );
}

function Log({ route }) {
  const d = useData();
  const id = route.query.id || [...d.rows].sort((a, b) => (b.sec.capUsdNow || 0) - (a.sec.capUsdNow || 0))[0]?.id;
  const sec = d.secById.get(id);
  const [type, setType] = useState(null);
  const { data, loading } = useAsync(() => d.api.events(id), [id]);
  const rows = (data || []).filter((e) => !type || e.type === type).map((e, i) => ({ ...e, rid: i }));
  return (
    <div className="stack">
      <div className="row"><InstrumentPicker value={sec ? { label: `${sec.symbol} · ${sec.name}` } : null} onChange={(r) => r.kind === "sec" && navigate("backtest", { tab: "log", id: r.id })} allowIndex={false} />
        <Select label="Type" value={type} options={TYPES.map((t) => ({ value: t, label: EVENT_LABEL[t] }))} onChange={setType} allowEmpty /></div>
      {loading ? <Loading /> : <DataTable exportName={`inflections_${sec?.symbol}`} rows={rows} rowKey={(r) => r.rid} initialSort={{ key: "date", dir: "desc" }}
        columns={[{ key: "date", label: "Date", value: (e) => e.date }, { key: "type", label: "Inflection", value: (e) => EVENT_LABEL[e.type] || e.type, render: (e) => <Badge kind={/up|bull|high|break|golden|exit/.test(e.type) ? "g" : /down|bear/.test(e.type) ? "r" : ""}>{EVENT_LABEL[e.type] || e.type}</Badge> }, { key: "tf", label: "TF", value: (e) => e.tf },
          ...HORIZON_KEYS.map((h) => ({ key: h, label: `${h} after`, num: true, value: (e) => e.fwd[h], render: (e) => <Pct v={e.fwd[h]} /> })), { key: "x", label: "Excess 3M", num: true, value: (e) => e.excess["3M"], render: (e) => <Pct v={e.excess["3M"]} /> }]} />}
    </div>
  );
}

const defaultValues = (k, v) => (typeof v !== "number" ? [v] : k === "level" ? [v - 10, v - 5, v, v + 5, v + 10] : [Math.max(1, Math.round(v * 0.5)), Math.round(v * 0.75), v, Math.round(v * 1.5), Math.round(v * 2)]);

function WalkForward() {
  const d = useData();
  const [wls] = usePersistent("watchlists", {});
  const [rule, setRule] = useState({ rule: "rsi_cross_below", params: { level: 30 }, tf: "D" });
  const [on, setOn] = useState("top");
  const [inst, setInst] = useState(null);
  const [wl, setWl] = useState(null);
  const [folds, setFolds] = useState(4);
  const [hi, setHi] = useState(1);
  const keys = Object.keys(DEFAULT_PARAMS[rule.rule] || {}).filter((k) => typeof (DEFAULT_PARAMS[rule.rule] || {})[k] === "number").slice(0, 2);
  const [vals, setVals] = useState({});
  const valuesOf = (k) => (vals[`${rule.rule}.${k}`] ?? defaultValues(k, (rule.params?.[k] ?? DEFAULT_PARAMS[rule.rule][k])).join(", ")).split(/[\s,]+/).map(Number).filter(Number.isFinite);
  const [busy, setBusy] = useState(null);
  const [res, setRes] = useState(null);
  const run = async () => {
    const ids = on === "stock" ? (inst ? [inst.id] : []) : on === "wl" ? wls[wl]?.ids || [] : [...d.rows].filter((r) => (r.sec.assetClass || "Stock") === "Stock").sort((a, b) => (b.sec.capUsdNow || 0) - (a.sec.capUsdNow || 0)).slice(0, 60).map((r) => r.id);
    const bars = new Map();
    for (let i = 0; i < ids.length; i++) { setBusy(`Loading prices ${i + 1} / ${ids.length}…`); try { const b = await d.api.bars(ids[i]); if (b) bars.set(ids[i], b); } catch { /* skip */ } }
    setBusy("Testing every parameter on every fold…");
    await new Promise((r) => setTimeout(r, 0));
    const spec = Object.fromEntries(keys.map((k) => [k, valuesOf(k)]));
    const cands = keys.length ? Object.entries(spec).reduce((acc, [k, vs]) => acc.flatMap((o) => vs.map((v) => ({ ...o, [k]: v }))), [{ ...rule.params }]) : [rule.params];
    const wf = walkForward(bars, { rule: rule.rule, tf: rule.tf, candidates: cands, folds, horizonIndex: hi, minTrades: 5 });
    const sens = keys.length ? sensitivity(bars, { rule: rule.rule, tf: rule.tf, spec, horizonIndex: hi }) : null;
    setRes({ wf, sens, n: bars.size, keys });
    setBusy(null);
  };
  const fmtP = (p) => keys.map((k) => `${k} ${p[k]}`).join(", ");
  return (
    <div className="stack">
      <div className="card stack">
        <div className="small">Out-of-sample check of a rule: in each period the parameter that worked best on <b>earlier</b> signals is chosen, then scored only on the next, unseen period. A big drop from in-sample to out-of-sample means the parameter was fitted to noise.</div>
        <RuleEditor value={rule} onChange={setRule} />
        <div className="row wrap" style={{ gap: 8 }}>
          {keys.map((k) => <label key={k} className="small muted">{k} values <input value={vals[`${rule.rule}.${k}`] ?? valuesOf(k).join(", ")} onChange={(e) => setVals({ ...vals, [`${rule.rule}.${k}`]: e.target.value })} style={{ width: 180 }} /></label>)}
          <label className="small muted">Folds <input type="number" min={2} max={8} value={folds} onChange={(e) => setFolds(Math.max(2, Math.min(8, +e.target.value || 4)))} style={{ width: 50 }} /></label>
          <Seg value={hi} onChange={setHi} options={[0, 1, 2].map((i) => ({ value: i, label: ["short", "medium", "long"][i] + " horizon" }))} />
        </div>
        <div className="row">
          <Seg value={on} options={[{ value: "top", label: "Largest 60 stocks" }, { value: "stock", label: "One stock" }, { value: "wl", label: "A watchlist" }]} onChange={setOn} />
          {on === "stock" && <InstrumentPicker allowIndex={false} value={inst} onChange={setInst} />}
          {on === "wl" && <Select value={wl} options={Object.entries(wls).map(([k, v]) => ({ value: k, label: v.name }))} onChange={setWl} allowEmpty="Pick" />}
          <button className="btn sm primary" disabled={!!busy || !RULES[rule.rule]} onClick={run}>{busy ? "Working…" : "Run"}</button>
        </div>
        {busy && <div className="small muted">{busy}</div>}
      </div>
      {res && !res.wf.ok && <div className="note warn">{res.wf.reason}</div>}
      {res?.wf.ok && <div className="card">
        <div className="row"><Badge>{describeRule(rule.rule, rule.params)}</Badge><Badge>{res.n} instruments · horizon {res.wf.horizon}</Badge><Badge kind={res.wf.efficiency > 0.5 ? "g" : res.wf.efficiency > 0 ? "a" : "r"}>efficiency {res.wf.efficiency == null ? (res.wf.noInSampleEdge ? "n/a: no in-sample edge" : "—") : res.wf.efficiency.toFixed(2)}</Badge></div>
        <DataTable compact rows={res.wf.folds.map((f) => ({ ...f, id: f.fold }))} exportName="walk-forward" columns={[
          { key: "f", label: "Fold", num: true, value: (f) => f.fold }, { key: "is", label: "Chosen on data to", value: (f) => f.inSampleTo }, { key: "oos", label: "Tested on", value: (f) => `${f.outOfSample[0]} → ${f.outOfSample[1]}` },
          { key: "p", label: "Chosen parameters", value: (f) => fmtP(f.chosen) }, { key: "ise", label: "In-sample edge", num: true, value: (f) => f.isEdge, render: (f) => <Pct v={f.isEdge} /> },
          { key: "oose", label: "Out-of-sample edge", num: true, value: (f) => f.oosEdge, render: (f) => <Pct v={f.oosEdge} /> }, { key: "n", label: "OOS signals", num: true, value: (f) => f.oosN },
          { key: "h", label: "OOS hit rate", num: true, value: (f) => f.oosHit, render: (f) => (f.oosHit == null ? "—" : `${Math.round(f.oosHit * 100)}%`) }, { key: "rk", label: "Rank of chosen OOS", value: (f) => (f.oosRankOfChosen ? `${f.oosRankOfChosen} of ${f.candidatesOos}` : "—") },
        ]} />
        <p className="legend-note">{res.wf.method} Edge = average move in the rule's expected direction after the signal.</p>
      </div>}
      {res?.sens && <div className="card">
        <div className="h3">Parameter sensitivity ({res.sens.horizon})</div>
        {res.keys.length === 2 ? (() => { const [a, b] = res.keys, A = res.sens.spec[a], B = res.sens.spec[b]; return (
          <div className="tbl-wrap"><table className="tbl chain"><thead><tr><th>{a} ↓ · {b} →</th>{B.map((x) => <th key={x}>{x}</th>)}</tr></thead>
            <tbody>{A.map((x) => <tr key={x}><td>{x}</td>{B.map((y) => { const c = res.sens.cells.find((z) => z.params[a] === x && z.params[b] === y); return <td key={y} className={`num ${c?.edge >= 0 ? "pos" : "neg"}`} title={`${c?.n || 0} signals`}>{c?.edge == null ? "—" : `${c.edge.toFixed(2)}%`}</td>; })}</tr>)}</tbody></table></div>); })()
          : <DataTable compact rows={res.sens.cells.map((c, i) => ({ ...c, id: i }))} exportName="sensitivity" columns={[{ key: "p", label: "Parameters", value: (c) => fmtP(c.params) }, { key: "n", label: "Signals", num: true, value: (c) => c.n }, { key: "e", label: "Edge", num: true, value: (c) => c.edge, render: (c) => <Pct v={c.edge} /> }, { key: "h", label: "Hit rate", num: true, value: (c) => c.hitRate, render: (c) => (c.hitRate == null ? "—" : `${Math.round(c.hitRate * 100)}%`) }]} />}
        <p className="legend-note">{res.sens.method}</p>
      </div>}
    </div>
  );
}
