// AI setup scoring with full explanation: component scores, the weights in
// force, the thresholds and evidence behind each component, and conflicts.
import { useMemo, useState } from "react";
import { useData } from "../data/store.jsx";
import { useAsync } from "../lib/useAsync.js";
import { PageHead, ScoreBar, Loading, Badge } from "../components/ui.jsx";
import { DataTable } from "../components/DataTable.jsx";
import { ScopeFilter, applyScope, idColumns, fieldColumn } from "../components/pickers.jsx";
import { SCORE_COMPONENTS } from "../../engine/scoring.js";
import { METHODOLOGY } from "../../engine/methodology.js";

export default function Scores({ route }) {
  const d = useData();
  const [scope, setScope] = useState({});
  const [sel, setSel] = useState(route.query.id || null);
  const w = d.settings.scoreWeights;
  const rows = useMemo(() => applyScope(d.rows, scope).filter((r) => r.flat.score != null), [d.rows, scope]);
  const { data: snap, loading } = useAsync(() => (sel ? d.api.snapshot(sel) : null), [sel]);
  const setW = (k, v) => d.setSetting("scoreWeights", { ...w, [k]: v });
  return (
    <div className="stack">
      <PageHead title="AI setup scores" sub="A transparent composite of technical strength, relative strength, participation, fundamentals, catalysts and timeframe confirmation. Components without data are excluded and their weight re-spread — never scored as zero.">
        <button className="btn sm" onClick={() => d.setSetting("scoreWeights", METHODOLOGY.scoring.weights)}>Reset weights</button>
      </PageHead>
      <div className="card row">
        <b className="small">Weights</b>
        {SCORE_COMPONENTS.map((k) => (
          <label key={k} className="lbl-ctl">{k} <input type="range" min="0" max="0.5" step="0.05" value={w[k] ?? 0} onChange={(e) => setW(k, +e.target.value)} /> <span className="mono">{(w[k] ?? 0).toFixed(2)}</span></label>))}
      </div>
      <ScopeFilter scope={scope} onChange={setScope} />
      <div className="grid" style={{ gridTemplateColumns: "minmax(0,1fr) 380px" }}>
        <DataTable exportName="scores" rows={rows} initialSort={{ key: "score", dir: "desc" }} onRowClick={(r) => setSel(r.id)} selectedId={sel}
          columns={[...idColumns(["country", "sector"]), { key: "score", label: "Score", num: true, value: (r) => r.flat.score, render: (r) => <ScoreBar v={r.flat.score} /> },
            ...["technical", "relative", "participation", "fundamentals", "timeframe"].map((k) => fieldColumn(`score_${k}`, { label: k.slice(0, 5) }))]} />
        <div className="card">
          {!sel ? <div className="small muted">Select a stock to see why it scores what it does.</div> : loading ? <Loading /> : snap?.score ? <Explain snap={snap} sec={d.secById.get(sel)} weights={w} /> : <div className="small muted">No score.</div>}
        </div>
      </div>
    </div>
  );
}

export function Explain({ snap, sec, weights }) {
  const sc = snap.score;
  const comps = sc.components;
  const avail = SCORE_COMPONENTS.filter((k) => comps[k]?.score != null);
  const ws = avail.reduce((a, k) => a + (weights[k] || 0), 0);
  const total = ws ? Math.round(avail.reduce((a, k) => a + (weights[k] || 0) * comps[k].score, 0) / ws) : null;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row between"><b>{sec?.symbol} · {sec?.name}</b><ScoreBar v={total} /></div>
      <div className="small muted">As of {sc.asOf}. Composite = Σ weight × component over available components ÷ Σ weights used.</div>
      {SCORE_COMPONENTS.map((k) => {
        const c = comps[k];
        return (
          <div key={k} style={{ borderTop: "1px solid var(--line)", paddingTop: 6 }}>
            <div className="row between"><b className="small" style={{ textTransform: "capitalize" }}>{k}</b>
              <span className="small">{c.score != null ? <>score <b>{c.score}</b> · weight {ws ? ((weights[k] || 0) / ws).toFixed(2) : "—"}</> : <Badge>no data — excluded</Badge>}</span></div>
            {c.evidence?.map((e, i) => <div key={i} className={`small ${e.ok === true ? "ev-ok" : e.ok === false ? "ev-no" : "ev-na"}`}>{e.ok === true ? "✓" : e.ok === false ? "✗" : "•"} {e.text}</div>)}
            {c.thresholds && <div className="small muted">Rules: {c.thresholds}</div>}
          </div>);
      })}
      {sc.conflicts?.length > 0 && <div className="note warn"><b>Conflicting signals</b>{sc.conflicts.map((x, i) => <div key={i} className="small">• {x}</div>)}</div>}
    </div>
  );
}
