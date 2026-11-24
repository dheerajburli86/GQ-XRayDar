// User-built indices: pick any stocks, choose CW / EW / your own weights, and get
// the index history and its Weight Watcher (each member's share over time).
import { useMemo, useState } from "react";
import { useData } from "../data/store.jsx";
import { useAsync } from "../lib/useAsync.js";
import { usePersistent, uid } from "../lib/storage.js";
import { PageHead, Seg, Select, Badge, Kpi, Empty, Loading, ErrorBox, Pct, TREND_BADGE, StockLink } from "../components/ui.jsx";
import { InstrumentPicker, ScopeFilter, applyScope } from "../components/pickers.jsx";
import { TvChart, PALETTE, lineData } from "../components/TvChart.jsx";
import { DataTable } from "../components/DataTable.jsx";
import { exportXlsx } from "../lib/exporters.js";
import { loadInstrument, closesInUsd } from "../lib/series.js";
import { majorCurrency } from "../../engine/fx.js";
import { buildCustomIndex, seriesReturns } from "../../engine/customIndex.js";
import { WW_TREND_LABEL } from "../../engine/weightWatcher.js";
import { quarterLabel } from "../../engine/calendar.js";
import { ShareButton } from "../components/Share.jsx";

const METHODS = [{ value: "CW", label: "Market-cap weighted" }, { value: "EW", label: "Equal weighted" }, { value: "CUSTOM", label: "My own weights" }];
const blank = () => ({ id: uid(), name: "My index", method: "CW", ccy: "USD", members: [] });

export default function MyIndices() {
  const d = useData();
  const [list, setList] = usePersistent("customIndices", []);
  const [selId, setSelId] = useState(list[0]?.id || null);
  const cur = list.find((x) => x.id === selId) || null;
  const update = (patch) => setList(list.map((x) => (x.id === cur.id ? { ...x, ...patch } : x)));
  const create = () => { const n = blank(); n.name = `My index ${list.length + 1}`; setList([...list, n]); setSelId(n.id); };
  const remove = () => { if (!cur || !confirm(`Delete "${cur.name}"?`)) return; const rest = list.filter((x) => x.id !== cur.id); setList(rest); setSelId(rest[0]?.id || null); };

  return (
    <div>
      <PageHead title="My indices" sub="Build an index from any stocks you choose. Its history and Weight Watcher are calculated by the same engine as the house indices.">
        <button className="btn primary" onClick={create}>+ New index</button>
      </PageHead>
      {!list.length ? <Empty>No indices yet. Press “New index”, then add stocks one by one or from a filter.</Empty> : (
        <div className="row" style={{ alignItems: "flex-start", gap: 14 }}>
          <div className="card" style={{ width: 220, flex: "none" }}>
            {list.map((x) => <div key={x.id} className={`navitem ${x.id === selId ? "active" : ""}`} style={{ cursor: "pointer" }} onClick={() => setSelId(x.id)}><span className="lbl">{x.name}</span><span className="muted small">{x.members.length}</span></div>)}
          </div>
          {cur && <Editor key={cur.id} d={d} idx={cur} update={update} remove={remove} />}
        </div>
      )}
    </div>
  );
}

function Editor({ d, idx, update, remove }) {
  const [scope, setScope] = useState({});
  const [topN, setTopN] = useState(20);
  const members = idx.members.map((m) => ({ ...m, sec: d.secById.get(m.id) })).filter((m) => m.sec);
  const ccys = new Set(members.map((m) => majorCurrency(m.sec.currency).major));
  const ccy = idx.ccy === "LCL" && ccys.size <= 1 ? "LCL" : "USD";
  const add = (ids) => {
    const have = new Set(idx.members.map((m) => m.id));
    update({ members: [...idx.members, ...ids.filter((id) => !have.has(id)).map((id) => ({ id, weight: 1 }))] });
  };
  const addFromScope = () => {
    const rows = applyScope(d.rows, scope).filter((r) => (r.sec.assetClass || "Stock") === "Stock");
    rows.sort((a, b) => (b.sec.capUsdNow ?? b.sec.capUsd ?? 0) - (a.sec.capUsdNow ?? a.sec.capUsd ?? 0));
    add(rows.slice(0, topN).map((r) => r.id));
  };

  const key = `${idx.method}|${ccy}|${members.map((m) => `${m.id}:${m.weight}`).join(",")}`;
  const { data: res, loading, error } = useAsync(async () => {
    if (!members.length) return null;
    const loaded = await Promise.all(members.map(async (m) => {
      const inst = await loadInstrument(d.api, { kind: "sec", id: m.id }, d);
      if (!inst) return { id: m.id, label: m.sec.symbol, time: [], close: [] };
      const close = ccy === "USD" ? await closesInUsd(d.api, inst) : inst.close;
      const cap = ccy === "USD" ? (m.sec.capUsdNow ?? m.sec.capUsd) : m.sec.capLocal;
      const lastClose = ccy === "USD" ? close[close.length - 1] : close[close.length - 1] / majorCurrency(inst.currency).divisor;
      return { id: m.id, label: m.sec.symbol, time: inst.time, close, shares: cap > 0 && lastClose > 0 ? cap / lastClose : 0, weight: m.weight };
    }));
    return buildCustomIndex(loaded, { method: idx.method });
  }, [key]);

  const rets = res?.dates?.length ? seriesReturns(res.dates, res.level) : null;
  const ww = res?.weightsAt;
  const wwSeries = useMemo(() => (ww ? ww.children.slice(0, 15).map((c, i) => ({ id: c.key, type: "line", data: ww.dates.map((t, j) => ({ time: t, value: c.weights[j] })).filter((p) => p.value != null), options: { color: PALETTE[i % PALETTE.length], lineWidth: 2, title: c.label, pointMarkersVisible: true } })) : []), [ww]);
  const exportAll = () => exportXlsx(idx.name, [
    { name: "Index", columns: [{ label: "Date", value: (r) => r[0] }, { label: "Level", value: (r) => r[1] }, { label: "Members", value: (r) => r[2] }], rows: res.dates.map((t, i) => [t, res.level[i], res.n[i]]) },
    { name: "Weight Watcher", columns: [{ label: "Member", value: (r) => r.label }, ...ww.dates.map((t, j) => ({ label: t, value: (r) => r.weights[j] }))], rows: ww.children },
  ]);

  return (
    <div className="grow stack" style={{ minWidth: 0 }}>
      <div className="card">
        <div className="row wrap" style={{ gap: 10 }}>
          <input className="input" value={idx.name} onChange={(e) => update({ name: e.target.value })} style={{ width: 220 }} />
          <Select value={idx.method} options={METHODS} onChange={(method) => update({ method })} />
          <Seg value={ccy} options={[{ value: "USD", label: "USD" }, { value: "LCL", label: "Local", title: "Only when every member trades in one currency" }]} onChange={(c) => update({ ccy: c })} />
          <div className="grow" />
          {res?.dates?.length ? <button className="btn sm" onClick={exportAll}>Excel</button> : null}
          <ShareButton sourceKey="customIndices" item={idx.id} title={idx.name} />
          <button className="btn sm ghost" onClick={remove}>Delete</button>
        </div>
        <div className="row wrap" style={{ gap: 10, marginTop: 10 }}>
          <InstrumentPicker value={null} secOnly placeholder="Add a stock…" onChange={(r) => r?.id && add([r.id])} />
          <span className="muted small">or add the largest</span>
          <input className="input" type="number" min={1} max={500} value={topN} onChange={(e) => setTopN(Math.max(1, Math.min(500, +e.target.value || 1)))} style={{ width: 64 }} />
          <span className="muted small">stocks from</span>
          <ScopeFilter scope={scope} onChange={setScope} show={["region", "country", "sector", "cap"]} />
          <button className="btn sm" onClick={addFromScope}>Add</button>
        </div>
        {idx.method === "CW" && <p className="small muted">Market caps use today’s share count for the whole history (estimated), the same rule as the house CW indices.</p>}
        {idx.ccy === "LCL" && ccy === "USD" && <p className="small muted">Members trade in more than one currency, so the index is shown in USD.</p>}
      </div>

      {members.length > 0 && (
        <div className="card">
          <div className="h3">Members ({members.length})</div>
          <DataTable compact pageSize={25} exportName={`${idx.name} members`} rows={members} columns={[
            { key: "s", label: "Stock", value: (m) => m.sec.symbol, render: (m) => <StockLink sec={m.sec} /> },
            { key: "n", label: "Name", value: (m) => m.sec.name },
            { key: "c", label: "Country", value: (m) => m.sec.country },
            { key: "sec", label: "Sector", value: (m) => m.sec.sector },
            ...(idx.method === "CUSTOM" ? [{ key: "w", label: "Weight", value: (m) => m.weight, render: (m) => <input className="input" type="number" min={0} step="any" value={m.weight} style={{ width: 70 }} onChange={(e) => update({ members: idx.members.map((x) => (x.id === m.id ? { ...x, weight: +e.target.value } : x)) })} /> }] : []),
            { key: "x", label: "", export: false, value: () => "", render: (m) => <a style={{ cursor: "pointer" }} onClick={() => update({ members: idx.members.filter((x) => x.id !== m.id) })}>remove</a> },
          ]} />
        </div>
      )}

      {loading && <Loading what="member prices" />}
      {error && <ErrorBox error={error} />}
      {res?.dates?.length > 0 && (
        <>
          {res.warnings.map((w, i) => <div key={i} className="note warn small">{w}</div>)}
          <div className="kpis">
            <Kpi label="Level" value={res.level.at(-1).toFixed(2)} sub={`${res.dates.at(-1)} · base 1000`} />
            {Object.entries(rets).map(([k, v]) => <Kpi key={k} label={k} value={<Pct v={v == null ? null : v * 100} />} />)}
          </div>
          <div className="card">
            <div className="h3">{idx.name} ({ccy === "USD" ? "USD" : [...ccys][0]})</div>
            <TvChart height={320} series={[{ id: "lvl", type: "line", data: lineData(res.dates, res.level), options: { color: "#14a44d", lineWidth: 2 } }]} />
          </div>
          <div className="card">
            <div className="h3">Weight Watcher: each member’s share of the index, quarter by quarter</div>
            <p className="small muted">Weight = the member’s value ÷ the index value at each quarter-end; the right-most point is today (quarter still running).{idx.method !== "CW" ? " For EW and own-weight indices this shows how far each member drifted before the next reset." : ""}</p>
            <TvChart height={300} series={wwSeries} />
            <DataTable compact pageSize={25} exportName={`${idx.name} weight watcher`} rows={ww.children.map((c) => ({ ...c, id: c.key }))} columns={[
              { key: "m", label: "Member", value: (c) => c.label },
              { key: "w", label: "Weight now %", value: (c) => c.weights.at(-1), render: (c) => (c.weights.at(-1) ?? 0).toFixed(2) },
              { key: "c4", label: "Change over 4 obs.", value: (c) => c.trend.change4, render: (c) => <Pct v={c.trend.change4 == null ? null : c.trend.change4 * 100} /> },
              { key: "t", label: "Trend", value: (c) => c.trend.trend, render: (c) => <Badge kind={TREND_BADGE[c.trend.trend]}>{WW_TREND_LABEL[c.trend.trend]}</Badge> },
              { key: "q", label: "First quarter", value: (c) => ww.dates[c.weights.findIndex((x) => x != null)], render: (c) => { const j = c.weights.findIndex((x) => x != null); return j >= 0 ? quarterLabel(ww.dates[j]) : "—"; } },
            ]} />
          </div>
        </>
      )}
    </div>
  );
}
