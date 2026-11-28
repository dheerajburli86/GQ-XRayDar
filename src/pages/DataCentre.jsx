// Data centre: security master, data health, calculation audit trail, FX,
// corporate actions, methodology, integrations and the requirement trace.
import { useMemo, useState } from "react";
import { SERVER_ON } from "../lib/server.js";
import { useData } from "../data/store.jsx";
import { useAsync } from "../lib/useAsync.js";
import { PageHead, Tabs, Badge, Select, Loading } from "../components/ui.jsx";
import { DataTable } from "../components/DataTable.jsx";
import { TvChart, lineData } from "../components/TvChart.jsx";
import { fmtCapOf } from "../lib/format.js";
import { REQUIREMENTS, STATUS_LABEL } from "../requirements.js";
import { Capabilities, Access, AuditLog, Operations } from "./DataCentreOps.jsx";

export default function DataCentre({ route }) {
  const [tab, setTab] = useState(route.query.tab || "overview");
  return (
    <div className="stack">
      <PageHead title="Data centre" sub="Where every number comes from, how it was computed, and what is wrong with the inputs." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "overview", label: "Overview" }, { value: "master", label: "Security master" }, { value: "health", label: "Data health" }, { value: "audit", label: "Calculation audit" }, { value: "fx", label: "FX" }, { value: "ca", label: "Corporate actions" }, { value: "method", label: "Methodology" }, { value: "integrations", label: "Integrations" }, { value: "caps", label: "Exchange capabilities" }, { value: "access", label: "Access & API" }, { value: "auditlog", label: "Audit log" }, { value: "ops", label: "Operations" }, { value: "trace", label: "Requirement trace" }]} />
      {tab === "overview" && <Overview />}
      {tab === "master" && <Master />}
      {tab === "health" && <Health />}
      {tab === "audit" && <Audit />}
      {tab === "fx" && <Fx />}
      {tab === "ca" && <Ca />}
      {tab === "method" && <Method />}
      {tab === "integrations" && <Integrations />}
      {tab === "caps" && <Capabilities />}
      {tab === "access" && <Access />}
      {tab === "auditlog" && <AuditLog />}
      {tab === "ops" && <Operations />}
      {tab === "trace" && <Trace />}
    </div>
  );
}

function Overview() {
  const d = useData();
  const r = d.info.run;
  const st = r.stats || {};
  return (
    <div className="grid g2">
      <div className="card"><h3>Latest calculation run</h3>
        <table className="tbl"><tbody>
          {[["Data source", d.mode === "demo" ? "Synthetic demo universe (in-browser)" : "Heatmap dashboard Supabase"], ["Run", r.runId], ["Started", r.started], ["Finished", r.finished], ["Status", r.status],
            ["Methodology", `${r.methodologyVersion} (hash ${r.methodologyHash})`], ["Calendar", st.dates ? `${st.dates.from} → ${st.dates.to}, ${st.dates.sessions} sessions, ${st.dates.rebalances} rebalances` : "—"],
            ["Securities", st.securities], ["In an index (any period)", st.indexedSecurities], ["Countries", st.countries], ["Excluded at rebalances", st.excluded ? Object.entries(st.excluded).map(([k, v]) => `${k} ${v}`).join(", ") : "—"]].map(([k, v]) => <tr key={k}><td className="muted">{k}</td><td>{String(v ?? "—")}</td></tr>)}
        </tbody></table></div>
      <div className="card"><h3>Actual vs estimated data</h3>
        <div className="stack small" style={{ gap: 6 }}>
          <div><Badge kind="g">Observed</Badge> Daily OHLCV from the heatmap's price_history (split adjustments applied from tas_corporate_action).</div>
          <div><Badge kind="a">Estimated</Badge> Historical market caps: latest share count (cap ÷ latest close) held constant. Every CW index, WW weight and cap segment carries this label until a share-count history exists.</div>
          <div><Badge kind="a">Carried forward</Badge> FX fixings missing on a date use the previous rate and are counted as stale; a currency with no history at all uses a constant latest rate and is flagged estimated.</div>
          <div><Badge kind="a">Stale constituent</Badge> A constituent that did not trade on a date (holiday, missing bar) is carried at its last close; the count is stored per index per day.</div>
          {d.mode === "demo" && <div><Badge kind="r">Synthetic</Badge> Everything you see in demo mode is generated; nothing is written anywhere.</div>}
        </div></div>
    </div>
  );
}

function Master() {
  const d = useData();
  const [country, setCountry] = useState(null);
  const rows = useMemo(() => d.secs.filter((s) => !country || s.country === country), [d.secs, country]);
  return <DataTable exportName="security_master" rows={rows} toolbar={<Select label="Country" value={country} options={d.countries} onChange={setCountry} allowEmpty />}
    columns={[["symbol", "Symbol"], ["name", "Name"], ["universe", "Universe"], ["exchange", "Exchange"], ["isin", "ISIN"], ["country", "Country"], ["region", "Region"], ["classification", "Class"], ["currency", "Quote ccy"], ["sector", "GICS sector"], ["industryGroup", "Industry group"], ["industry", "Raw industry"], ["classSource", "Class. evidence"], ["capSegment", "Cap segment"]].map(([k, l]) => ({ key: k, label: l, value: (s) => s[k] }))
      .concat([{ key: "cap", label: "Market cap (est.)", num: true, value: (s) => s.capUsdNow, render: (s) => fmtCapOf(s) }, { key: "active", label: "Active", value: (s) => s.active }])} />;
}

function Health() {
  const d = useData();
  const { data, loading } = useAsync(() => d.api.issues(), []);
  const [sev, setSev] = useState(null), [rule, setRule] = useState(null);
  const rules = useMemo(() => [...new Set((data || []).map((x) => x.rule))].sort(), [data]);
  const rows = (data || []).filter((x) => (!sev || x.severity === sev) && (!rule || x.rule === rule)).map((x, i) => ({ ...x, rid: i }));
  const counts = useMemo(() => { const c = {}; for (const x of data || []) c[x.rule] = (c[x.rule] || 0) + 1; return c; }, [data]);
  if (loading) return <Loading />;
  return (
    <div className="stack">
      <div className="row">{Object.entries(counts).map(([k, v]) => <Badge key={k} kind={/split|error/.test(k) ? "r" : "a"}>{k.replace(/_/g, " ")}: {v}</Badge>)}</div>
      <DataTable exportName="data_issues" rows={rows} rowKey={(x) => x.rid} toolbar={<><Select label="Severity" value={sev} options={["error", "warn", "info"]} onChange={setSev} allowEmpty /><Select label="Rule" value={rule} options={rules} onChange={setRule} allowEmpty /></>}
        columns={[{ key: "sev", label: "Severity", value: (x) => x.severity, render: (x) => <Badge kind={x.severity === "error" ? "r" : x.severity === "warn" ? "a" : ""}>{x.severity}</Badge> }, { key: "rule", label: "Rule", value: (x) => x.rule },
          { key: "sym", label: "Instrument", value: (x) => x.symbol, render: (x) => (x.id ? <a href={`#/stock/${x.id}`}>{x.symbol}</a> : x.symbol || "—") }, { key: "c", label: "Country", value: (x) => x.country }, { key: "det", label: "Detail", value: (x) => x.detail, render: (x) => <span style={{ whiteSpace: "normal" }}>{x.detail}</span> }]} />
    </div>
  );
}

function Audit() {
  const d = useData();
  const { data, loading } = useAsync(() => d.api.revisions(), []);
  return (
    <div className="stack">
      <div className="card"><h3>Calculation runs</h3>
        <DataTable compact exportName="runs" rowKey={(r) => r.runId} rows={d.info.runs || []} columns={[{ key: "id", label: "Run", value: (r) => r.runId }, { key: "s", label: "Started", value: (r) => r.started }, { key: "f", label: "Finished", value: (r) => r.finished }, { key: "st", label: "Status", value: (r) => r.status, render: (r) => <Badge kind={r.status === "ok" ? "g" : r.status === "failed" ? "r" : "a"}>{r.status}</Badge> }, { key: "m", label: "Methodology", value: (r) => `${r.methodologyVersion} · ${r.methodologyHash}` }, { key: "w", label: "Writes", value: (r) => (r.stats?.writes ? JSON.stringify(r.stats.writes) : "—") }, { key: "e", label: "Error", value: (r) => r.error }]} /></div>
      <div className="card"><h3>Revisions to previously published index values</h3>
        {loading ? <Loading /> : <DataTable compact exportName="revisions" rowKey={(r) => r.indexKey + r.date + r.runId} rows={data || []} columns={[{ key: "k", label: "Index", value: (r) => r.indexKey }, { key: "d", label: "Date", value: (r) => r.date }, { key: "o", label: "Old", num: true, value: (r) => r.oldLevel }, { key: "n", label: "New", num: true, value: (r) => r.newLevel }, { key: "r", label: "Run", value: (r) => r.runId }, { key: "t", label: "Logged", value: (r) => r.revisedAt }]} />}
        <div className="small muted">A rebuild (methodology change, classification correction, late data) never silently overwrites history: every changed level is logged here before the stored year is replaced.</div></div>
    </div>
  );
}

function Fx() {
  const d = useData();
  const { data, loading } = useAsync(() => d.api.fxSummary(), []);
  const [ccy, setCcy] = useState(null);
  const { data: series } = useAsync(() => (ccy ? d.api.fxSeries(ccy) : null), [ccy]);
  if (loading) return <Loading />;
  return (
    <div className="grid" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)" }}>
      <DataTable exportName="fx" rowKey={(r) => r.currency} rows={data || []} onRowClick={(r) => setCcy(r.currency)} selectedId={ccy}
        columns={[{ key: "c", label: "Currency", value: (r) => r.currency }, { key: "s", label: "Source", value: (r) => r.source }, { key: "l", label: "USD per unit", num: true, value: (r) => r.latest },
          { key: "e", label: "Estimated", value: (r) => r.estimated, render: (r) => (r.estimated ? <Badge kind="a">estimated</Badge> : <Badge kind="g">history</Badge>) },
          { key: "st", label: "Stale days", num: true, value: (r) => r.staleDays }, { key: "mx", label: "Longest gap", num: true, value: (r) => r.maxStale }]} />
      <div className="card tight">{series ? <><div className="small muted" style={{ padding: 4 }}>{ccy}: USD per 1 {ccy}, as used by the index engine</div><TvChart height={300} series={[{ type: "line", data: lineData(series.dates, series.rate), options: { color: "#14a44d", lineWidth: 2 } }]} /></> : <div className="empty">Select a currency</div>}</div>
    </div>
  );
}

function Ca() {
  const d = useData();
  const { data, loading } = useAsync(() => d.api.corporateActions(), []);
  if (loading) return <Loading />;
  return (
    <div className="stack">
      <div className="note">Corporate actions in tas_corporate_action are applied to price history before any calculation (prices before the ex-date ÷ factor, volumes × factor). Candidates the data-health check flags as "possible split" should be confirmed against the exchange record and added here; the next engine run then restates history and logs the revisions.</div>
      <DataTable exportName="corporate_actions" rows={(data || []).map((x, i) => ({ ...x, rid: i }))} rowKey={(x) => x.rid}
        columns={[{ key: "s", label: "Instrument", value: (x) => d.secById.get(x.instrumentId)?.symbol || x.instrumentId, render: (x) => <a href={`#/stock/${x.instrumentId}`}>{d.secById.get(x.instrumentId)?.symbol || x.instrumentId}</a> }, { key: "d", label: "Ex-date", value: (x) => x.exDate }, { key: "f", label: "Factor", num: true, value: (x) => x.factor }, { key: "t", label: "Type", value: (x) => x.type }, { key: "src", label: "Source", value: (x) => x.source }]} />
    </div>
  );
}

function Method() {
  const d = useData();
  const m = d.info.methodology;
  return (
    <div className="grid g2">
      <div className="card"><h3>Methodology in force ({m.version})</h3><pre className="mono small" style={{ whiteSpace: "pre-wrap", margin: 0 }}>{JSON.stringify(m, null, 2)}</pre></div>
      <div className="card"><h3>Decisions to confirm [C]</h3>
        <ul className="small" style={{ paddingLeft: 18 }}>
          <li>GLOCOM / LOCOM: the owner's rule sheet (engine/glocom.js); a stock's GLOCOM is the heatmap's glocom_latest where present. IMB / ETI characteristics come from the ETI project.</li>
          <li>Index base: {m.baseLevel} at the first quarter-end; price return (total return needs a dividend feed).</li>
          <li>CW: full market cap with constant latest share counts (estimated) — free-float and share-count history need a data source.</li>
          <li>Cap breakpoints: Large to {m.capBreakpoints.large * 100}% of cumulative country cap, Mid to {m.capBreakpoints.mid * 100}%, Small to {m.capBreakpoints.small * 100}%; the rest is micro and excluded from CW and EW alike.</li>
          <li>EW: quarterly rebalance; drift between rebalances; delisted constituents reinvested within their cell; new listings wait for the next rebalance.</li>
          <li>Regions: Canada in "Other Americas"; Israel and Middle East in Asia; Australia / NZ in Asia. Classification follows a standard DM / EM split.</li>
          <li>RSI method: "{m.indicators.rsiMethod}" (ewm 1/n seeded on the first change, identical to the heatmap). RSI of RSI applies the same RSI to the RSI series; EMA warm-up hidden for the first N candles.</li>
          <li>RSC: price ratio rebased to {m.indicators.rscRebase} at the first common candle; compared in USD when the currencies differ.</li>
          <li>Rotation: GQ formula (RS-Ratio = RSC / {m.rotation.smaWeeks}-week SMA; RS-Mom over {m.rotation.momentumWeeks} weeks).</li>
          <li>Timeframes: candle interval (D/W/M/Q/Y) is distinct from trailing horizon (1W/1M/3M/6M/12M = 5/21/63/126/252 sessions); "Q" is a calendar quarter candle, "3M" a 63-session look-back.</li>
        </ul></div>
    </div>
  );
}

function Integrations() {
  const d = useData();
  const glocomCount = d.rows.filter((r) => r.flat.glocom != null).length;
  const items = [
    ["Heatmap dashboard (Supabase)", d.mode === "supabase" ? "connected" : "demo mode", "Market data (instruments, price_history, fundamentals, fx_rates, glocom_latest) is read from the heatmap database; computed results live in this app's own tas_* tables. Nothing in the heatmap is written."],
    ["GLOCOM", glocomCount ? `${glocomCount} stocks carry GLOCOM` : "not available", "Read as computed by the heatmap (glocom_latest). Integrated as a heatmap colour, screen field and stock-page item. The formula is not re-implemented here by design."],
    ["LOCOM", "live", "Same rule sheet as GLOCOM (engine/glocom.js). Called LOCOM when Indian industries and sectors are rated against each other."],
    ["IMB framework", "awaiting definition", "Inputs/outputs to be connected to scores and screens; no formula is invented."],
    ["Finxray feed", "not connected", "Needs the endpoint, credentials, permitted use and instrument mapping. The catalyst component of the AI score is excluded (weight re-spread) until it exists."],
    ["TA server", SERVER_ON ? "connected" : "not configured", "Login check, alerts on Telegram, morning / weekly summaries, tasks, account sync and the agent panel (VITE_TA_SERVER_URL; docs/DEPLOY.md)."],
    ["Telegram / GQ agent", SERVER_ON ? "via the TA server" : "needs the TA server", "The GQ agent bot gets ta_* tools (analyse, chart read, screens, market, alerts, watchlists, tasks) and /ta link; the server sends alerts with the same bot."],
    ["Historical FX", "tas_fx_history", "Loaded by cli/fx-backfill.mjs from FMP (USD per unit; inverted pairs recorded)."],
  ];
  return (
    <div className="grid g2">{items.map(([t, s, x]) => <div key={t} className="card"><div className="row between"><b>{t}</b><Badge kind={/connected|tas_|carry|via/.test(s) && !/not/.test(s) ? "g" : /demo|planned|needs/.test(s) ? "b" : "a"}>{s}</Badge></div><div className="small muted" style={{ marginTop: 4 }}>{x}</div></div>)}</div>
  );
}

function Trace() {
  const [st, setSt] = useState(null);
  const rows = REQUIREMENTS.filter((r) => !st || r.status === st);
  const counts = REQUIREMENTS.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] || 0) + 1 }), {});
  return (
    <div className="stack">
      <div className="row">{Object.entries(counts).map(([k, v]) => <Badge key={k} kind={k === "done" ? "g" : k === "partial" ? "a" : k === "config" ? "b" : "r"}>{STATUS_LABEL[k]}: {v}</Badge>)}<Select label="Show" value={st} options={Object.keys(STATUS_LABEL).map((k) => ({ value: k, label: STATUS_LABEL[k] }))} onChange={setSt} allowEmpty /></div>
      <DataTable exportName="requirement_trace" pageSize={120} rows={rows}
        columns={[{ key: "id", label: "#", num: true, value: (r) => r.id }, { key: "tag", label: "Tag", value: (r) => r.tag }, { key: "t", label: "Requirement", value: (r) => r.title },
          { key: "s", label: "Status", value: (r) => r.status, render: (r) => <Badge kind={r.status === "done" ? "g" : r.status === "partial" ? "a" : r.status === "config" ? "b" : "r"}>{STATUS_LABEL[r.status]}</Badge> },
          { key: "w", label: "Where / notes", value: (r) => r.where, render: (r) => <span style={{ whiteSpace: "normal" }}>{r.where}</span> }]} />
    </div>
  );
}
