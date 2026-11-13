// Watchlists and portfolio overlay: exposures by country, sector, cap segment
// and currency with technical, relative-strength and fundamental overlays.
import { useMemo, useState } from "react";
import { useData } from "../data/store.jsx";
import { PageHead, Select, Badge, Pct } from "../components/ui.jsx";
import { DataTable } from "../components/DataTable.jsx";
import { InstrumentPicker, idColumns, fieldColumn } from "../components/pickers.jsx";
import { usePersistent, uid } from "../lib/storage.js";

export default function Watchlists() {
  const d = useData();
  const [wls, setWls] = usePersistent("watchlists", {});
  const [cur, setCur] = useState(Object.keys(wls)[0] || null);
  const [name, setName] = useState("");
  const wl = cur ? wls[cur] : null;
  const save = (patch) => setWls({ ...wls, [cur]: { ...wl, ...patch } });
  const rows = useMemo(() => (wl ? wl.ids.map((id) => d.rowById.get(id)).filter(Boolean) : []), [wl, d.rowById]);
  const weights = wl?.weights || {};
  const totalW = rows.reduce((a, r) => a + (+weights[r.id] || 0), 0);
  const w = (r) => (totalW > 0 ? (+weights[r.id] || 0) / totalW : rows.length ? 1 / rows.length : 0);
  const expo = (key) => {
    const m = new Map();
    for (const r of rows) { const k = key(r) || "—"; m.set(k, (m.get(k) || 0) + w(r)); }
    return [...m].sort((a, b) => b[1] - a[1]);
  };
  const wavg = (f) => { let a = 0, s = 0; for (const r of rows) { const v = r.flat[f]; if (v != null) { a += v * w(r); s += w(r); } } return s ? a / s : null; };
  const share = (f) => { let a = 0; for (const r of rows) if (r.flat[f] === true) a += w(r); return a * 100; };
  const addFromScreen = () => {
    const raw = prompt("Paste symbols separated by commas");
    if (!raw) return;
    const syms = raw.split(/[\s,]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
    const ids = d.secs.filter((s) => syms.includes(s.symbol)).map((s) => s.id);
    save({ ids: [...new Set([...wl.ids, ...ids])] });
  };
  return (
    <div className="stack">
      <PageHead title="Watchlists & portfolio overlay" sub="Weights are optional: leave them blank for an equal-weight view, or enter position sizes to see portfolio exposures.">
        <Select label="List" value={cur} options={Object.entries(wls).map(([k, v]) => ({ value: k, label: `${v.name} (${v.ids.length})` }))} onChange={setCur} />
        <input placeholder="New list name" value={name} onChange={(e) => setName(e.target.value)} style={{ width: 150 }} />
        <button className="btn sm primary" disabled={!name} onClick={() => { const id = uid(); setWls({ ...wls, [id]: { name, ids: [], weights: {} } }); setCur(id); setName(""); }}>Create</button>
        {wl && <button className="btn sm" onClick={() => { if (confirm(`Delete "${wl.name}"?`)) { const n = { ...wls }; delete n[cur]; setWls(n); setCur(Object.keys(n)[0] || null); } }}>Delete list</button>}
      </PageHead>
      {!wl ? <div className="note">Create a list to start. Lists feed the alerts, the custom backtest and the workspace.</div> : (
        <>
          <div className="row"><InstrumentPicker allowIndex={false} placeholder="Add a stock…" onChange={(r) => r.kind === "sec" && save({ ids: [...new Set([...wl.ids, r.id])] })} /><button className="btn sm" onClick={addFromScreen}>Paste symbols</button></div>
          <div className="grid g4">
            {[["Country", (r) => r.sec.country], ["Sector", (r) => r.sec.sector], ["Cap segment", (r) => r.sec.capSegment], ["Currency", (r) => r.sec.currencyMajor]].map(([t, f]) => (
              <div key={t} className="card"><h3>{t} exposure</h3>{expo(f).map(([k, v]) => <div key={k} className="row between small"><span>{k}</span><span className="mono">{(v * 100).toFixed(1)}%</span></div>)}</div>))}
          </div>
          <div className="card row" style={{ gap: 18 }}>
            <span className="small">Weighted 3M return <Pct v={wavg("ret3M")} /></span>
            <span className="small">Weighted 3M RSC vs country <Pct v={wavg("rscChg_country_3M")} /></span>
            <span className="small">Avg weekly RSI <b>{wavg("rsiW")?.toFixed(1) ?? "—"}</b></span>
            <span className="small">Bullish weekly MMA <b>{share("mmaBullW").toFixed(0)}%</b></span>
            <span className="small">Above 200-day <b>{share("above200").toFixed(0)}%</b></span>
            <span className="small">Fundamentals improving <b>{share("fundImproving").toFixed(0)}%</b></span>
            <span className="small">Avg AI score <b>{wavg("score")?.toFixed(0) ?? "—"}</b></span>
          </div>
          <DataTable exportName={`watchlist_${wl.name}`} rows={rows}
            columns={[...idColumns(["country", "sector", "cap"]),
              { key: "w", label: "Weight", num: true, value: (r) => +weights[r.id] || null, render: (r) => <input style={{ width: 70 }} type="number" value={weights[r.id] ?? ""} onChange={(e) => save({ weights: { ...weights, [r.id]: e.target.value } })} /> },
              { key: "ew", label: "Effective %", num: true, value: (r) => w(r) * 100, render: (r) => (w(r) * 100).toFixed(1) },
              fieldColumn("ret1M"), fieldColumn("ret3M"), fieldColumn("rscChg_country_3M"), fieldColumn("mmaW"), fieldColumn("rsiW"), fieldColumn("stage"), fieldColumn("wwTrend"), fieldColumn("revenueGrowthYoY"), fieldColumn("score"),
              { key: "x", label: "", value: () => null, export: false, render: (r) => <button className="btn sm ghost" onClick={() => save({ ids: wl.ids.filter((i) => i !== r.id) })}>✕</button> }]} />
          {rows.length === 0 && <Badge>Empty list</Badge>}
        </>)}
    </div>
  );
}
