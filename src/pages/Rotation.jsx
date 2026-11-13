// Sector rotation: Leading / Improving / Weakening / Lagging with the path each
// sector took to get there (weekly tail) and every quadrant change.
import { useMemo, useState } from "react";
import { useData } from "../data/store.jsx";
import { useAsync } from "../lib/useAsync.js";
import { PageHead, Select, Badge, QUAD_COLOR, Loading, Empty } from "../components/ui.jsx";
import { DataTable } from "../components/DataTable.jsx";
import { PALETTE } from "../components/TvChart.jsx";

export default function Rotation() {
  const d = useData();
  const { data: scopes } = useAsync(() => d.api.rotationScopes(), []);
  const [scope, setScope] = useState("G");
  const [tail, setTail] = useState(8);
  const { data, loading } = useAsync(() => d.api.rotation(scope), [scope]);
  const [hide, setHide] = useState(new Set());
  const items = useMemo(() => (data || []).map((s, i) => ({ ...s, color: PALETTE[i % PALETTE.length], id: s.key })), [data]);
  const label = (k) => (k === "G" ? "Global (vs global CW, USD)" : k.startsWith("R:") ? `${k.slice(2)} (vs region CW, USD)` : `${k.slice(2)} (vs country CW, local)`);
  return (
    <div className="stack">
      <PageHead title="Sector rotation" sub={`RS-Ratio = 100 x RSC / its ${d.info.methodology.rotation.smaWeeks}-week average; RS-Momentum = 100 x RS-Ratio / RS-Ratio ${d.info.methodology.rotation.momentumWeeks} weeks earlier. Weekly closes of the sector CW index against its market CW index.`}>
        <Select label="Market" value={scope} options={(scopes || ["G"]).map((k) => ({ value: k, label: label(k) }))} onChange={setScope} />
        <Select label="Tail" value={String(tail)} options={["4", "8", "12", "26"].map((v) => ({ value: v, label: `${v} weeks` }))} onChange={(v) => setTail(+v)} />
      </PageHead>
      {loading ? <Loading /> : !items.length ? <Empty>No rotation data for this market (needs at least two sector indices).</Empty> : (
        <div className="grid" style={{ gridTemplateColumns: "minmax(0, 1.3fr) minmax(0, 1fr)" }}>
          <div className="card"><RRG items={items.filter((s) => !hide.has(s.key))} tail={tail} /></div>
          <div className="stack">
            <DataTable exportName="rotation" rows={items} pageSize={20} initialSort={{ key: "ratio", dir: "desc" }}
              columns={[{ key: "name", label: "Sector", value: (s) => s.name, render: (s) => <span className="row" style={{ gap: 5 }}><input type="checkbox" checked={!hide.has(s.key)} onChange={(e) => { const n = new Set(hide); if (e.target.checked) n.delete(s.key); else n.add(s.key); setHide(n); }} /><span className="swatch" style={{ background: s.color }} />{s.name}</span> },
                { key: "q", label: "Quadrant", value: (s) => s.quadrant, render: (s) => <Badge><span style={{ color: QUAD_COLOR[s.quadrant] }}>{s.quadrant}</span></Badge> },
                { key: "ratio", label: "RS-Ratio", num: true, value: (s) => s.ratio }, { key: "mom", label: "RS-Mom", num: true, value: (s) => s.mom },
                { key: "tr", label: "Last change", value: (s) => s.transitions.at(-1)?.date, render: (s) => { const t = s.transitions.at(-1); return t ? <span className="small">{t.from} → {t.to} <span className="muted">{t.date}</span></span> : "—"; } }]} />
            <div className="card"><h3>Movement across categories (last {d.info.methodology.rotation.tailWeeks} weeks)</h3>
              {items.map((s) => (
                <div key={s.key} className="row small" style={{ gap: 2, marginBottom: 3 }}>
                  <span style={{ width: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
                  {s.tail.map((p) => <span key={p.date} title={`${p.date}: ${p.quadrant}`} style={{ width: 9, height: 12, background: QUAD_COLOR[p.quadrant], display: "inline-block", borderRadius: 2 }} />)}
                </div>))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RRG({ items, tail }) {
  const W = 620, H = 520, pad = 40;
  const pts = items.flatMap((s) => s.tail.slice(-tail));
  const xs = pts.map((p) => p.ratio), ys = pts.map((p) => p.mom);
  const span = (a, c) => Math.max(1.5, ...a.map((v) => Math.abs(v - c))) * 1.1;
  const sx = span(xs, 100), sy = span(ys, 100);
  const X = (v) => pad + ((v - (100 - sx)) / (2 * sx)) * (W - 2 * pad);
  const Y = (v) => H - pad - ((v - (100 - sy)) / (2 * sy)) * (H - 2 * pad);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}>
      <rect x={X(100)} y={pad} width={W - pad - X(100)} height={Y(100) - pad} fill="#16a34a" opacity="0.07" />
      <rect x={pad} y={pad} width={X(100) - pad} height={Y(100) - pad} fill="#2563eb" opacity="0.07" />
      <rect x={pad} y={Y(100)} width={X(100) - pad} height={H - pad - Y(100)} fill="#dc2626" opacity="0.07" />
      <rect x={X(100)} y={Y(100)} width={W - pad - X(100)} height={H - pad - Y(100)} fill="#d97706" opacity="0.07" />
      <line x1={X(100)} x2={X(100)} y1={pad} y2={H - pad} stroke="var(--muted)" strokeDasharray="4 4" />
      <line x1={pad} x2={W - pad} y1={Y(100)} y2={Y(100)} stroke="var(--muted)" strokeDasharray="4 4" />
      <text x={W - pad - 4} y={pad + 14} textAnchor="end" fill="#16a34a" fontSize="12" fontWeight="700">LEADING</text>
      <text x={pad + 4} y={pad + 14} fill="#2563eb" fontSize="12" fontWeight="700">IMPROVING</text>
      <text x={pad + 4} y={H - pad - 6} fill="#dc2626" fontSize="12" fontWeight="700">LAGGING</text>
      <text x={W - pad - 4} y={H - pad - 6} textAnchor="end" fill="#d97706" fontSize="12" fontWeight="700">WEAKENING</text>
      <text x={W / 2} y={H - 8} textAnchor="middle" fill="var(--muted)" fontSize="11">RS-Ratio →</text>
      <text x={12} y={H / 2} fill="var(--muted)" fontSize="11" transform={`rotate(-90 12 ${H / 2})`} textAnchor="middle">RS-Momentum →</text>
      {items.map((s) => {
        const t = s.tail.slice(-tail);
        if (!t.length) return null;
        const last = t[t.length - 1];
        return (
          <g key={s.key}>
            <polyline points={t.map((p) => `${X(p.ratio)},${Y(p.mom)}`).join(" ")} fill="none" stroke={s.color} strokeWidth="1.6" opacity="0.8" />
            {t.slice(0, -1).map((p) => <circle key={p.date} cx={X(p.ratio)} cy={Y(p.mom)} r="2.2" fill={s.color} opacity="0.6" />)}
            <circle cx={X(last.ratio)} cy={Y(last.mom)} r="5.5" fill={s.color} stroke="var(--panel)" strokeWidth="1.5"><title>{`${s.name}: ${last.quadrant} (${last.ratio}, ${last.mom}) ${last.date}`}</title></circle>
            <text x={X(last.ratio) + 8} y={Y(last.mom) + 4} fill="var(--text)" fontSize="11">{s.name}</text>
          </g>);
      })}
    </svg>
  );
}
