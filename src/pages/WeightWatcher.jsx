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

const CHILD_LABEL = { industryGroup: "Industry group", country: "Country", region: "Region", sector: "Sector", cap: "Cap segment", classification: "Classification", stock: "Stock" };
const VIEWS = [
  { value: "G#region", label: "Regions in global" }, { value: "G#classification", label: "DM / EM classifications in global" },
  { value: "G#country", label: "Countries in global" }, { value: "G#sector", label: "Sectors in global" }, { value: "G#cap", label: "Cap segments in global" },
  { value: "R#country", label: "Countries in a region" }, { value: "R#sector", label: "Sectors in a region" }, { value: "M#country", label: "Countries in a classification" },
  { value: "C#sector", label: "Sectors in a country" }, { value: "C#industryGroup", label: "Industry groups in a country" }, { value: "C#cap", label: "Cap segments in a country" },
  { value: "CS#stock", label: "Stocks in a country sector" },
  { value: "G#industryGroup", label: "Industry groups in global" }, { value: "R#industryGroup", label: "Industry groups in a region" },
  { value: "GI#country", label: "Countries in a global industry group" }, { value: "CI#stock", label: "Stocks in a country industry group" },
];
// drill: from a child of view X, which view opens next
const DRILL = { "G#region": (k) => ({ v: "R#country", p: `R:${k}` }), "G#classification": (k) => ({ v: "M#country", p: `M:${k}` }), "G#country": (k) => ({ v: "C#sector", p: `C:${k}` }),
  "R#country": (k) => ({ v: "C#sector", p: `C:${k}` }), "M#country": (k) => ({ v: "C#sector", p: `C:${k}` }), "C#sector": (k, p) => ({ v: "CS#stock", p: `${p}|S:${k}` }),
  "C#industryGroup": (k, p) => ({ v: "CI#stock", p: `${p}|I:${k}` }), "G#industryGroup": (k) => ({ v: "GI#country", p: `G|I:${k}` }), "R#industryGroup": (k) => ({ v: "GI#country", p: `G|I:${k}` }),
  "GI#country": (k, p) => ({ v: "CI#stock", p: `C:${k}|I:${p.split("|I:")[1]}` }) };

export default function WeightWatcher({ route }) {
  const d = useData();
  const q = route.query;
  const view = q.view || "G#region";
  const [ptype, ctype] = view.split("#");
  const igs = useMemo(() => [...new Set(d.secs.map((x) => x.industryGroup).filter((x) => x && x !== "Others"))].sort(), [d.secs]);
  const parent = q.parent || (ptype === "G" ? "G" : ptype === "R" ? `R:${d.regions[0]}` : ptype === "M" ? `M:${d.classifications[0]}` : ptype === "C" ? `C:${d.countries[0]}`
    : ptype === "GI" ? `G|I:${igs[0]}` : ptype === "CI" ? `C:${d.countries[0]}|I:${igs[0]}` : `C:${d.countries[0]}|S:${d.sectors[0]}`);
  const set = (p) => navigate("ww", { view, parent, ...p });
  const { data: grp, loading } = useAsync(() => d.api.ww(parent, ctype), [parent, ctype]);
  const [visible, setVisible] = useState(null);
  const [page, setPage] = useState(0); // which block of 10 (by latest weight) is on the chart
  const [log, setLog] = useState(true); // owner (Nov 2026): log scale by default, so small weights are readable
  useEffect(() => { setVisible(null); setPage(0); }, [parent, ctype]);

  const children = useMemo(() => {
    if (!grp) return [];
    // ordered by latest weight, largest first, so "Top 10", "Next 10" ... walk down the list
    return grp.children.map((c) => ({ c, tr: wwTrend(c.weights) }))
      .sort((a, b) => (b.tr.last ?? -1) - (a.tr.last ?? -1))
      .map(({ c, tr }, i) => {
        const sec = ctype === "stock" ? d.secById.get(c.key) : null;
        return { ...c, id: c.key, name: sec ? `${sec.symbol} · ${(sec.name || "").slice(0, 22)}` : c.key, sec, color: PALETTE[i % PALETTE.length], tr };
      });
  }, [grp, ctype, d.secById]);
  const shown = useMemo(() => visible || new Set(children.slice(0, 10).map((c) => c.key)), [visible, children]);
  const pages = Math.max(1, Math.ceil(children.length / 10));
  const showPage = (p) => { const k = Math.max(0, Math.min(pages - 1, p)); setPage(k); setVisible(new Set(children.slice(k * 10, k * 10 + 10).map((c) => c.key))); };
  const toggle = (k, on) => { const n = new Set(shown); if (on) n.add(k); else n.delete(k); setVisible(n); };

  const series = useMemo(() => {
    if (!grp) return [];
    return children.filter((c) => shown.has(c.key)).map((c) => {
      const data = [];
      grp.dates.forEach((dt, i) => { if (c.weights[i] != null) data.push({ time: dt, value: c.weights[i] }); });
      const markers = [];
      if (c.tr.trend === "turn_up_from_low" && data.length) markers.push({ time: data[data.length - 1].time, position: "belowBar", shape: "arrowUp", color: "#16a34a", text: "turn up" });
      if (c.tr.trend === "turn_down_from_high" && data.length) markers.push({ time: data[data.length - 1].time, position: "aboveBar", shape: "arrowDown", color: "#dc2626", text: "turn down" });
      // names show on hover only (owner): no titles or last values on the price axis
      return { id: c.key, name: c.name, type: "line", data, markers, options: { color: c.color, lineWidth: 2, lastValueVisible: false, pointMarkersVisible: true } };
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
      <PageHead title="Weight Watcher" sub="Market-cap weight of each constituent within its parent CW index, by quarter. Weight = constituent cap / parent aggregate cap over the parent's own constituents at that date. CW weights only — an EW index weights every member equally by construction. Bad price prints (a jump that comes straight back) are ignored, and a stock whose price history is not adjusted for a split or restructuring counts only from that date.">
        <Select label="View" value={view} options={VIEWS} onChange={(v) => navigate("ww", { view: v })} />
        {parentOptions && <Select label="Parent" value={parent} options={parentOptions} onChange={(v) => set({ parent: v })} />}
        {ptype === "GI" && <Select label="Industry group" value={parent.split("|I:")[1]} options={igs} onChange={(v) => set({ parent: `G|I:${v}` })} />}
        {ptype === "CI" && <>
          <Select label="Country" value={parent.split("|")[0].slice(2)} options={d.countries} onChange={(v) => set({ parent: `C:${v}|I:${parent.split("|I:")[1]}` })} />
          <Select label="Industry group" value={parent.split("|I:")[1]} options={igs} onChange={(v) => set({ parent: `${parent.split("|")[0]}|I:${v}` })} />
        </>}
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
              <b>{parent === "G" ? "Global" : parent.replace(/^G\|I:/, "Global · ").replace(/^[A-Z]:/, "").replace("|S:", " · ").replace("|I:", " · ")} — {ctype === "industryGroup" ? "industry group" : ctype} weights (%)</b>
              <div className="row">
                <button className="btn sm" onClick={() => showPage(0)}>Top 10</button>
                <button className="btn sm" disabled={page <= 0} onClick={() => showPage(page - 1)} title="Previous 10 by weight">◀ Prev 10</button>
                <span className="small muted mono">{children.length ? `${page * 10 + 1}–${Math.min(children.length, page * 10 + 10)} of ${children.length}` : ""}</span>
                <button className="btn sm" disabled={page >= pages - 1} onClick={() => showPage(page + 1)} title="Next 10 by weight">Next 10 ▶</button>
                <button className="btn sm" onClick={() => setVisible(new Set(children.map((c) => c.key)))}>All</button>
                <button className="btn sm" onClick={() => setVisible(new Set())}>None</button>
                <Check checked={log} onChange={setLog}>Log scale</Check>
              </div>
            </div>
            <TvChart height={380} series={series} hoverNames logScale={log} />
            {grp.gaps?.length > 0 && <div className="note small" style={{ margin: "4px 6px" }}>
              {grp.gaps.length} quarter{grp.gaps.length > 1 ? "s" : ""} left empty ({grp.gaps[0].date}{grp.gaps.length > 1 ? ` to ${grp.gaps.at(-1).date}` : ""}): {[...new Set(grp.gaps.flatMap((g) => g.countries))].slice(0, 6).join(", ")} had too few stocks with prices then, so any weight would be wrong.</div>}
            <div className="legend" style={{ padding: 6 }}>
              {children.slice(page * 10, page * 10 + 10).concat(children.filter((c, i) => shown.has(c.key) && (i < page * 10 || i >= page * 10 + 10)).slice(0, 30)).map((c) => (
                <span key={c.key} className="row" style={{ gap: 4 }}>
                  <Check checked={shown.has(c.key)} onChange={(on) => toggle(c.key, on)} color={c.color}>{c.name.split(" · ")[0]}</Check>
                  <button className="btn sm ghost" title="Isolate this line" onClick={() => setVisible(new Set([c.key]))}>◎</button>
                </span>))}
            </div>
          </div>
          <DataTable exportName="ww_table" rows={children} initialSort={{ key: "w", dir: "desc" }} pageSize={30}
            columns={[
              { key: "name", label: CHILD_LABEL[ctype] || ctype, value: (c) => c.name, render: (c) => { const dr = DRILL[view]; if (c.sec) return <a href={`#/stock/${c.sec.id}`}>{c.name}</a>; return dr ? <a onClick={() => { const n = dr(c.key, parent); navigate("ww", { view: n.v, parent: n.p }); }} style={{ cursor: "pointer" }}>{c.name} ›</a> : c.name; } },
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
