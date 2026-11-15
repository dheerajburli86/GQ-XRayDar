// Derivatives & confluence screener: preset scans, custom conditions, a
// plain-English query box, saved scans with "new since last look" alerts, and
// the technical + derivatives confluence view.
import { useMemo, useState } from "react";
import { PageHead, Seg, Badge, Tabs } from "../../components/ui.jsx";
import { DataTable } from "../../components/DataTable.jsx";
import { href } from "../../lib/router.js";
import { usePersistent, uid } from "../../lib/storage.js";
import { useDerivRows, DerivGate, DataNote, fp, fn, pc, BUILD_BADGE } from "./common.jsx";
import { DERIV_FIELDS, DERIV_FIELD, DERIV_GROUPS, DERIV_PRESETS, matches, parseDerivQuery } from "../../../engine/deriv/screen.js";
import { BUILDUP } from "../../../engine/deriv/positioning.js";

const UNSIGNED = new Set(["oiPercentile", "mwplPct", "atmIv", "ivRank", "ivPct", "rolloverPct", "expMovePct", "buildupConf"]);
const show = (f, v) => (v == null ? "—" : f.type === "pct" ? (UNSIGNED.has(f.key) ? pc(v, 1) : fp(v)) : f.type === "bool" ? (v ? "Yes" : "No") : f.type === "cat" ? (f.labels?.[v] || String(v).replace(/_/g, " ")) : fn(v));

export default function DerivScreener() {
  const { status, rows, loading, error } = useDerivRows();
  const [tab, setTab] = useState("presets");
  return (
    <div className="stack">
      <PageHead title="Derivatives & confluence screener" sub="Scan every F&O underlying on positioning, volatility, futures and options data, alone or together with the technical signals." />
      <DerivGate status={status} loading={loading} error={error}>
        <DataNote status={status} />
        <Tabs value={tab} onChange={setTab} tabs={[{ value: "presets", label: "Preset scans" }, { value: "custom", label: "Build a scan" }, { value: "saved", label: "Saved scans & alerts" }, { value: "conf", label: "Confluence & conflicts" }]} />
        {tab === "presets" && <Presets rows={rows} />}
        {tab === "custom" && <Custom rows={rows} />}
        {tab === "saved" && <Saved rows={rows} date={status?.latest} />}
        {tab === "conf" && <Confluence rows={rows} />}
      </DerivGate>
    </div>
  );
}

function Results({ rows, conds, rank, asc, name }) {
  const out = useMemo(() => {
    const m = (rows || []).filter((r) => matches(r, conds));
    const f = DERIV_FIELD[rank];
    return f ? m.sort((a, b) => ((f.value(b) ?? -Infinity) - (f.value(a) ?? -Infinity)) * (asc ? -1 : 1)) : m;
  }, [rows, conds, rank, asc]);
  const extra = [...new Set([rank, ...conds.map((c) => c.field)])].filter((k) => DERIV_FIELD[k] && !["buildup", "kind"].includes(k)).slice(0, 5);
  return (
    <DataTable rows={out} exportName={name || "deriv-scan"} pageSize={40} columns={[
      { key: "u", label: "Underlying", value: (r) => r.und, render: (r) => <a href={href("dchain", { und: r.und })}>{r.und}</a> },
      { key: "sec", label: "Sector", value: (r) => r.sec?.sector || (r.kind === "index" ? "Index" : "—") },
      { key: "b", label: "Positioning", value: (r) => r.s.buildup, render: (r) => <Badge kind={BUILD_BADGE[r.s.buildup]}>{BUILDUP[r.s.buildup]?.label}</Badge> },
      ...extra.map((k) => ({ key: k, label: DERIV_FIELD[k].label, num: DERIV_FIELD[k].type !== "cat", value: (r) => DERIV_FIELD[k].value(r), render: (r) => show(DERIV_FIELD[k], DERIV_FIELD[k].value(r)) })),
      { key: "cf", label: "Confluence", num: true, value: (r) => r.conf?.score, render: (r) => r.conf?.score ?? "—" },
    ]} />
  );
}

function Presets({ rows }) {
  const groups = [...new Set(DERIV_PRESETS.map((p) => p.group))];
  const [g, setG] = useState(groups[0]);
  const [name, setName] = useState(DERIV_PRESETS[0].name);
  const p = DERIV_PRESETS.find((x) => x.name === name && x.group === g) || DERIV_PRESETS.find((x) => x.group === g);
  return (
    <div className="card">
      <Seg value={g} onChange={(x) => { setG(x); setName(DERIV_PRESETS.find((q) => q.group === x).name); }} options={groups} />
      <div style={{ marginTop: 8 }}><Seg value={p.name} onChange={setName} options={DERIV_PRESETS.filter((x) => x.group === g).map((x) => x.name)} /></div>
      <p className="small muted">Conditions: {p.conds.map((c) => `${DERIV_FIELD[c.field].label} ${c.op === "true" ? "is yes" : `${c.op} ${typeof c.value === "number" && DERIV_FIELD[c.field].type === "pct" ? fp(c.value, 0) : c.value}`}`).join(" and ")} · ranked by {DERIV_FIELD[p.rank].label}</p>
      <Results rows={rows} conds={p.conds} rank={p.rank} asc={p.asc} name={p.name} />
    </div>
  );
}

const OPS = [">", ">=", "<", "<=", "=", "!=", "true", "false"];
function Custom({ rows }) {
  const [conds, setConds] = useState([{ field: "buildup", op: "=", value: "long_buildup" }]);
  const [rank, setRank] = useState("futOiChgPct");
  const [q, setQ] = useState("");
  const [read, setRead] = useState(null);
  const [, setSaved] = usePersistent("deriv.screens", []);
  const runText = () => { const p = parseDerivQuery(q); setRead(p.read); if (p.conds.length) setConds(p.conds); };
  const set = (i, patch) => setConds(conds.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <div className="card">
      <div className="row wrap" style={{ gap: 8 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && runText()} placeholder='e.g. "stocks with long build-up and IV rank below 30"' style={{ flex: 1, minWidth: 320 }} />
        <button className="btn sm" onClick={runText}>Read</button>
      </div>
      {read && <p className="small muted">Read as: {read.length ? read.join(" · ") : "nothing recognised; edit the conditions below"}</p>}
      {conds.map((c, i) => {
        const f = DERIV_FIELD[c.field];
        return (
          <div key={i} className="row" style={{ gap: 6, marginTop: 6 }}>
            <select value={c.field} onChange={(e) => set(i, { field: e.target.value, value: DERIV_FIELD[e.target.value].type === "cat" ? DERIV_FIELD[e.target.value].values?.[0] ?? "" : 0, op: DERIV_FIELD[e.target.value].type === "bool" ? "true" : DERIV_FIELD[e.target.value].type === "cat" ? "=" : ">=" })}>
              {DERIV_GROUPS.map((g) => <optgroup key={g} label={g}>{DERIV_FIELDS.filter((x) => x.group === g).map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</optgroup>)}
            </select>
            <select value={c.op} onChange={(e) => set(i, { op: e.target.value })}>{OPS.filter((o) => (f.type === "bool" ? ["true", "false"].includes(o) : f.type === "cat" ? ["=", "!="].includes(o) : !["true", "false"].includes(o))).map((o) => <option key={o}>{o}</option>)}</select>
            {f.type === "cat" ? <select value={c.value} onChange={(e) => set(i, { value: e.target.value })}>{(f.values || []).map((v) => <option key={v} value={v}>{f.labels?.[v] || v}</option>)}</select>
              : f.type !== "bool" && <input type="number" step="any" value={f.type === "pct" ? +(c.value * 100).toFixed(4) : c.value} onChange={(e) => set(i, { value: f.type === "pct" ? (+e.target.value || 0) / 100 : +e.target.value })} style={{ width: 90 }} />}
            {f.type === "pct" && <span className="small muted">%</span>}
            <a style={{ cursor: "pointer" }} onClick={() => setConds(conds.filter((_, j) => j !== i))}>remove</a>
          </div>
        );
      })}
      <div className="row" style={{ gap: 8, margin: "8px 0" }}>
        <button className="btn sm" onClick={() => setConds([...conds, { field: "ivRank", op: ">=", value: 0.5 }])}>+ Condition</button>
        <label className="lbl-ctl">Rank by<select value={rank} onChange={(e) => setRank(e.target.value)}>{DERIV_FIELDS.filter((f) => f.type !== "cat" && f.type !== "bool").map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select></label>
        <button className="btn sm primary" onClick={() => { const n = prompt("Name this scan"); if (n) setSaved((s) => [...s, { id: uid(), name: n, conds, rank, seen: [] }]); }}>Save scan</button>
      </div>
      <Results rows={rows} conds={conds} rank={rank} name="custom-deriv-scan" />
    </div>
  );
}

function Saved({ rows, date }) {
  const [saved, setSaved] = usePersistent("deriv.screens", []);
  if (!saved.length) return <div className="empty">No saved scans yet: build one and press “Save scan”.</div>;
  return (
    <div className="stack">
      {saved.map((s) => {
        const hits = (rows || []).filter((r) => matches(r, s.conds));
        const fresh = hits.filter((r) => !(s.seen || []).includes(r.und));
        return (
          <div key={s.id} className="card">
            <div className="row between">
              <div><b>{s.name}</b> <span className="muted small">{hits.length} match{hits.length === 1 ? "" : "es"} on {date}</span> {s.alert && fresh.length > 0 && <Badge kind="g">{fresh.length} new since you last looked</Badge>}</div>
              <div className="row" style={{ gap: 6 }}>
                <label className="chk"><input type="checkbox" checked={!!s.alert} onChange={(e) => setSaved(saved.map((x) => (x.id === s.id ? { ...x, alert: e.target.checked } : x)))} />Alert on new matches</label>
                <button className="btn sm" onClick={() => setSaved(saved.map((x) => (x.id === s.id ? { ...x, seen: hits.map((r) => r.und) } : x)))}>Mark seen</button>
                <button className="btn sm ghost" onClick={() => setSaved(saved.filter((x) => x.id !== s.id))}>Delete</button>
              </div>
            </div>
            {s.alert && fresh.length > 0 && <div className="small">New: {fresh.map((r) => r.und).join(", ")}</div>}
            <Results rows={rows} conds={s.conds} rank={s.rank} name={s.name} />
          </div>
        );
      })}
    </div>
  );
}

function Confluence({ rows }) {
  const [min, setMin] = useState(0);
  const list = (rows || []).filter((r) => r.conf?.n && (r.conf.score ?? 0) >= min && r.s.buildup !== "neutral");
  return (
    <div className="card">
      <Seg value={min} onChange={setMin} options={[{ value: 0, label: "All" }, { value: 60, label: "Score ≥ 60" }, { value: 80, label: "Score ≥ 80" }]} />
      <DataTable rows={list} exportName="confluence" initialSort={{ key: "s", dir: "desc" }} columns={[
        { key: "u", label: "Underlying", value: (r) => r.und, render: (r) => <a href={href("dchain", { und: r.und })}>{r.und}</a> },
        { key: "b", label: "Positioning", value: (r) => r.s.buildup, render: (r) => <Badge kind={BUILD_BADGE[r.s.buildup]}>{BUILDUP[r.s.buildup]?.label}</Badge> },
        { key: "s", label: "Confluence", num: true, value: (r) => r.conf.score },
        { key: "a", label: "Agree / checks", value: (r) => `${r.conf.agree} / ${r.conf.n}` },
        { key: "e", label: "Agreements", value: (r) => r.conf.items.filter((x) => x.agree).map((x) => `${x.area}: ${x.text}`).join("; ") },
        { key: "c", label: "Conflicts", value: (r) => r.conf.conflicts.join("; "), render: (r) => <span className="neg small">{r.conf.conflicts.join("; ")}</span> },
      ]} />
      <p className="legend-note">Each technical signal (MMA, RSI, RSI of RSI, RSC, Weight Watcher, price patterns) is checked against what futures and options positioning implies. A rising index weight is a relative market-cap change, not evidence of buying.</p>
    </div>
  );
}
