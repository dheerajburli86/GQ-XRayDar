// GQ breadth analyser: the owner's CCR / OUP / RR / RRM / RRMK / TR / TRMK table for a parent index and
// its constituents (sector, size or country indices) over chosen periods, plus "reverse CCR for
// ranges" (end date fixed, start date stepping back one trading day at a time). Maths: engine/breadthRange.js.
import { useMemo, useState } from "react";
import { useData } from "../data/store.jsx";
import { useAsync } from "../lib/useAsync.js";
import { PageHead, Select, Loading } from "../components/ui.jsx";
import { exportCsv } from "../lib/exporters.js";
import { breadthForPeriod, reverseRange, startForLookback } from "../../engine/breadthRange.js";

const LOOKBACKS = ["1D", "1W", "2W", "1M", "2M", "3M", "6M", "YTD", "1Y"];
const f2 = (v) => (v == null ? "—" : v.toFixed(2));
const fp = (v) => (v == null ? "—" : `${(v * 100).toFixed(2)}%`);
const fpc = (v) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);

const COLS = [
  { label: "% Change", value: (r) => (r.change * 100), fmt: (r) => `${(r.change * 100).toFixed(2)}%` },
  { label: "CCR", value: (r) => r.ccr, fmt: (r) => f2(r.ccr), bold: true },
  { label: "OUP", value: (r) => r.oup, fmt: (r) => f2(r.oup) },
  { label: "RR", value: (r) => r.rr, fmt: (r) => fp(r.rr) },
  { label: "RRM", value: (r) => r.rrm, fmt: (r) => fp(r.rrm) },
  { label: "RRMK", value: (r) => r.rrmk, fmt: (r) => fpc(r.rrmk) },
  { label: "TR", value: (r) => r.tr, fmt: (r) => f2(r.tr) },
  { label: "TRMK", value: (r) => r.trmk, fmt: (r) => f2(r.trmk), hi: true },
];

/** Parent options and the constituent kinds each offers, read from the stored index list. */
function buildOptions(list) {
  const usd = list.filter((x) => x.ccy === "USD" && x.family === "CW");
  const parents = [{ value: "G", label: "Global" }];
  for (const x of usd.filter((y) => y.level === "4")) parents.push({ value: x.scopeKey, label: `${x.scopeValue} (region)` });
  for (const x of usd.filter((y) => y.level === "5")) parents.push({ value: x.scopeKey, label: `${x.scopeValue} (classification)` });
  for (const x of usd.filter((y) => y.level === "3").sort((a, b) => a.scopeValue.localeCompare(b.scopeValue))) parents.push({ value: x.scopeKey, label: x.scopeValue });
  return parents;
}

function childrenOf(list, parent, kind, fam) {
  const L = list.filter((x) => x.ccy === "USD" && x.family === fam);
  const name = (x) => x.sector || x.scopeValue || x.name;
  if (parent === "G") {
    const lvl = kind === "regions" ? "4" : kind === "classifications" ? "5" : "3";
    return L.filter((x) => x.level === lvl).map((x) => ({ key: x.key, name: x.scopeValue || name(x) }));
  }
  if (parent.startsWith("R:") || parent.startsWith("M:")) {
    const field = parent[0] === "R" ? "region" : "classification", v = parent.slice(2);
    return L.filter((x) => x.level === "3" && x[field] === v).map((x) => ({ key: x.key, name: x.scopeValue || name(x) }));
  }
  if (kind === "size") return L.filter((x) => x.level === "2" && x.scopeKey.startsWith(`${parent}|K:`)).map((x) => ({ key: x.key, name: x.scopeKey.split("|K:")[1] }));
  return L.filter((x) => x.level === "1s" && x.scopeKey.startsWith(`${parent}|S:`)).map((x) => ({ key: x.key, name: x.scopeKey.split("|S:")[1] }));
}

function kindsFor(parent) {
  if (parent === "G") return [{ value: "countries", label: "Countries" }, { value: "regions", label: "Regions" }, { value: "classifications", label: "Market classifications" }];
  if (parent.startsWith("R:") || parent.startsWith("M:")) return [{ value: "countries", label: "Countries" }];
  return [{ value: "sectors", label: "Sectors" }, { value: "size", label: "Size segments" }];
}

export default function BreadthAnalyser() {
  const d = useData();
  const { data: list } = useAsync(() => d.api.indexList(), []);
  const [parent, setParent] = useState("C:India");
  const [kind, setKind] = useState("sectors");
  const [fam, setFam] = useState("CW");
  const [endSel, setEndSel] = useState("");
  const [picked, setPicked] = useState(["1D", "1W", "1M", "3M", "6M", "1Y"]);
  const [days, setDays] = useState(25);
  const parents = useMemo(() => (list ? buildOptions(list) : []), [list]);
  const kinds = kindsFor(parent);
  const kindNow = kinds.some((k) => k.value === kind) ? kind : kinds[0].value;
  const kids = useMemo(() => {
    if (!list) return [];
    let k = childrenOf(list, parent, kindNow, fam);
    if (!k.length) k = childrenOf(list, parent, kindNow, fam === "CW" ? "EW" : "CW");
    return k;
  }, [list, parent, kindNow, fam]);
  const famUsed = useMemo(() => (list && kids.length ? list.find((x) => x.key === kids[0].key)?.family : fam), [list, kids, fam]);

  const { data: series, loading } = useAsync(async () => {
    const out = await Promise.all(kids.map(async (k) => {
      const s = await d.api.indexSeries(k.key);
      return s ? { name: k.name, dates: s.dates, level: s.level, cap: s.cap && s.cap.some((v) => v > 0) ? s.cap : null } : null;
    }));
    return out.filter(Boolean);
  }, [kids.map((k) => k.key).join("|")]);

  const calendar = useMemo(() => {
    if (!series?.length) return [];
    return series.reduce((a, s) => (s.dates.length > a.length ? s.dates : a), []);
  }, [series]);
  const lastDate = calendar.at(-1) || "";
  const end = endSel && endSel <= lastDate ? endSel : lastDate;

  const periods = useMemo(() => {
    if (!series?.length || !end) return [];
    return picked.map((p) => {
      const start = startForLookback(calendar, end, p);
      const r = start ? breadthForPeriod(series, start, end) : null;
      return r ? { label: p, ...r } : null;
    }).filter(Boolean);
  }, [series, calendar, end, picked]);
  const rev = useMemo(() => (series?.length && end ? reverseRange(series, calendar, end, days) : []), [series, calendar, end, days]);
  const equalW = periods[0]?.equalWeighted || rev[0]?.equalWeighted;
  const toggle = (p) => setPicked((x) => (x.includes(p) ? x.filter((y) => y !== p) : [...x, p]));

  const exportRows = (rows, withLabel) => {
    const cols = [...(withLabel ? [{ label: "Period", value: (r) => r.label }] : []), { label: "from_date", value: (r) => r.start }, { label: "to_date", value: (r) => r.end }, ...COLS.map((c) => ({ label: c.label, value: c.value }))];
    exportCsv(`breadth-${parent.replace(/[^\w]+/g, "_")}-${withLabel ? "periods" : "reverse"}-${end}`, cols, rows);
  };

  const renderTable = (rows, labelled) => (
    <div className="tbl-wrap"><table className="tbl">
      <thead><tr>{labelled && <th>Period</th>}<th>from_date</th><th>to_date</th>{COLS.map((c) => <th key={c.label}>{c.label}</th>)}</tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={`${r.start}|${r.end}`}>
          {labelled && <td><b>{r.label}</b></td>}<td>{r.start}</td><td>{r.end}</td>
          {COLS.map((c) => <td key={c.label} style={{ fontWeight: c.bold || c.hi ? 700 : 400, background: c.hi ? "#fff200" : undefined, color: c.hi ? "#000" : undefined, textAlign: "right" }}>{c.fmt(r)}</td>)}
        </tr>
      ))}</tbody>
    </table></div>
  );

  return (
    <div>
      <PageHead title="Breadth analyser" sub="CCR, OUP, RR, RRM, RRMK, TR and TRMK for a parent index over chosen periods, and reverse CCR for ranges">
        <Select label="Parent" value={parent} options={parents.length ? parents : [parent]} onChange={(v) => setParent(v || "G")} />
        <Select label="Constituents" value={kindNow} options={kinds} onChange={(v) => setKind(v)} />
        <Select label="Weighting" value={fam} options={[{ value: "CW", label: "Cap-weighted" }, { value: "EW", label: "Equal-weighted" }]} onChange={(v) => setFam(v)} />
        <label className="lbl-ctl">End date<input type="date" value={end} max={lastDate} onChange={(e) => setEndSel(e.target.value)} /></label>
      </PageHead>
      {!list || loading ? <Loading what="indices" /> : !series?.length ? <div className="empty">No constituent indices found for this parent.</div> : (
        <>
          <div className="note" style={{ margin: "6px 0 10px" }}>
            {series.length} constituents ({famUsed === "EW" ? "equal-weighted indices" : "cap-weighted indices"}), changes from index levels, weights from each constituent's cap on the start date.
            {equalW && " No cap history for these indices, so every constituent carries the same weight."}
          </div>
          <div className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            <b>Periods</b>
            {LOOKBACKS.map((p) => <button key={p} className={picked.includes(p) ? "on" : ""} onClick={() => toggle(p)}>{p}</button>)}
            <button onClick={() => exportRows(periods, true)} disabled={!periods.length}>Export CSV</button>
          </div>
          {periods.length ? renderTable(periods, true) : <div className="empty">Pick at least one period.</div>}
          <h3 style={{ margin: "18px 0 6px" }}>Reverse CCR for ranges</h3>
          <div className="row" style={{ gap: 8, marginBottom: 8 }}>
            <span className="note">End date fixed at {end}; the start date steps back one trading day per row.</span>
            <label className="lbl-ctl">Rows<input type="number" min={2} max={250} value={days} onChange={(e) => setDays(Math.max(2, Math.min(250, +e.target.value || 25)))} style={{ width: 70 }} /></label>
            <button onClick={() => exportRows(rev, false)} disabled={!rev.length}>Export CSV</button>
          </div>
          {rev.length ? renderTable(rev, false) : <div className="empty">Not enough history before the end date.</div>}
        </>
      )}
    </div>
  );
}
