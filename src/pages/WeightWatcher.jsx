// Weight Watcher: quarterly CW weights of each constituent inside its parent
// CW index, one line per constituent, latest observation at the far right.
import { useEffect, useMemo, useState } from "react";
import { useData } from "../data/store.jsx";
import { useAsync } from "../lib/useAsync.js";
import { navigate } from "../lib/router.js";
import { PageHead, Select, Badge, Check, TREND_BADGE, Loading, Empty } from "../components/ui.jsx";
import { DataTable } from "../components/DataTable.jsx";
import { TvChart, PALETTE } from "../components/TvChart.jsx";
import { wwTrend, WW_TREND_LABEL } from "../../engine/weightWatcher.js";
import { exportXlsx } from "../lib/exporters.js";
import { quarterLabel } from "../../engine/calendar.js";
import { fmtMoney } from "../lib/format.js";

const VIEWS = [
  { value: "G#region", label: "Regions in global" }, { value: "G#classification", label: "DM / EM classifications in global" },
  { value: "G#country", label: "Countries in global" }, { value: "G#sector", label: "Sectors in global" }, { value: "G#cap", label: "Cap segments in global" },
  { value: "R#country", label: "Countries in a region" }, { value: "R#sector", label: "Sectors in a region" }, { value: "M#country", label: "Countries in a classification" },
  { value: "C#sector", label: "Sectors in a country" }, { value: "C#industryGroup", label: "Industry groups in a country" }, { value: "C#cap", label: "Cap segments in a country" },
  { value: "CS#stock", label: "Stocks in a country sector" },
];
// drill: from a child of view X, which view opens next
const DRILL = { "G#region": (k) => ({ v: "R#country", p: `R:${k}` }), "G#classification": (k) => ({ v: "M#country", p: `M:${k}` }), "G#country": (k) => ({ v: "C#sector", p: `C:${k}` }),
  "R#country": (k) => ({ v: "C#sector", p: `C:${k}` }), "M#country": (k) => ({ v: "C#sector", p: `C:${k}` }), "C#sector": (k, p) => ({ v: "CS#stock", p: `${p}|S:${k}` }) };

export default function WeightWatcher({ route }) {
  const d = useData();
  const q = route.query;
  const view = q.view || "G#region";
  const [ptype, ctype] = view.split("#");
  const parent = q.parent || (ptype === "G" ? "G" : ptype === "R" ? `R:${d.regions[0]}` : ptype === "M" ? `M:${d.classifications[0]}` : ptype === "C" ? `C:${d.countries[0]}` : `C:${d.countries[0]}|S:${d.sectors[0]}`);
  const set = (p) => navigate("ww", { view, parent, ...p });
  const { data: grp, loading } = useAsync(() => d.api.ww(parent, ctype), [parent, ctype]);
  const [visible, setVisible] = useState(null);
  useEffect(() => { setVisible(null); }, [parent, ctype]);

  const children = useMemo(() => {
    if (!grp) return [];
    return grp.children.map((c, i) => {
      const sec = ctype === "stock" ? d.secById.get(c.key) : null;
      return { ...c, id: c.key, name: sec ? `${sec.symbol} · ${(sec.name || "").slice(0, 22)}` : c.key, sec, color: PALETTE[i % PALETTE.length], tr: wwTrend(c.weights) };
    });
  }, [grp, ctype, d.secById]);
  const shown = useMemo(() => visible || new Set(children.slice(0, 10).map((c) => c.key)), [visible, children]);
  const toggle = (k, on) => { const n = new Set(shown); if (on) n.add(k); else n.delete(k); setVisible(n); };

  const series = useMemo(() => {
    if (!grp) return [];
    return children.filter((c) => shown.has(c.key)).map((c) => {
      const data = [];
      grp.dates.forEach((dt, i) => { if (c.weights[i] != null) data.push({ time: dt, value: c.weights[i] }); });
      const markers = [];
      if (c.tr.trend === "turn_up_from_low" && data.length) markers.push({ time: data[data.length - 1].time, position: "belowBar", shape: "arrowUp", color: "#16a34a", text: "turn up" });
      if (c.tr.trend === "turn_down_from_high" && data.length) markers.push({ time: data[data.length - 1].time, position: "aboveBar", shape: "arrowDown", color: "#dc2626", text: "turn down" });
      return { id: c.key, type: "line", data, markers, options: { color: c.color, lineWidth: 2, title: c.name.split(" · ")[0], pointMarkersVisible: true } };
    });
  }, [children, shown, grp]);

  const parentOptions = ptype === "R" ? d.regions.map((r) => ({ value: `R:${r}`, label: r })) : ptype === "M" ? d.classifications.map((c) => ({ value: `M:${c}`, label: c }))
    : ptype === "C" ? d.countries.map((c) => ({ value: `C:${c}`, label: c })) : null;
  const doExport = () => exportXlsx(`weight_watcher_${parent.replace(/[|:]/g, "_")}_${ctype}`, [{
    name: "weights", note: `CW weight (%) of each ${ctype} in ${parent}; quarter-end observations${grp.latestFlags.some(Boolean) ? "; the last column is the latest (partial-quarter) observation" : ""}`,
    columns: [{ label: ctype, value: (c) => c.name }, ...grp.dates.map((dt, i) => ({ label: grp.latestFlags[i] ? `${dt} (latest)` : quarterLabel(dt), value: (c) => c.weights[i] })), { label: "Trend", value: (c) => WW_TREND_LABEL[c.tr.trend] }],
    rows: children,
  }]);

  return (
    <div className="stack">
      <PageHead title="Weight Watcher" sub="Market-cap weight of each constituent within its parent CW index, by quarter. Weight = constituent cap / parent aggregate cap over the parent's own constituents at that date. CW weights only — an EW index weights every member equally by construction.">
        <Select label="View" value={view} options={VIEWS} onChange={(v) => navigate("ww", { view: v })} />
        {parentOptions && <Select label="Parent" value={parent} options={parentOptions} onChange={(v) => set({ parent: v })} />}
        {ptype === "CS" && <>
          <Select label="Country" value={parent.split("|")[0].slice(2)} options={d.countries} onChange={(v) => set({ parent: `C:${v}|S:${parent.split("|S:")[1]}` })} />
          <Select label="Sector" value={parent.split("|S:")[1]} options={d.sectors} onChange={(v) => set({ parent: `${parent.split("|")[0]}|S:${v}` })} />
        </>}
        {grp && <button className="btn sm" onClick={doExport}>Export Excel</button>}
      </PageHead>
      {loading ? <Loading /> : !grp ? <Empty>No weight history for this parent.</Empty> : (
        <>
          <div className="card tight">
            <div className="row between" style={{ padding: "2px 6px 6px" }}>
              <b>{parent === "G" ? "Global" : parent.replace(/^[A-Z]:/, "").replace("|S:", " · ")} — {ctype} weights (%)</b>
              <div className="row">
                <button className="btn sm" onClick={() => setVisible(new Set(children.slice(0, 10).map((c) => c.key)))}>Top 10</button>
                <button className="btn sm" onClick={() => setVisible(new Set(children.map((c) => c.key)))}>All</button>
                <button className="btn sm" onClick={() => setVisible(new Set())}>None</button>
              </div>
            </div>
            <TvChart height={380} series={series} />
            <div className="legend" style={{ padding: 6 }}>
              {children.slice(0, 40).map((c) => (
                <span key={c.key} className="row" style={{ gap: 4 }}>
                  <Check checked={shown.has(c.key)} onChange={(on) => toggle(c.key, on)} color={c.color}>{c.name.split(" · ")[0]}</Check>
                  <button className="btn sm ghost" title="Isolate this line" onClick={() => setVisible(new Set([c.key]))}>◎</button>
                </span>))}
            </div>
          </div>
          <DataTable exportName="ww_table" rows={children} initialSort={{ key: "w", dir: "desc" }} pageSize={30}
            columns={[
              { key: "name", label: ctype, value: (c) => c.name, render: (c) => { const dr = DRILL[view]; if (c.sec) return <a href={`#/stock/${c.sec.id}`}>{c.name}</a>; return dr ? <a onClick={() => { const n = dr(c.key, parent); navigate("ww", { view: n.v, parent: n.p }); }} style={{ cursor: "pointer" }}>{c.name} ›</a> : c.name; } },
              { key: "w", label: "Latest weight %", num: true, value: (c) => c.tr.last, render: (c) => c.tr.last?.toFixed(3) ?? "—" },
              { key: "p", label: "Prior quarter %", num: true, value: (c) => c.tr.prev, render: (c) => c.tr.prev?.toFixed(3) ?? "—" },
              { key: "c4", label: "Change over 4 obs.", num: true, value: (c) => (c.tr.change4 != null ? c.tr.change4 * 100 : null), render: (c) => (c.tr.change4 != null ? `${(c.tr.change4 * 100).toFixed(1)}%` : "—") },
              { key: "t", label: "Trend / turning point", value: (c) => c.tr.trend, render: (c) => <Badge kind={TREND_BADGE[c.tr.trend]}>{WW_TREND_LABEL[c.tr.trend]}</Badge> },
              { key: "cap", label: "Latest cap (USD)", num: true, value: (c) => c.caps.at(-1), render: (c) => fmtMoney(c.caps.at(-1)) },
              { key: "show", label: "Chart", value: () => null, export: false, render: (c) => <Check checked={shown.has(c.key)} onChange={(on) => toggle(c.key, on)} /> },
            ]} />
          <div className="small muted">Observations: {grp.dates.length} ({grp.dates[0]} → {grp.dates.at(-1)}{grp.latestFlags.at(-1) ? ", last = latest partial quarter" : ""}). Turning-point rules: rising/falling = two consecutive moves; turn up/down = the prior observation was the low/high of the last {d.info.methodology.ww.turnLookbackQuarters} quarters; sideways = within ±{d.info.methodology.ww.sidewaysRel * 100}% over 4 observations.</div>
        </>
      )}
    </div>
  );
}
