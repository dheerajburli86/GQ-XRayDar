// IMB / ETI characteristics from the ETI project: which companies have which
// characteristic (yes / no / unknown), the notes behind each answer, recent
// changes, and alerts on a change. No score, no rank, no view.
import { useMemo, useState } from "react";
import { useData } from "../data/store.jsx";
import { useAsync } from "../lib/useAsync.js";
import { usePersistent, uid } from "../lib/storage.js";
import { PageHead, Loading, Empty, Check, ErrorBox } from "../components/ui.jsx";
import { DataTable } from "../components/DataTable.jsx";
import { GBadge, Jump } from "../components/glocomUi.jsx";
import { ETI_CHARACTERISTICS, ETI_BY_KEY, groupEti, matchEti, etiAnswer } from "../../engine/eti.js";

const ANS = { yes: { t: "✓", c: "var(--up, #16a34a)" }, no: { t: "✗", c: "var(--down, #dc2626)" }, unknown: { t: "?", c: "var(--muted, #9ca3af)" } };
const Answer = ({ v, long }) => { const a = ANS[v] || ANS.unknown; return <b style={{ color: a.c }} title={v}>{long ? `${a.t} ${v}` : a.t}</b>; };

export default function ImbEti() {
  const d = useData();
  const { data: raw, loading, error } = useAsync(() => d.api.etiRows(), []);
  const { data: changes } = useAsync(() => d.api.etiChanges(200), []);
  const [filter, setFilter] = usePersistent("imbeti.filter", {});
  const [indUp, setIndUp] = useState(false);
  const [sel, setSel] = useState(null);
  const companies = useMemo(() => [...groupEti(raw).values()].map((c) => {
    const r = c.instrumentId ? d.rowById.get(c.instrumentId) : null;
    return { ...c, id: c.companyId, row: r, symbol: r?.sec.symbol || c.nse || c.bse || "—", sector: r?.sec.sector || null, industry: r?.sec.industryGroup || null };
  }), [raw, d.rowById]);
  const rows = useMemo(() => companies.filter((c) => matchEti(c, filter) && (!indUp || (c.row?.flat.industryRankJump1W ?? 0) > 0)), [companies, filter, indUp]);
  const synced = useMemo(() => (raw || []).reduce((m, r) => (r.synced_at > m ? r.synced_at : m), ""), [raw]);
  const selected = companies.find((c) => c.id === sel);
  const nameOf = useMemo(() => new Map(companies.map((c) => [c.companyId, c])), [companies]);

  if (loading) return <Loading what="IMB / ETI characteristics" />;
  if (error) return <ErrorBox error={error} />;
  return (
    <div className="stack">
      <PageHead title="IMB / ETI characteristics" sub="Computed by the ETI project from Screener statements, filings and Kite prices. Each characteristic is yes, no or unknown (not enough data to check the rule). Nothing here is a score, a ranking or a view." />
      {!companies.length ? <Empty>No characteristics copied yet. They arrive from the ETI project by the hourly sync{d.info.mode === "demo" ? " (not available in demo mode)" : ""}.</Empty> : (
        <>
          <div className="card">
            <div className="row between"><h3>Filter</h3><span className="small muted">{companies.length} companies with characteristics · copied {synced ? synced.slice(0, 16).replace("T", " ") : "—"} UTC</span></div>
            {["imb", "eti"].map((fw) => (
              <div key={fw} className="row" style={{ flexWrap: "wrap", gap: 10, marginTop: 6 }}>
                <b className="small" style={{ width: 34 }}>{fw.toUpperCase()}</b>
                {ETI_CHARACTERISTICS.filter((c) => c.framework === fw).map((c) => (
                  <label key={c.key} className="small" title={c.rule} style={{ display: "flex", gap: 4, alignItems: "center" }}>{c.short}
                    <select value={filter[c.key] || ""} onChange={(e) => setFilter({ ...filter, [c.key]: e.target.value })}>
                      <option value="">any</option><option value="yes">yes</option><option value="no">no</option><option value="unknown">unknown</option>
                    </select>
                  </label>))}
              </div>))}
            <div className="row" style={{ gap: 12, marginTop: 8 }}>
              <Check checked={indUp} onChange={setIndUp}>Industry moving up the GLOCOM rank (1 week)</Check>
              <button className="btn sm ghost" onClick={() => setFilter({})}>Clear</button>
              <span className="small muted">{rows.length} match</span>
            </div>
          </div>

          <div className="grid" style={{ gridTemplateColumns: "minmax(0,1fr) 380px" }}>
            <DataTable exportName="imb_eti_characteristics" rows={rows} initialSort={{ key: "sym", dir: "asc" }} onRowClick={(c) => setSel(c.id)} selectedId={sel}
              columns={[
                { key: "sym", label: "Company", value: (c) => c.symbol, render: (c) => <span title={c.name}><b>{c.symbol}</b> <span className="small muted">{c.name}</span></span> },
                { key: "ind", label: "Industry", value: (c) => c.industry, render: (c) => <span className="small">{c.industry || "—"}</span> },
                { key: "ig", label: "Ind. GLOCOM", value: (c) => c.row?.flat.industryGlocomCode, render: (c) => (c.row ? <span><GBadge small code={c.row.flat.industryGlocomCode} label={c.row.flat.industryGlocom} /> <Jump v={c.row.flat.industryRankJump1W} /></span> : <span className="muted small">not matched</span>) },
                ...ETI_CHARACTERISTICS.map((x) => ({ key: x.key, label: x.short, value: (c) => c.flags[x.key], render: (c) => <span title={c.detail[x.key]?.note || x.rule}><Answer v={c.flags[x.key]} /></span> })),
              ]} />
            <div className="stack">
              {selected ? <Detail c={selected} onClose={() => setSel(null)} /> : <Rules />}
              <AlertBox />
              <div className="card"><h3>Recent changes</h3>
                {!changes?.length ? <div className="small muted">No change yet. The first copy is recorded silently; later changes appear here.</div> : (
                  <div style={{ maxHeight: 300, overflow: "auto" }}>
                    {changes.map((x) => { const c = nameOf.get(x.company_id); return (
                      <div key={x.id} className="row between small" style={{ padding: "2px 0", borderBottom: "1px solid var(--line)", cursor: "pointer" }} onClick={() => setSel(x.company_id)}>
                        <span><b>{c?.symbol || `#${x.company_id}`}</b> {ETI_BY_KEY[x.characteristic]?.short}</span>
                        <span><Answer v={etiAnswer(x.from_meets)} /> → <Answer v={etiAnswer(x.to_meets)} /> <span className="muted">{String(x.at).slice(0, 10)}</span></span>
                      </div>); })}
                  </div>)}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Detail({ c, onClose }) {
  return (
    <div className="card">
      <div className="row between"><h3>{c.symbol} · {c.name}</h3><button className="btn sm ghost" onClick={onClose}>Close</button></div>
      {c.row && <div className="small" style={{ marginBottom: 6 }}><a href={`#/stock/${c.row.id}`}>Open stock page →</a></div>}
      {ETI_CHARACTERISTICS.map((x) => { const det = c.detail[x.key]; return (
        <div key={x.key} style={{ padding: "4px 0", borderBottom: "1px solid var(--line)" }}>
          <div className="row between small"><b>{x.framework.toUpperCase()} · {x.label}</b><Answer v={c.flags[x.key]} long /></div>
          <div className="small muted">{det?.note || "not computed yet"}{det?.asOf ? ` (as of ${det.asOf})` : ""}</div>
        </div>); })}
    </div>
  );
}

function Rules() {
  return (
    <div className="card"><h3>The characteristics</h3>
      {ETI_CHARACTERISTICS.map((x) => <div key={x.key} className="small" style={{ padding: "2px 0" }}><b>{x.framework.toUpperCase()} {x.label}:</b> {x.rule}</div>)}
      <div className="small muted" style={{ marginTop: 6 }}>Click a company for the numbers and notes behind each answer.</div>
    </div>
  );
}

function AlertBox() {
  const [rules, setRules] = usePersistent("alerts.rules", []);
  const [wls] = usePersistent("watchlists", {});
  const [draft, setDraft] = useState({ characteristic: "imb_sustained_breakout", to: "yes", wl: "" });
  const mine = (rules || []).filter((r) => r.kind === "eti");
  const add = () => setRules([...(rules || []), { id: uid(), kind: "eti", characteristic: draft.characteristic, to: draft.to, target: draft.wl ? { watchlistId: draft.wl } : null, enabled: true, createdAt: new Date().toISOString(), name: `${ETI_BY_KEY[draft.characteristic].label} → ${draft.to}` }]);
  return (
    <div className="card"><h3>Alerts</h3>
      <div className="small muted" style={{ marginBottom: 6 }}>Sent once, when a company's answer changes (Telegram / phone, as set on the Alerts page).</div>
      <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
        <select value={draft.characteristic} onChange={(e) => setDraft({ ...draft, characteristic: e.target.value })}>{ETI_CHARACTERISTICS.map((x) => <option key={x.key} value={x.key}>{x.framework.toUpperCase()} {x.label}</option>)}</select>
        <span className="small">becomes</span>
        <select value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })}><option value="yes">yes</option><option value="no">no</option></select>
        <select value={draft.wl} onChange={(e) => setDraft({ ...draft, wl: e.target.value })}><option value="">any company</option>{Object.entries(wls || {}).map(([id, w]) => <option key={id} value={id}>watchlist: {w.name || id}</option>)}</select>
        <button className="btn sm primary" onClick={add}>Add alert</button>
      </div>
      {mine.map((r) => (
        <div key={r.id} className="row between small" style={{ marginTop: 4 }}>
          <span>{ETI_BY_KEY[r.characteristic]?.label} → {r.to}{r.target?.watchlistId ? ` (${wls?.[r.target.watchlistId]?.name || "watchlist"})` : ""}</span>
          <button className="btn sm ghost" onClick={() => setRules(rules.filter((x) => x.id !== r.id))}>✕</button>
        </div>))}
    </div>
  );
}
