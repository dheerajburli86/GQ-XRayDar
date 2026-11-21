// Early-stage opportunity scanner: every stock placed on the path
// downtrend -> slowing decline -> consolidation -> MMA compression -> RSC turn
// -> breakout -> volume confirmation -> established uptrend, with the evidence.
import { useMemo, useState } from "react";
import { useData } from "../data/store.jsx";
import { useAsync } from "../lib/useAsync.js";
import { PageHead, Badge, STAGE_BADGE, Loading } from "../components/ui.jsx";
import { DataTable } from "../components/DataTable.jsx";
import { ScopeFilter, applyScope, idColumns, fieldColumn } from "../components/pickers.jsx";
import { STAGES } from "../../engine/signals.js";

export default function EarlyStage() {
  const d = useData();
  const [scope, setScope] = useState({});
  const [stage, setStage] = useState(null);
  const [sel, setSel] = useState(null);
  const inScope = useMemo(() => applyScope(d.rows, scope), [d.rows, scope]);
  const counts = useMemo(() => { const c = {}; for (const r of inScope) { const k = r.flat.stageId; c[k ?? "none"] = (c[k ?? "none"] || 0) + 1; } return c; }, [inScope]);
  const rows = useMemo(() => (stage == null ? inScope.filter((r) => r.flat.stageId != null) : inScope.filter((r) => r.flat.stageId === stage)), [inScope, stage]);
  const { data: snap, loading } = useAsync(() => (sel ? d.api.snapshot(sel) : null), [sel]);
  const total = inScope.length || 1;
  return (
    <div className="stack">
      <PageHead title="Early-stage opportunity scanner" sub="Weekly classification. Each stock sits at the most advanced stage whose conditions it meets; the evidence behind every classification is one click away." />
      <ScopeFilter scope={scope} onChange={setScope} />
      <div className="grid" style={{ gridTemplateColumns: `repeat(${STAGES.length}, minmax(0,1fr))`, gap: 6 }}>
        {STAGES.map((s) => (
          <div key={s.id} className="card tight" style={{ cursor: "pointer", outline: stage === s.id ? "2px solid var(--gq)" : "none" }} onClick={() => setStage(stage === s.id ? null : s.id)}>
            <div className="small muted">{s.id}. {s.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{counts[s.id] || 0}</div>
            <div className="scorebar"><div style={{ width: `${((counts[s.id] || 0) / total) * 100}%` }} /></div>
          </div>))}
      </div>
      <div className="grid" style={{ gridTemplateColumns: "minmax(0,1fr) 340px" }}>
        <DataTable exportName="early_stage" rows={rows} initialSort={{ key: "stageId", dir: "desc" }} onRowClick={(r) => setSel(r.id)} selectedId={sel}
          columns={[...idColumns(["country", "sector", "cap"]), { key: "stageId", label: "Stage", num: true, value: (r) => r.flat.stageId, render: (r) => <Badge kind={STAGE_BADGE[r.flat.stageId]}>{r.flat.stage}</Badge> },
            fieldColumn("shortSpreadW"), fieldColumn("rscRising_country_W", { label: "RSC rising (W)" }), fieldColumn("volRatio"), fieldColumn("ret3M"), fieldColumn("glocom", { label: "GLOCOM" }), fieldColumn("score")]} />
        <div className="card">
          <h3>Evidence</h3>
          {!sel ? <div className="small muted">Select a stock.</div> : loading ? <Loading /> : snap ? (
            <div className="stack" style={{ gap: 6 }}>
              <b>{d.secById.get(sel)?.symbol} — {snap.snap.stage.label}</b>
              {snap.snap.stage.evidence.map((e, i) => <div key={i} className="small">✓ {e}</div>)}
              <h3 style={{ marginTop: 8 }}>All stage conditions</h3>
              {Object.entries(snap.snap.stage.flags || {}).map(([k, v]) => <div key={k} className="row between small"><span>{k}</span><span className={v ? "ev-ok" : "ev-na"}>{v ? "yes" : "no"}</span></div>)}
              <a className="small" href={`#/screens/RSIMMA/${sel}`}>Open RSIMMA →</a>
            </div>) : null}
        </div>
      </div>
    </div>
  );
}
