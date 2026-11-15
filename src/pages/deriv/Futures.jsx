// Futures & rollover: spot vs near / next / far, basis, carry, fair value,
// rollover, calendar spreads, the curve, continuous series, cash-futures
// arbitrage screening and settlement rules.
import { useMemo, useState } from "react";
import { PageHead, Kpi, Tabs, Select, Badge, Loading } from "../../components/ui.jsx";
import { DataTable } from "../../components/DataTable.jsx";
import { XYChart } from "../../components/XYChart.jsx";
import { TvChart, lineData } from "../../components/TvChart.jsx";
import { useAsync } from "../../lib/useAsync.js";
import { navigate, href } from "../../lib/router.js";
import { useDerivRows, DerivGate, UndSelect, DataNote, FP, fn, pc } from "./common.jsx";
import { futuresTable, rollover, rolloverHistory, continuousFutures, ROLL_METHODS, cashFuturesArb, settlementInfo, INDIA_COSTS } from "../../../engine/deriv/futures.js";

export default function Futures({ route }) {
  const { api, status, rows, loading, error } = useDerivRows();
  const und = route.query.und || rows?.find((r) => r.und === "NIFTY")?.und || rows?.[0]?.und;
  const [tab, setTab] = useState("contracts");
  const [r, setR] = useState(0.065);
  const [q, setQ] = useState(0);
  const day = useAsync(() => (und ? api.chain(und) : Promise.resolve(null)), [und]);
  const hist = useAsync(() => (und ? api.history(und) : Promise.resolve([])), [und]);
  const tbl = useMemo(() => (day.data ? futuresTable(day.data, { r, q }) : []), [day.data, r, q]);
  const ro = rollover(tbl);
  const rh = useMemo(() => rolloverHistory(hist.data || []), [hist.data]);
  return (
    <div className="stack">
      <PageHead title="Futures & rollover" sub="Basis, cost of carry, fair value, rollover and calendar spreads for index and stock futures." />
      <DerivGate status={status} loading={loading} error={error}>
        <div className="card row wrap" style={{ gap: 10 }}>
          <UndSelect rows={rows} value={und} onChange={(u) => navigate("dfut", { und: u })} />
          <label className="small muted">Risk-free <input type="number" step="0.25" value={(r * 100).toFixed(2)} onChange={(e) => setR((+e.target.value || 0) / 100)} style={{ width: 70 }} />%</label>
          <label className="small muted">Dividend yield for fair value <input type="number" step="0.1" value={(q * 100).toFixed(2)} onChange={(e) => setQ((+e.target.value || 0) / 100)} style={{ width: 70 }} />%</label>
        </div>
        <DataNote status={status} />
        <Tabs value={tab} onChange={setTab} tabs={[{ value: "contracts", label: "Contracts & basis" }, { value: "roll", label: "Rollover & spreads" }, { value: "cont", label: "Continuous futures" }, { value: "arb", label: "Cash-futures arbitrage screen" }]} />
        {day.loading && <Loading />}
        {tab === "contracts" && day.data && <Contracts day={day.data} tbl={tbl} hist={hist.data || []} r={r} />}
        {tab === "roll" && day.data && <Roll tbl={tbl} ro={ro} rh={rh} hist={hist.data || []} />}
        {tab === "cont" && <Continuous api={api} und={und} />}
        {tab === "arb" && <ArbScreen rows={rows} />}
      </DerivGate>
    </div>
  );
}

function Contracts({ day, tbl, hist, r }) {
  const near = tbl[0];
  const s = settlementInfo(day.kind, near?.expiry || day.date, day.date);
  const d = hist.map((h) => h.date);
  return (
    <div className="stack">
      <div className="kpis">
        <Kpi label="Spot" value={fn(day.spot)} sub={day.spotEstimated ? "estimated from the near future" : day.date} />
        {tbl.map((t) => <Kpi key={t.expiry} label={`${t.leg} ${t.expiry}`} value={fn(t.price)} sub={<span>basis <FP v={t.basisPct} d={2} /> · carry <FP v={t.carry} d={1} /></span>} />)}
      </div>
      <div className="card">
        <DataTable compact rows={tbl.map((t) => ({ ...t, id: t.expiry }))} exportName={`futures-${day.underlying}`} columns={[
          { key: "l", label: "Contract", value: (t) => `${t.leg} ${t.expiry}` }, { key: "d", label: "DTE", num: true, value: (t) => t.dte }, { key: "p", label: "Price", num: true, value: (t) => t.price, render: (t) => fn(t.price) },
          { key: "c", label: "1D", num: true, value: (t) => t.pxChg, render: (t) => <FP v={t.pxChg} d={2} /> }, { key: "b", label: "Basis (pts)", num: true, value: (t) => t.basis, render: (t) => fn(t.basis) },
          { key: "bp", label: "Basis %", num: true, value: (t) => t.basisPct, render: (t) => <FP v={t.basisPct} d={2} /> }, { key: "cy", label: "Annualised carry", num: true, value: (t) => t.carry, render: (t) => <FP v={t.carry} d={2} /> },
          { key: "dy", label: "Implied dividend yield", num: true, value: (t) => t.impliedDivYield, render: (t) => <FP v={t.impliedDivYield} d={2} /> },
          { key: "fv", label: "Fair value", num: true, value: (t) => t.fair, render: (t) => fn(t.fair) }, { key: "rc", label: "Rich (+) / cheap (−)", num: true, value: (t) => t.richCheap, render: (t) => fn(t.richCheap) },
          { key: "oi", label: "OI", num: true, value: (t) => t.oi, render: (t) => fn(t.oi, 0) }, { key: "co", label: "OI chg", num: true, value: (t) => t.chgOi, render: (t) => fn(t.chgOi, 0) }, { key: "v", label: "Volume", num: true, value: (t) => t.vol, render: (t) => fn(t.vol, 0) },
        ]} />
        <p className="legend-note">Carry = ln(F/S) ÷ T (continuous, annualised). Implied dividend yield = risk-free {(r * 100).toFixed(2)}% − carry. Fair value = S·e^((r − q)T).</p>
      </div>
      <div className="grid g2">
        <div className="card"><div className="h3">Futures curve</div><XYChart height={200} series={[{ name: "Futures", type: "line", color: "#2563eb", points: [{ x: 0, y: day.spot }, ...tbl.map((t) => ({ x: t.dte, y: t.price }))] }, { name: "Fair value", type: "line", color: "var(--muted)", dash: "4 3", points: [{ x: 0, y: day.spot }, ...tbl.map((t) => ({ x: t.dte, y: t.fair }))] }]} xLabel="days to expiry" /></div>
        <div className="card"><div className="h3">Historical near-month basis %</div><TvChart height={200} series={[{ id: "b", type: "line", data: lineData(d, hist.map((h) => (h.fut?.basisPct != null ? h.fut.basisPct * 100 : null))).filter((p) => p.value != null), options: { color: "#0891b2" } }]} /></div>
      </div>
      <div className="card">
        <div className="h3">Settlement and last trading day ({near?.expiry})</div>
        <div className="small">Last trading day: <b>{s.lastTradingDay}</b> ({s.dte} days) · {s.settlement} · Final settlement price: {s.finalPrice}.</div>
        {s.deliveryWindow && <div className="note warn small">{s.deliveryWindow}</div>}
      </div>
    </div>
  );
}

function Roll({ tbl, ro, rh, hist }) {
  if (!ro) return <div className="empty">Only one futures contract is live.</div>;
  const d = hist.map((h) => h.date);
  const alerts = [];
  const sp = hist.map((h) => h.rollSpreadPct).filter((x) => x != null);
  if (sp.length > 20) { const m = sp.reduce((a, x) => a + x, 0) / sp.length, sd = Math.sqrt(sp.reduce((a, x) => a + (x - m) ** 2, 0) / sp.length); if (sd > 0 && Math.abs(ro.spreadPct - m) / sd > 2) alerts.push(`Calendar spread ${ro.spreadPct > m ? "widened" : "narrowed"} to ${((ro.spreadPct - m) / sd).toFixed(1)} sd from its average`); }
  return (
    <div className="stack">
      <div className="kpis">
        <Kpi label="Rollover now" value={pc(ro.pct)} sub={`${ro.nearDte} days to near expiry`} />
        <Kpi label="3-cycle average" value={pc(rh.avg3)} sub="at the last session before expiry" />
        <Kpi label="6-cycle average" value={pc(rh.avg6)} />
        <Kpi label="Roll cost" value={`${fn(ro.spread)} pts`} sub={<span><FP v={ro.spreadPct} d={2} /> · annualised <FP v={ro.annualised} d={1} /></span>} />
      </div>
      {alerts.map((a) => <div key={a} className="note warn small">{a}</div>)}
      <div className="grid g2">
        <div className="card"><div className="h3">Rollover % by session</div><TvChart height={220} series={[{ id: "r", type: "line", data: lineData(d, hist.map((h) => (h.rolloverPct != null ? h.rolloverPct * 100 : null))).filter((p) => p.value != null), options: { color: "#16a34a" } }]} /></div>
        <div className="card"><div className="h3">Calendar spread % (next − near)</div><TvChart height={220} series={[{ id: "s", type: "line", data: lineData(d, hist.map((h) => (h.rollSpreadPct != null ? h.rollSpreadPct * 100 : null))).filter((p) => p.value != null), options: { color: "#d97706" } }]} /></div>
      </div>
      <div className="card">
        <div className="h3">Roll calendar: past expiry cycles</div>
        <DataTable compact rows={rh.cycles.map((c) => ({ ...c, id: c.nearExpiry }))} exportName="roll-history" columns={[{ key: "e", label: "Expiry", value: (c) => c.nearExpiry }, { key: "d", label: "Measured on", value: (c) => c.date }, { key: "dte", label: "DTE then", num: true, value: (c) => c.nearDte }, { key: "r", label: "Rollover", num: true, value: (c) => c.rolloverPct, render: (c) => pc(c.rolloverPct) }]} />
        <p className="legend-note">Expiry-to-expiry comparison uses the last stored session before each expiry. Contracts in the curve: {tbl.map((t) => t.expiry).join(", ")}.</p>
      </div>
    </div>
  );
}

function Continuous({ api, und }) {
  const [method, setMethod] = useState("backRatio");
  const hist = useAsync(() => api.history(und), [und]);
  const days = useMemo(() => (hist.data ? hist.data.filter((h) => h.fut).map((h) => ({ date: h.date, near: { expiry: h.fut.expiry, price: h.fut.price, oi: h.fut.oi }, next: h.fut2 ? { expiry: h.fut2.expiry, price: h.fut2.price, oi: h.fut2.oi } : null })) : null), [hist.data]);
  const cf = useMemo(() => (days ? continuousFutures(days, method) : null), [days, method]);
  return (
    <div className="card">
      <Select value={method} onChange={setMethod} options={Object.entries(ROLL_METHODS).map(([value, label]) => ({ value, label }))} label="Roll method" />
      {!cf ? <Loading what="stored sessions" /> : (
        <>
          <TvChart height={300} series={[{ id: "c", type: "line", data: cf.points.map((p) => ({ time: p.date, value: p.adj })), options: { color: "#2563eb", lineWidth: 2 } }]} />
          <div className="small muted">{cf.points.length} stored sessions; rolls: {cf.rolls.map((r) => `${r.date} (${r.from} → ${r.to}, gap ${fn(r.gap)})`).join("; ") || "none in this window"}.</div>
        </>
      )}
    </div>
  );
}

function ArbScreen({ rows }) {
  const [funding, setFunding] = useState(0.065);
  const stocks = (rows || []).filter((r) => r.kind === "stock" && r.s.fut);
  const data = stocks.map((r) => {
    const row = { price: r.s.fut.price, dte: r.s.nearDte };
    const a = cashFuturesArb(row, r.s.spot, r.s.lot, { funding });
    return a ? { id: r.und, und: r.und, spot: r.s.spot, fut: r.s.fut.price, dte: r.s.nearDte, basisPct: r.s.fut.basisPct, ...a } : null;
  }).filter(Boolean);
  return (
    <div className="card">
      <label className="small muted">Funding rate <input type="number" step="0.25" value={(funding * 100).toFixed(2)} onChange={(e) => setFunding((+e.target.value || 0) / 100)} style={{ width: 70 }} />%</label>
      <DataTable rows={data} exportName="cash-futures-arb" initialSort={{ key: "ex", dir: "desc" }} columns={[
        { key: "u", label: "Stock", value: (x) => x.und, render: (x) => <a href={href("dfut", { und: x.und })}>{x.und}</a> }, { key: "s", label: "Spot", num: true, value: (x) => x.spot, render: (x) => fn(x.spot) },
        { key: "f", label: "Near future", num: true, value: (x) => x.fut, render: (x) => fn(x.fut) }, { key: "d", label: "DTE", num: true, value: (x) => x.dte },
        { key: "b", label: "Basis", num: true, value: (x) => x.basisPct, render: (x) => <FP v={x.basisPct} d={2} /> },
        { key: "n", label: "Net yield (annualised)", num: true, value: (x) => x.netAnnual, render: (x) => <FP v={x.netAnnual} d={1} /> },
        { key: "ex", label: "Over funding", num: true, value: (x) => x.excessOverFunding, render: (x) => <span>{x.excessOverFunding > 0 ? <Badge kind="g">positive</Badge> : null} <FP v={x.excessOverFunding} d={1} /></span> },
        { key: "c", label: "Round-trip costs (1 lot)", num: true, value: (x) => x.costs, render: (x) => fn(x.costs, 0) },
      ]} />
      <p className="legend-note">Buy one lot of shares and sell one lot of the near future, held to expiry. Costs include STT, exchange charges, SEBI fee, stamp duty and GST at the rates as of {INDIA_COSTS.asOf} plus ₹{INDIA_COSTS.brokeragePerOrder} brokerage per order. End-of-day prices are not simultaneous quotes and dividends are ignored: a screen, not an executable quote.</p>
    </div>
  );
}
