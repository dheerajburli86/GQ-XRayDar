// CW / EW index hierarchy: browse every index, chart local and USD side by side,
// inspect point-in-time constituents, FX provenance and revision history.
import { useMemo, useState } from "react";
import { useData } from "../data/store.jsx";
import { useAsync } from "../lib/useAsync.js";
import { navigate } from "../lib/router.js";
import { PageHead, Seg, Select, Badge, Pct, Loading, StockLink, Tabs } from "../components/ui.jsx";
import { DataTable } from "../components/DataTable.jsx";
import { TvChart, lineData } from "../components/TvChart.jsx";
import { LEVEL_LABEL, parseIndexKey } from "../../engine/indexEngine.js";
import { changeOver, HBARS, changeYtd } from "../lib/indexMath.js";
import { exportXlsx } from "../lib/exporters.js";
import { fmtInr, fmtMoney } from "../lib/format.js";

const LEVELS = ["1", "1s", "2", "3", "4", "4s", "5", "5s", "6", "6s"];

export default function Indices({ route }) {
  const d = useData();
  const [lvl, setLvl] = useState(route.query.level || "");
  const [fam, setFam] = useState("CW");
  const [ccy, setCcy] = useState("");
  const [qText, setQText] = useState("");
  const selected = route.query.key || "CW|USD|G";
  const [tab, setTab] = useState("chart");

  const list = useMemo(() => d.indices.filter((x) => (!lvl || x.level === lvl) && (!fam || x.family === fam) && (!ccy || x.ccy === ccy)
    && (!qText || x.name.toLowerCase().includes(qText.toLowerCase()))), [d.indices, lvl, fam, ccy, qText]);

  const meta = d.indexByKey.get(selected);
  const p = parseIndexKey(selected);
  const pairKey = `${p.family === "CW" ? "EW" : "CW"}|${p.ccy}|${p.scopeKey}`;
  const ccyKey = `${p.family}|${p.ccy === "USD" ? "LCL" : "USD"}|${p.scopeKey}`;
  const { data, loading } = useAsync(async () => {
    const [s, pair, other, rev] = await Promise.all([d.api.indexSeries(selected), d.api.indexSeries(pairKey), d.indexByKey.has(ccyKey) ? d.api.indexSeries(ccyKey) : null, d.api.revisions(selected)]);
    const country = meta?.country;
    const mem = country ? await d.api.membership(country) : null;
    const fx = meta?.ccy === "LCL" || d.indexByKey.has(ccyKey) ? await d.api.fxSeries(meta?.currencyCode !== "USD" ? meta?.currencyCode : d.indexByKey.get(ccyKey)?.currencyCode) : null;
    return { s, pair, other, rev, mem, fx };
  }, [selected]);

  const members = useMemo(() => {
    if (!data?.mem) return [];
    const ms = data.mem.members.filter((m) => (!p.sector || m.sector === p.sector) && (!p.cap || m.seg === p.cap));
    const tot = ms.reduce((a, m) => a + m.capUsd, 0);
    return ms.map((m) => ({ ...m, sec: d.secById.get(m.id), cw: tot ? (m.capUsd / tot) * 100 : null, ew: ms.length ? 100 / ms.length : null })).sort((a, b) => b.capUsd - a.capUsd);
  }, [data, p.sector, p.cap, d.secById]);

  const series = useMemo(() => {
    if (!data?.s) return [];
    const out = [{ id: "s", type: "line", data: lineData(data.s.dates, data.s.level), options: { color: "#14a44d", lineWidth: 2, title: `${p.family} ${p.ccy}` } }];
    if (data.pair) out.push({ id: "pair", type: "line", data: lineData(data.pair.dates, data.pair.level), options: { color: "#2563eb", lineWidth: 1, title: `${p.family === "CW" ? "EW" : "CW"} ${p.ccy}` } });
    if (data.other) out.push({ id: "o", type: "line", data: lineData(data.other.dates, data.other.level), options: { color: "#d97706", lineWidth: 1, lineStyle: 2, title: `${p.family} ${p.ccy === "USD" ? "LCL" : "USD"}` } });
    return out;
  }, [data, p.family, p.ccy]);

  const exportSeries = () => {
    const s = data.s;
    exportXlsx(`index_${selected.replace(/[|:]/g, "_")}`, [{
      name: "values", note: `${meta?.name} · base ${d.info.methodology.baseLevel} · methodology ${d.info.methodology.version} · historical caps ESTIMATED (constant shares)`,
      columns: [{ label: "Date", value: (i) => s.dates[i] }, { label: "Level", value: (i) => s.level[i] }, { label: "Daily return", value: (i) => (i ? s.level[i] / s.level[i - 1] - 1 : null) },
        { label: "Constituents", value: (i) => s.n[i] }, { label: "Stale constituents", value: (i) => s.nStale[i] }, ...(s.cap ? [{ label: "Market cap USD (est.)", value: (i) => s.cap[i] }] : [])],
      rows: s.dates.map((_, i) => i),
    }, { name: "constituents", columns: [{ label: "Symbol", value: (m) => m.sec?.symbol }, { label: "Name", value: (m) => m.sec?.name }, { label: "Sector", value: (m) => m.sector }, { label: "Cap", value: (m) => m.seg }, { label: "Cap USD", value: (m) => m.capUsd }, { label: "CW weight %", value: (m) => m.cw }, { label: "EW weight %", value: (m) => m.ew }], rows: members }]);
  };

  return (
    <div className="stack">
      <PageHead title="CW / EW index hierarchy" sub="Independent cap-weighted and equal-weighted families at every level: sector-by-cap, cap segment and overall country (local currency and USD), regions, market classifications and global (USD).">
        <Seg value={fam} options={[{ value: "", label: "All" }, "CW", "EW"]} onChange={setFam} />
        <Seg value={ccy} options={[{ value: "", label: "All" }, { value: "LCL", label: "Local" }, "USD"]} onChange={setCcy} />
        <Select label="Level" value={lvl} options={LEVELS.map((l) => ({ value: l, label: LEVEL_LABEL[l] }))} onChange={(v) => setLvl(v || "")} allowEmpty />
        <input placeholder="Filter by name…" value={qText} onChange={(e) => setQText(e.target.value)} />
      </PageHead>
      <div className="grid" style={{ gridTemplateColumns: "minmax(320px, 420px) minmax(0, 1fr)" }}>
        <div className="card tight">
          <DataTable compact pageSize={30} maxHeight={700} exportName="indices" rowKey={(r) => r.key} selectedId={selected} onRowClick={(r) => navigate("indices", { key: r.key })}
            columns={[{ key: "name", label: "Index", value: (r) => r.name }, { key: "level", label: "Lvl", value: (r) => r.level }, { key: "n", label: "N", num: true, value: (r) => r.nLast }]}
            rows={list} />
        </div>
        <div className="stack">
          {!meta ? <div className="empty">Index not found</div> : loading ? <Loading /> : !data?.s ? <div className="empty">This index's history could not be loaded just now (the database is busy while the nightly engine refreshes). Use Retry above, or try again in a minute.</div> : (
            <>
              <div className="card">
                <div className="row between">
                  <div><h2 style={{ margin: 0 }}>{meta.name}</h2>
                    <div className="small muted">{LEVEL_LABEL[meta.level]} · {meta.family === "CW" ? "cap-weighted" : "equal-weighted"} · {meta.ccy === "LCL" ? `local currency (${meta.currencyCode})` : "USD"} · base {d.info.methodology.baseLevel} on {meta.startDate} · {meta.nLast} constituents</div>
                    <div className="row" style={{ marginTop: 6 }}>
                      <Badge kind="a" title="No share-count history exists: historical market caps are latest shares x historical price">Caps estimated</Badge>
                      <Badge>Price return</Badge><Badge>Quarterly rebalance</Badge>
                      {d.regimes[selected] && <Badge kind="b">{d.regimes[selected].label}</Badge>}
                    </div>
                  </div>
                  <div className="row">
                    {[["1M", HBARS["1M"]], ["3M", HBARS["3M"]], ["12M", HBARS["12M"]]].map(([k, b]) => <div key={k} className="kpi"><div className="l">{k}</div><Pct v={changeOver(data.s, b)} /></div>)}
                    <div className="kpi"><div className="l">YTD</div><Pct v={changeYtd(data.s)} /></div>
                    <button className="btn sm" onClick={exportSeries}>Export Excel</button>
                  </div>
                </div>
              </div>
              <Tabs value={tab} onChange={setTab} tabs={[{ value: "chart", label: "Chart" }, { value: "const", label: `Constituents (${members.length})` }, { value: "prov", label: "Provenance" }]} />
              {tab === "chart" && <div className="card tight"><TvChart height={420} series={series} logScale={false} />
                <div className="small muted" style={{ padding: 6 }}>Green: this index · blue: its {p.family === "CW" ? "EW" : "CW"} pair · amber dashed: the same index in {p.ccy === "USD" ? "local currency" : "USD"}. The USD series is the local series' daily price relatives times the FX relatives from the same base date — never a level divided by spot FX.</div></div>}
              {tab === "const" && (meta.country ? <DataTable exportName="constituents" pageSize={40} rows={members} initialSort={{ key: "cw", dir: "desc" }}
                columns={[{ key: "sym", label: "Symbol", value: (m) => m.sec?.symbol, render: (m) => <StockLink sec={m.sec} /> }, { key: "name", label: "Name", value: (m) => m.sec?.name }, { key: "sector", label: "Sector", value: (m) => m.sector },
                  { key: "seg", label: "Cap", value: (m) => m.seg }, { key: "cap", label: "Cap at rebalance", num: true, value: (m) => m.capUsd, render: (m) => (m.sec?.country === "India" && m.sec.capLocal && m.sec.capUsdNow ? fmtInr(m.capUsd * m.sec.capLocal / m.sec.capUsdNow) : fmtMoney(m.capUsd)) },
                  { key: "cw", label: "CW weight %", num: true, value: (m) => m.cw, render: (m) => m.cw?.toFixed(3) }, { key: "ew", label: "EW weight %", num: true, value: (m) => m.ew, render: (m) => m.ew?.toFixed(3) }]}
                toolbar={<span className="small muted">Point-in-time members at the {data.mem?.date} rebalance.</span>} />
                : <div className="note">Cross-country indices are aggregated from their country cells; open a country index to see stock constituents.</div>)}
              {tab === "prov" && <div className="grid g2">
                <div className="card"><h3>Data provenance</h3>
                  <p className="small">Latest {data.s.dates.at(-1)}: {data.s.n.at(-1)} constituents, {data.s.nStale.at(-1)} without a trade that day (carried at their last close — a market holiday or a missing bar).</p>
                  <p className="small">Sessions with stale constituents: {data.s.nStale.filter((x) => x > 0).length} of {data.s.dates.length}.</p>
                  {data.fx && <p className="small">FX ({meta.currencyCode}): {data.fx.stale.filter((x) => x > 0 && x < 65535).length} carried-forward fixings; {data.fx.stale.filter((x) => x === 65535).length} estimated days. Quote: USD per 1 {meta.currencyCode}.</p>}
                  <p className="small">Methodology {d.info.methodology.version} · run {d.info.run.runId}</p>
                </div>
                <div className="card"><h3>Revisions to published values</h3>
                  {data.rev?.length ? <DataTable compact pageSize={15} rowKey={(r) => r.date + r.runId} rows={data.rev} exportName="revisions" columns={[{ key: "d", label: "Date", value: (r) => r.date }, { key: "o", label: "Old", num: true, value: (r) => r.oldLevel }, { key: "n", label: "New", num: true, value: (r) => r.newLevel }, { key: "r", label: "Run", value: (r) => r.runId }]} />
                    : <div className="small muted">No historical value of this index has ever been revised.</div>}
                </div>
              </div>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
