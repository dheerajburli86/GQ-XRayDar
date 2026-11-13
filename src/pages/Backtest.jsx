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

const TYPES = Object.keys(EVENT_LABEL);

export default function Backtest({ route }) {
  const [tab, setTab] = useState(route.query.tab || "summary");
  return (
    <div className="stack">
      <PageHead title="Backtest, pattern library & inflection database" sub="Bias controls: signals use data up to the signal bar only; entry is the next session's close; delisted stocks stay in the universe; split adjustments are applied before any calculation." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "summary", label: "Signal scorecard" }, { value: "custom", label: "Custom backtest" }, { value: "library", label: "Pattern library" }, { value: "log", label: "Inflection database" }]} />
      {tab === "summary" && <Summary />}
      {tab === "custom" && <Custom />}
      {tab === "library" && <Library route={route} />}
      {tab === "log" && <Log route={route} />}
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
