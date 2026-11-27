// The two index sets built from the owner's workbook New_Index_Creation.xlsx (item 21):
// "Exchange Major Indices" (FG... sets) and "US ETF Indices" (ETF... sets). Shows each set's chart, its members as the workbook
// lists them, how each member was resolved (series held, proxy, or missing) and the method. Series: cli/indexSetsJob.mjs.
import { useMemo, useState } from "react";
import { useData } from "../data/store.jsx";
import { useAsync } from "../lib/useAsync.js";
import { PageHead, Tabs, Loading, ErrorBox, Empty } from "../components/ui.jsx";
import { TvChart } from "../components/TvChart.jsx";
import { exportCsv } from "../lib/exporters.js";
import { href } from "../lib/router.js";
import { encodeRef } from "../lib/instruments.js";

const STATUS = { ok: ["Held", "#16a34a"], proxy: ["Proxy (stand-in)", "#d97706"], missing: ["Missing", "#dc2626"], duplicate: ["Duplicate", "#6b7280"] };
const KIND = { set: "another set", leaf: "index / commodity", etf: "ETF" };
const fp = (v) => (v == null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(1)}%`);

export default function IndexSets() {
  const { api } = useData();
  const [sheet, setSheet] = useState("exchange");
  const [sel, setSel] = useState(null);
  const { data: sets, loading, error } = useAsync(() => api.indexSets(), [api]);
  const list = useMemo(() => (sets || []).filter((s) => s.sheet === sheet), [sets, sheet]);
  const cur = list.find((s) => s.symbol === sel) || list[0] || null;
  const { data: ser } = useAsync(() => (cur ? api.extraSeries(cur.symbol) : null), [api, cur?.symbol]);
  const stats = useMemo(() => {
    if (!ser?.dates?.length) return null;
    const n = ser.close.length, at = (days) => { const t = Date.parse(ser.dates[n - 1]) - days * 864e5; let i = n - 1; while (i > 0 && Date.parse(ser.dates[i]) > t) i--; return ser.close[i]; };
    const last = ser.close[n - 1];
    return { last, d1: last / ser.close[n - 2] - 1, m1: last / at(30) - 1, y1: last / at(365) - 1, all: last / ser.close[0] - 1 };
  }, [ser]);
  const series = ser?.dates?.length ? [{ id: "set", type: "line", data: ser.dates.map((d, i) => ({ time: d, value: ser.close[i] })), options: { color: "#16a34a", lineWidth: 2, title: cur?.code } }] : [];
  const chartHref = cur ? href(`chart/${encodeURIComponent(encodeRef({ kind: "x", key: cur.symbol }))}`) : "#";

  if (loading) return <Loading what="index sets" />;
  if (error) return <ErrorBox error={error} />;
  return (
    <div className="page">
      <PageHead title="Index sets" sub="Two sets from the workbook New_Index_Creation.xlsx, built in USD, equal-weighted. Search any set by its code in the ticker box.">
        <Tabs tabs={[{ value: "exchange", label: "Exchange major indices (FG)" }, { value: "etf", label: "US ETF indices (ETF)" }]} value={sheet} onChange={(v) => { setSheet(v); setSel(null); }} />
      </PageHead>
      {!list.length ? <Empty>The sets are built by the server once a day with the chart series (about 20 hours after deploy). Nothing is stored yet.</Empty> : (
        <div className="grid" style={{ gridTemplateColumns: "minmax(260px, 340px) 1fr", gap: 12, alignItems: "start" }}>
          <div className="card" style={{ padding: 0 }}>
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>Set</th><th className="num">Members held</th></tr></thead>
              <tbody>{list.map((s) => (
                <tr key={s.symbol} onClick={() => setSel(s.symbol)} style={{ cursor: "pointer", background: cur?.symbol === s.symbol ? "var(--row-hover, rgba(22,163,74,.12))" : undefined }}>
                  <td>{s.label}</td><td className="num">{s.n_resolved} / {s.n_members}</td>
                </tr>))}</tbody></table></div>
          </div>
          {cur && <div>
            <div className="card">
              <div className="row between"><div className="h3">{cur.label}</div>
                <div className="row" style={{ gap: 8 }}>
                  <a className="btn sm primary" href={chartHref}>Chart lab</a>
                  <button className="btn sm" onClick={() => exportCsv(`${cur.code}-members`, [{ label: "Workbook ticker", value: (m) => m.raw }, { label: "Resolved as", value: (m) => m.symbol || "" }, { label: "Status", value: (m) => STATUS[m.status]?.[0] || m.status }, { label: "Kind", value: (m) => KIND[m.kind] || m.kind }, { label: "First bar", value: (m) => m.first || "" }, { label: "Last bar", value: (m) => m.last || "" }], cur.members)}>Export members</button>
                </div></div>
              {stats && <div className="row" style={{ gap: 24, flexWrap: "wrap", margin: "6px 0" }}>
                <span>Level <b>{stats.last.toFixed(2)}</b> <span className="muted small">(base 100 at {cur.start_date})</span></span>
                <span>1D <b>{fp(stats.d1)}</b></span><span>1M <b>{fp(stats.m1)}</b></span><span>1Y <b>{fp(stats.y1)}</b></span><span>Since start <b>{fp(stats.all)}</b></span>
                <span className="muted small">to {cur.last_date}</span>
              </div>}
              {series.length ? <TvChart height={300} logScale series={series} /> : <Empty>No series yet for this set (none of its members is held).</Empty>}
              <p className="legend-note">{cur.method}</p>
            </div>
            <div className="card">
              <div className="h3">Members in the workbook ({cur.n_members}), {cur.n_resolved} found</div>
              <div className="tbl-wrap"><table className="tbl">
                <thead><tr><th>Workbook ticker</th><th>Resolved as</th><th>Status</th><th>Kind</th><th>First bar</th><th>Last bar</th></tr></thead>
                <tbody>{cur.members.map((m, i) => {
                  const st = STATUS[m.status] || [m.status, "#6b7280"];
                  return <tr key={i}><td>{m.raw}{m.code !== m.raw ? <span className="muted small"> → {m.code}</span> : null}</td><td className="small">{m.symbol || "—"}{m.duplicateOf ? <span className="muted"> (same as {m.duplicateOf})</span> : null}</td>
                    <td><span className="badge" style={{ background: st[1], color: "#fff" }}>{st[0]}</span></td><td className="small">{KIND[m.kind] || m.kind}</td><td className="small">{m.first || "—"}</td><td className="small">{m.last || "—"}</td></tr>;
                })}</tbody></table></div>
              <p className="legend-note">Missing = no live series in the app for that workbook ticker (nothing is invented). Proxy = a country ETF or Treasury ETF standing in for an index the app cannot hold (MSCI levels are licensed). A nested set uses that set's own level.</p>
            </div>
          </div>}
        </div>
      )}
    </div>
  );
}
