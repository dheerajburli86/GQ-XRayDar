// Option chain workstation: chain with IV / Greeks, OI profile, multi-expiry
// comparison, Greeks & dealer gamma, parity diagnostics, flow and the
// session "time machine" (any stored session can be replayed).
import { useEffect, useMemo, useState } from "react";
import { PageHead, Seg, Select, Kpi, Tabs, Badge, Loading, Check } from "../../components/ui.jsx";
import { DataTable } from "../../components/DataTable.jsx";
import { XYChart } from "../../components/XYChart.jsx";
import { TvChart, lineData } from "../../components/TvChart.jsx";
import { useAsync } from "../../lib/useAsync.js";
import { navigate } from "../../lib/router.js";
import { downloadBlob, exportXlsx } from "../../lib/exporters.js";
import { useDerivRows, DerivGate, UndSelect, DataNote, FP, fp, fn, fiv, pc } from "./common.jsx";
import { QUOTE_FLAGS, chainQuality, enrichChain, pcr, pcrOverall, maxPain, oiWalls, atmIv, expectedMove, gex, gexProfile, parity, termStructure, moneyness, DERIV_DEFAULTS } from "../../../engine/deriv/chain.js";
import { optionFlow } from "../../../engine/deriv/positioning.js";
import { MODEL_INFO } from "../../../engine/deriv/pricing.js";

const HEAT = [{ value: "oi", label: "OI" }, { value: "chgOi", label: "OI chg" }, { value: "vol", label: "Volume" }, { value: "iv", label: "IV" }, { value: "gamma", label: "Gamma" }, { value: "chgPx", label: "Premium chg" }];
const SEVERE = new Set(["dead", "below_intrinsic", "iv_fail", "locked"]);
const qFlag = (l) => (l?.q?.length ? l.q.map((f) => QUOTE_FLAGS[f]).join("; ") : "");
const ivCell = (l) => <span title={qFlag(l)} className={l?.q?.some((f) => SEVERE.has(f)) ? "muted" : ""}>{fiv(l?.iv)}{l?.q?.some((f) => SEVERE.has(f)) ? "†" : l?.q?.includes("no_trade") ? "*" : ""}</span>;
const heatVal = (leg, k) => (!leg ? null : k === "gamma" ? leg.g?.gamma ?? null : k === "iv" ? leg.iv : leg[k]);

export default function OptionChain({ route }) {
  const { api, status, rows, loading, error } = useDerivRows();
  const und = route.query.und || rows?.find((r) => r.und === "NIFTY")?.und || rows?.[0]?.und;
  const [date, setDate] = useState(route.query.date || "");
  const dates = useAsync(() => (und ? api.chainDates(und) : Promise.resolve([])), [und]);
  const sel = date && dates.data?.includes(date) ? date : dates.data?.at(-1);
  const prevDate = dates.data && sel ? dates.data[dates.data.indexOf(sel) - 1] : null;
  const cur = useAsync(() => (und && sel ? api.chain(und, sel) : Promise.resolve(null)), [und, sel]);
  const prev = useAsync(() => (und && prevDate ? api.chain(und, prevDate) : Promise.resolve(null)), [und, prevDate]);
  const [r, setR] = useState(DERIV_DEFAULTS.riskFree);
  const chain = useMemo(() => (cur.data ? enrichChain(cur.data, { riskFree: r }) : null), [cur.data, r]);
  const prevChain = useMemo(() => (prev.data ? enrichChain(prev.data, { riskFree: r }) : null), [prev.data, r]);
  const [exp, setExp] = useState("");
  useEffect(() => { setExp(""); }, [und, sel]);
  const ex = chain?.expiries.find((e) => e.expiry === exp) || chain?.expiries.find((e) => e.rows.length >= 3) || chain?.expiries[0];
  const [tab, setTab] = useState("chain");

  return (
    <div className="stack">
      <PageHead title="Option chain" sub="Every listed strike and expiry with implied volatility, Greeks, open interest and positioning. Pick any stored session to replay it." />
      <DerivGate status={status} loading={loading} error={error}>
        <div className="card row wrap" style={{ gap: 10 }}>
          <UndSelect rows={rows} value={und} onChange={(u) => navigate("dchain", { und: u })} />
          <Select value={sel || ""} options={(dates.data || []).slice().reverse().map((d) => ({ value: d, label: d }))} onChange={setDate} label="Session" />
          {chain && <Select value={ex?.expiry || ""} options={chain.expiries.map((e) => ({ value: e.expiry, label: `${e.expiry} (${e.dte}d)` }))} onChange={setExp} label="Expiry" />}
          <label className="small muted">Risk-free <input type="number" step="0.25" value={(r * 100).toFixed(2)} onChange={(e) => setR((+e.target.value || 0) / 100)} style={{ width: 70 }} />%</label>
          <div className="grow" />
          {chain && <button className="btn sm" onClick={() => downloadBlob(new Blob([JSON.stringify(cur.data, null, 1)], { type: "application/json" }), `${und}-${sel}-chain.json`)}>JSON</button>}
        </div>
        <DataNote status={status} />
        {(cur.loading || dates.loading) && <Loading what="chain" />}
        {chain && ex && (
          <>
            <Header chain={chain} ex={ex} prevChain={prevChain} />
            <Tabs value={tab} onChange={setTab} tabs={[{ value: "chain", label: "Chain" }, { value: "oi", label: "OI profile" }, { value: "multi", label: "Multi-expiry" }, { value: "greeks", label: "Greeks & dealer gamma" }, { value: "parity", label: "Synthetic futures & parity" }, { value: "flow", label: "Writing / buying" }, { value: "hist", label: "History" }]} />
            {tab === "chain" && <ChainTable chain={chain} ex={ex} und={und} date={sel} />}
            {tab === "oi" && <OiProfile chain={chain} ex={ex} prevChain={prevChain} />}
            {tab === "multi" && <MultiExpiry chain={chain} />}
            {tab === "greeks" && <GreeksTab chain={chain} ex={ex} r={r} />}
            {tab === "parity" && <ParityTab chain={chain} ex={ex} r={r} />}
            {tab === "flow" && <FlowTab ex={ex} prevChain={prevChain} />}
            {tab === "hist" && <HistoryTab api={api} und={und} />}
          </>
        )}
      </DerivGate>
    </div>
  );
}

function Header({ chain, ex, prevChain }) {
  const p = pcr(ex), all = pcrOverall(chain), mp = maxPain(ex), w = oiWalls(ex, chain.spot), em = expectedMove(ex, chain.spot);
  const pex = prevChain?.expiries.find((e) => e.expiry === ex.expiry);
  const pw = pex ? oiWalls(pex, prevChain.spot) : null;
  const moved = [];
  if (pw?.resistance[0] && w.resistance[0] && pw.resistance[0].strike !== w.resistance[0].strike) moved.push(`Call wall moved ${pw.resistance[0].strike} → ${w.resistance[0].strike}`);
  if (pw?.support[0] && w.support[0] && pw.support[0].strike !== w.support[0].strike) moved.push(`Put wall moved ${pw.support[0].strike} → ${w.support[0].strike}`);
  if (w.callConcentration.topShare > 0.25) moved.push(`Call OI concentrated: ${pc(w.callConcentration.topShare)} at one strike`);
  if (w.putConcentration.topShare > 0.25) moved.push(`Put OI concentrated: ${pc(w.putConcentration.topShare)} at one strike`);
  return (
    <div className="card">
      <div className="kpis" style={{ border: 0, padding: 0 }}>
        <Kpi label="Spot" value={fn(chain.spot)} sub={chain.kind} />
        <Kpi label={`Forward (${ex.dte}d)`} value={fn(ex.F)} sub={ex.fSource} />
        <Kpi label="PCR OI · expiry / all" value={`${p.oi?.toFixed(2) ?? "—"} / ${all.oi?.toFixed(2) ?? "—"}`} sub={`volume ${p.vol?.toFixed(2) ?? "—"} / ${all.vol?.toFixed(2) ?? "—"}`} />
        <Kpi label="ATM IV" value={fiv(atmIv(ex))} sub={`straddle ${fn(em.straddle)}`} />
        <Kpi label="Expected move" value={`±${pc(em.straddlePct, 1)}`} sub={em.sd1 ? `1sd ${fn(em.range1[0], 0)}–${fn(em.range1[1], 0)}` : ""} />
        <Kpi label="Max pain" value={mp.strike ?? "—"} sub={mp.strike ? fp(mp.strike / chain.spot - 1) : ""} />
        <Kpi label="Call wall / put wall" value={`${w.resistance[0]?.strike ?? "—"} / ${w.support[0]?.strike ?? "—"}`} sub={`HHI ${w.callConcentration.hhi?.toFixed(3) ?? "—"} / ${w.putConcentration.hhi?.toFixed(3) ?? "—"}`} />
        <Kpi label="Lot" value={chain.lot ?? "—"} sub={chain.date} />
      </div>
      {moved.length > 0 && <div className="row wrap" style={{ marginTop: 8 }}>{moved.map((m) => <Badge key={m} kind="a">{m}</Badge>)}</div>}
    </div>
  );
}

function ChainTable({ chain, ex, und, date }) {
  const [range, setRange] = useState(12);
  const [ref, setRef] = useState("spot");
  const [heat, setHeat] = useState("oi");
  const [greeks, setGreeks] = useState(false);
  const refPx = ref === "spot" ? chain.spot : ex.F;
  const atmK = ex.rows.reduce((b, x) => (Math.abs(x.strike - refPx) < Math.abs(b - refPx) ? x.strike : b), ex.rows[0]?.strike);
  const ai = ex.rows.findIndex((x) => x.strike === atmK);
  const shown = range >= 999 ? ex.rows : ex.rows.slice(Math.max(0, ai - range), ai + range + 1);
  const max = { ce: Math.max(1e-12, ...shown.map((x) => Math.abs(heatVal(x.ce, heat) || 0))), pe: Math.max(1e-12, ...shown.map((x) => Math.abs(heatVal(x.pe, heat) || 0))) };
  const cell = (leg, side, k, render) => {
    const v = leg?.[k];
    const hv = heatVal(leg, heat), w = hv != null ? Math.min(100, (Math.abs(hv) / max[side]) * 100) : 0;
    const col = heat === "chgOi" || heat === "chgPx" ? (hv >= 0 ? "#16a34a" : "#dc2626") : side === "ce" ? "#16a34a" : "#dc2626";
    return k === "oi" ? <td className="num cell-bar"><i style={{ [side === "ce" ? "right" : "left"]: 0, width: `${w}%`, background: col }} /><span>{fn(v, 0)}</span></td> : <td className="num">{render ? render(leg) : fn(v)}</td>;
  };
  const flat = ex.rows.flatMap((x) => [x.ce, x.pe].filter(Boolean).map((l) => ({ id: `${x.strike}${l.cp}`, strike: x.strike, type: l.cp > 0 ? "CE" : "PE", ...l })));
  const exportFlat = () => exportXlsx(`${und}-${date}-${ex.expiry}`, [{ name: "chain", columns: ["strike", "type", "px", "settle", "chgPx", "oi", "chgOi", "vol", "iv"].map((k) => ({ label: k, value: (r) => r[k] })).concat([{ label: "quality", value: (r) => (r.q || []).join(" ") }]).concat(["delta", "gamma", "theta", "vega"].map((k) => ({ label: k, value: (r) => r.g?.[k] }))), rows: flat }]);
  return (
    <div className="card">
      <div className="row wrap" style={{ gap: 10, marginBottom: 8 }}>
        <Seg value={range} onChange={setRange} options={[{ value: 6, label: "±6" }, { value: 12, label: "±12" }, { value: 25, label: "±25" }, { value: 999, label: "All" }]} title="Strikes around ATM" />
        <Seg value={ref} onChange={setRef} options={[{ value: "spot", label: "ATM by spot" }, { value: "fwd", label: "ATM by forward" }]} />
        <span className="small muted">Heat:</span><Seg value={heat} onChange={setHeat} options={HEAT} />
        <Check checked={greeks} onChange={setGreeks}>Greeks</Check>
        <div className="grow" /><button className="btn sm" onClick={exportFlat}>Excel</button>
      </div>
      <div className="tbl-wrap" style={{ maxHeight: 640, overflow: "auto" }}>
        <table className="tbl chain">
          <thead><tr>
            <th className="ce">OI</th><th className="ce">Chg OI</th><th className="ce">Vol</th><th className="ce">IV</th>{greeks && <><th className="ce">Δ</th><th className="ce">Γ</th><th className="ce">Θ/day</th><th className="ce">Vega</th></>}<th className="ce">Price</th><th className="ce">Chg</th>
            <th>Strike</th><th>PCR</th>
            <th className="pe">Chg</th><th className="pe">Price</th>{greeks && <><th className="pe">Vega</th><th className="pe">Θ/day</th><th className="pe">Γ</th><th className="pe">Δ</th></>}<th className="pe">IV</th><th className="pe">Vol</th><th className="pe">Chg OI</th><th className="pe">OI</th>
          </tr></thead>
          <tbody>
            {shown.map((x) => {
              const ceItm = moneyness(1, x.strike, refPx) === "ITM", peItm = moneyness(-1, x.strike, refPx) === "ITM";
              const g = (l, k, d = 3) => (l?.g ? (+l.g[k]).toFixed(d) : "—");
              return (
                <tr key={x.strike} className={x.strike === atmK ? "atm" : ""}>
                  {cell(x.ce, "ce", "oi")}{cell(x.ce, "ce", "chgOi", (l) => <span className={l?.chgOi > 0 ? "pos" : l?.chgOi < 0 ? "neg" : ""}>{fn(l?.chgOi, 0)}</span>)}{cell(x.ce, "ce", "vol", (l) => fn(l?.vol, 0))}{cell(x.ce, "ce", "iv", ivCell)}
                  {greeks && <><td className="num">{g(x.ce, "delta", 2)}</td><td className="num">{g(x.ce, "gamma", 5)}</td><td className="num">{g(x.ce, "theta", 2)}</td><td className="num">{g(x.ce, "vega", 2)}</td></>}
                  <td className="num" style={{ background: ceItm ? "var(--panel-2)" : undefined }}>{fn(x.ce?.px)}</td>{cell(x.ce, "ce", "chgPx", (l) => <span className={l?.chgPx > 0 ? "pos" : l?.chgPx < 0 ? "neg" : ""}>{fn(l?.chgPx)}</span>)}
                  <td className="num"><b>{x.strike}</b></td>
                  <td className="num muted">{x.ce?.oi > 0 && x.pe?.oi != null ? (x.pe.oi / x.ce.oi).toFixed(2) : "—"}</td>
                  {cell(x.pe, "pe", "chgPx", (l) => <span className={l?.chgPx > 0 ? "pos" : l?.chgPx < 0 ? "neg" : ""}>{fn(l?.chgPx)}</span>)}<td className="num" style={{ background: peItm ? "var(--panel-2)" : undefined }}>{fn(x.pe?.px)}</td>
                  {greeks && <><td className="num">{g(x.pe, "vega", 2)}</td><td className="num">{g(x.pe, "theta", 2)}</td><td className="num">{g(x.pe, "gamma", 5)}</td><td className="num">{g(x.pe, "delta", 2)}</td></>}
                  {cell(x.pe, "pe", "iv", ivCell)}{cell(x.pe, "pe", "vol", (l) => fn(l?.vol, 0))}{cell(x.pe, "pe", "chgOi", (l) => <span className={l?.chgOi > 0 ? "pos" : l?.chgOi < 0 ? "neg" : ""}>{fn(l?.chgOi, 0)}</span>)}{cell(x.pe, "pe", "oi")}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="legend-note">Price = last traded price if the contract traded today, else the exchange settlement price. IV and Greeks: {chain.assumptions.model}, risk-free {(DERIV_DEFAULTS.riskFree * 100).toFixed(2)}% unless changed above, {chain.assumptions.time}. Bid / ask and bid / ask IV need a live feed (Data sources). Shaded price = in the money. Quote hygiene: * did not trade today (settlement price); † unreliable quote ({Object.entries(chainQuality(chain).counts).filter(([, n]) => n).map(([k, n]) => `${QUOTE_FLAGS[k].toLowerCase()} ${n}`).join(", ") || "none"}); IV and Greeks are suppressed for contracts with no OI and no volume, or priced below intrinsic value. Hover an IV for its flags.</p>
    </div>
  );
}

function OiProfile({ chain, ex, prevChain }) {
  const [mode, setMode] = useState("oi");
  const mp = maxPain(ex);
  const pts = (side) => ex.rows.map((x) => ({ x: x.strike, y: mode === "oi" ? x[side]?.oi ?? null : x[side]?.chgOi ?? null }));
  const pex = prevChain?.expiries.find((e) => e.expiry === ex.expiry);
  return (
    <div className="card">
      <Seg value={mode} onChange={setMode} options={[{ value: "oi", label: "Open interest" }, { value: "chg", label: "Change in OI" }]} />
      <XYChart height={320} zeroLine={mode === "chg"} series={[{ name: "Call OI", type: "bar", color: "#16a34a", points: pts("ce") }, { name: "Put OI", type: "bar", color: "#dc2626", points: pts("pe") }]}
        markers={[{ x: chain.spot, label: "spot", color: "var(--text)" }, { x: mp.strike, label: "max pain", color: "#d97706" }]} xLabel="strike" />
      <div className="h3" style={{ marginTop: 10 }}>Max pain: total payout to option holders at each settlement price</div>
      <XYChart height={200} series={[{ name: "Payout", type: "line", color: "#d97706", points: mp.pains.map((p) => ({ x: p.strike, y: p.pain })) }].concat(pex ? [{ name: "Previous session", type: "line", color: "var(--muted)", dash: "4 3", points: maxPain(pex).pains.map((p) => ({ x: p.strike, y: p.pain })) }] : [])} markers={[{ x: mp.strike, label: `max pain ${mp.strike}`, color: "#d97706" }]} />
      <p className="legend-note">Max pain is where option holders would collect least at expiry. It is one input among several and is never a forecast of where the price will settle.</p>
    </div>
  );
}

function MultiExpiry({ chain }) {
  const ts = termStructure(chain);
  const rows = chain.expiries.filter((e) => e.rows.length >= 3).map((e) => {
    const p = pcr(e), em = expectedMove(e, chain.spot), t = ts.points.find((x) => x.expiry === e.expiry);
    return { id: e.expiry, expiry: e.expiry, dte: e.dte, F: e.F, basis: e.F / chain.spot - 1, iv: atmIv(e), fwdVol: t?.fwdVol, pcr: p.oi, callOi: p.callOi, putOi: p.putOi, maxPain: maxPain(e).strike, straddle: em.straddle, emPct: em.straddlePct };
  });
  return (
    <div className="card">
      <XYChart height={220} series={[{ name: "ATM IV", type: "line", color: "#2563eb", points: rows.map((x) => ({ x: x.dte, y: x.iv != null ? x.iv * 100 : null })) }, { name: "Forward vol", type: "line", color: "#d97706", dash: "4 3", points: rows.map((x) => ({ x: x.dte, y: x.fwdVol != null ? x.fwdVol * 100 : null })) }]} xLabel="days to expiry" yLabel="IV %" />
      {ts.inverted && <div className="note warn small">Term structure inverted: the nearest expiry carries higher IV than the next (event or stress priced near term).</div>}
      <DataTable compact rows={rows} exportName="multi-expiry" columns={[
        { key: "e", label: "Expiry", value: (r) => r.expiry }, { key: "d", label: "DTE", num: true, value: (r) => r.dte }, { key: "f", label: "Forward", num: true, value: (r) => r.F, render: (r) => fn(r.F) },
        { key: "b", label: "Fwd vs spot", num: true, value: (r) => r.basis, render: (r) => <FP v={r.basis} d={2} /> }, { key: "iv", label: "ATM IV", num: true, value: (r) => r.iv, render: (r) => fiv(r.iv) },
        { key: "fv", label: "Forward vol", num: true, value: (r) => r.fwdVol, render: (r) => fiv(r.fwdVol) }, { key: "p", label: "PCR", num: true, value: (r) => r.pcr, render: (r) => r.pcr?.toFixed(2) ?? "—" },
        { key: "mp", label: "Max pain", num: true, value: (r) => r.maxPain }, { key: "s", label: "Straddle", num: true, value: (r) => r.straddle, render: (r) => fn(r.straddle) },
        { key: "em", label: "Expected move", num: true, value: (r) => r.emPct, render: (r) => `±${pc(r.emPct, 1)}` },
        { key: "co", label: "Call OI", num: true, value: (r) => r.callOi, render: (r) => fn(r.callOi, 0) }, { key: "po", label: "Put OI", num: true, value: (r) => r.putOi, render: (r) => fn(r.putOi, 0) },
      ]} />
      <p className="legend-note">Forward vol between two expiries = √((σ₂²T₂ − σ₁²T₁)/(T₂ − T₁)): the volatility the market implies for the gap between them.</p>
    </div>
  );
}

const GK = ["delta", "gamma", "theta", "vega", "rho", "vanna", "charm", "vomma", "speed", "zomma", "color"];
function GreeksTab({ chain, ex, r }) {
  const [side, setSide] = useState("ce");
  const gx = gex(ex, chain.spot, chain.lot);
  const prof = useMemo(() => gexProfile(chain, { expiries: [ex.expiry], r }), [chain, ex, r]);
  const rows = ex.rows.filter((x) => x[side]?.g).map((x) => ({ id: x.strike, strike: x.strike, iv: x[side].iv, oi: x[side].oi, ...x[side].g }));
  return (
    <div className="stack">
      <div className="card">
        <div className="h3">Dealer gamma exposure (GEX) by strike, {ex.expiry}</div>
        <XYChart height={240} zeroLine series={[{ name: "Net GEX", type: "bar", color: "#2563eb", points: gx.byStrike.map((p) => ({ x: p.strike, y: p.net, color: p.net >= 0 ? "#16a34a" : "#dc2626" })) }]} markers={[{ x: chain.spot, label: "spot", color: "var(--text)" }]} xLabel="strike" />
        <div className="h3">Net GEX across spot levels</div>
        <XYChart height={200} zeroLine series={[{ name: "Net GEX", type: "line", color: "#7c3aed", points: prof.points.map((p) => ({ x: p.spot, y: p.gex })) }]} markers={[{ x: chain.spot, label: "spot", color: "var(--text)" }, { x: prof.flip, label: `gamma flip ${prof.flip ? fn(prof.flip, 0) : "—"}`, color: "#d97706" }]} xLabel="spot" />
        <p className="small">Total {fn(gx.total, 0)} (₹ per 1% move). Regime at spot: <b>{prof.regime === "positive" ? "positive gamma (hedging tends to dampen moves)" : "negative gamma (hedging tends to amplify moves)"}</b>.</p>
        <p className="legend-note">Assumption: dealers are long calls and short puts against customers, so call gamma counts positive and put gamma negative. Positioning is not published by the exchange; this is an estimate built from open interest.</p>
      </div>
      <div className="card">
        <div className="row between"><Seg value={side} onChange={setSide} options={[{ value: "ce", label: "Calls" }, { value: "pe", label: "Puts" }]} /><span className="small muted">Per one option (multiply by lot {chain.lot} for one contract)</span></div>
        <DataTable compact rows={rows} pageSize={60} exportName={`greeks-${ex.expiry}-${side}`} columns={[{ key: "strike", label: "Strike", num: true, value: (x) => x.strike }, { key: "iv", label: "IV", num: true, value: (x) => x.iv, render: (x) => fiv(x.iv) }, { key: "price", label: "Model price", num: true, value: (x) => x.price, render: (x) => x.price.toFixed(2) },
          ...GK.map((k) => ({ key: k, label: k[0].toUpperCase() + k.slice(1), num: true, value: (x) => x[k], render: (x) => (x[k] == null ? "—" : Math.abs(x[k]) < 0.01 ? x[k].toExponential(2) : x[k].toFixed(3)) }))]} />
        <div className="note small"><b>Model audit.</b> {MODEL_INFO.BLACK76}; forward {fn(ex.F)} ({ex.fSource}); risk-free {(r * 100).toFixed(2)}% (continuous); dividends: carried inside the futures price; exercise: European (NSE options); time {ex.T.toFixed(4)} years = calendar days / 365 to {ex.expiry} 15:30 IST; IV from {chain.assumptions.premium}; calculated {new Date().toISOString().slice(0, 16)} UTC from session {chain.date}. Theta and charm per calendar day; vega, vanna, zomma and vomma per 1 vol point; rho per 1% rate.</div>
      </div>
    </div>
  );
}

function ParityTab({ chain, ex, r }) {
  const fut = chain.futures.find((f) => f.expiry === ex.expiry);
  const fpx = fut ? (fut.vol > 0 ? fut.close : fut.settle) : null;
  const p = parity(ex, r, fpx);
  return (
    <div className="stack">
      <div className="card">
        <div className="h3">Synthetic futures (C − P)·e^(rT) + K by strike {fpx ? `vs the future at ${fn(fpx)}` : "(no same-expiry future listed)"}</div>
        <XYChart height={220} series={[{ name: "Synthetic", type: "line", color: "#2563eb", points: p.rows.map((x) => ({ x: x.strike, y: x.synthetic })) }].concat(fpx ? [{ name: "Future", type: "line", color: "#d97706", dash: "4 3", points: p.rows.map((x) => ({ x: x.strike, y: fpx })) }] : [])} markers={[{ x: chain.spot, label: "spot" }]} />
        <DataTable compact rows={p.rows.map((x) => ({ ...x, id: x.strike }))} exportName="parity" columns={[{ key: "k", label: "Strike", num: true, value: (x) => x.strike }, { key: "s", label: "Synthetic", num: true, value: (x) => x.synthetic, render: (x) => fn(x.synthetic) }, { key: "v", label: "vs future (conversion + / reversal −)", num: true, value: (x) => x.vsFuture, render: (x) => fn(x.vsFuture) }, { key: "l", label: "Both legs traded", value: (x) => (x.liquid ? "yes" : "no") }]} />
      </div>
      <div className="card">
        <div className="h3">Box spreads: implied financing rate</div>
        <DataTable compact rows={p.boxes.map((b) => ({ ...b, id: `${b.k1}-${b.k2}` }))} exportName="boxes" columns={[{ key: "a", label: "Strikes", value: (b) => `${b.k1}–${b.k2}` }, { key: "c", label: "Box cost", num: true, value: (b) => b.cost, render: (b) => fn(b.cost) }, { key: "r", label: "Implied rate", num: true, value: (b) => b.impliedRate, render: (b) => <FP v={b.impliedRate} d={2} /> }]} />
        <p className="legend-note">{p.note}</p>
      </div>
    </div>
  );
}

function FlowTab({ ex, prevChain }) {
  const pex = prevChain?.expiries.find((e) => e.expiry === ex.expiry);
  const ivPrev = (k, cp) => { const row = pex?.rows.find((x) => x.strike === k); return (cp > 0 ? row?.ce : row?.pe)?.iv ?? null; };
  const rows = ex.rows.flatMap((x) => [x.ce, x.pe].filter(Boolean).map((l) => ({ l, k: x.strike }))).map(({ l, k }) => ({ k, l, f: optionFlow(l, { ivPrev: ivPrev(k, l.cp) }) })).filter((x) => x.f)
    .map((x) => ({ id: `${x.k}${x.l.cp}`, strike: x.k, type: x.l.cp > 0 ? "CE" : "PE", label: x.f.label, conf: x.f.confidence, chgOi: x.l.chgOi, chgPx: x.l.chgPx, evidence: x.f.evidence.join("; ") }));
  return (
    <div className="card">
      <DataTable compact rows={rows} pageSize={50} exportName={`flow-${ex.expiry}`} initialSort={{ key: "oi", dir: "desc" }} columns={[
        { key: "k", label: "Strike", num: true, value: (x) => x.strike }, { key: "t", label: "Type", value: (x) => x.type },
        { key: "l", label: "Likely activity", value: (x) => x.label, render: (x) => <Badge kind={/writing|unwinding/.test(x.label) ? (x.type === "CE" ? "r" : "g") : ""}>{x.label}</Badge> },
        { key: "c", label: "Confidence", num: true, value: (x) => x.conf, render: (x) => `${Math.round(x.conf * 100)}%` },
        { key: "oi", label: "OI chg", num: true, value: (x) => Math.abs(x.chgOi), render: (x) => fn(x.chgOi, 0) }, { key: "p", label: "Premium chg", num: true, value: (x) => x.chgPx, render: (x) => fn(x.chgPx) },
        { key: "e", label: "Evidence", value: (x) => x.evidence },
      ]} />
      <p className="legend-note">OI up + premium down → writing likely; OI up + premium up → buying likely; OI down + premium up → writers covering; OI down + premium down → buyers unwinding. IV change raises or lowers the confidence. Whether trades hit the bid or the ask is not in end-of-day data, so confidence is capped at 80%.</p>
    </div>
  );
}

function HistoryTab({ api, und }) {
  const h = useAsync(() => api.history(und), [und]);
  if (!h.data) return <Loading />;
  const d = h.data.map((s) => s.date);
  const line = (k, color, f = (x) => x) => ({ id: k, type: "line", data: lineData(d, h.data.map((s) => (s[k] != null ? f(s[k]) : null))).filter((p) => p.value != null), options: { color, lineWidth: 2, title: k } });
  return (
    <div className="grid g2">
      <div className="card"><div className="h3">Spot and max pain (near expiry)</div><TvChart height={220} series={[line("spot", "#64748b"), line("maxPain", "#d97706"), line("callWall", "#16a34a"), line("putWall", "#dc2626")]} /></div>
      <div className="card"><div className="h3">Put-call ratio (OI)</div><TvChart height={220} series={[line("pcrOi", "#2563eb"), line("pcrNear", "#7c3aed")]} /></div>
      <div className="card"><div className="h3">ATM IV % (near) and 20d realised</div><TvChart height={220} series={[line("atmIv", "#db2777", (x) => x * 100), line("rv20", "#64748b", (x) => x * 100)]} /></div>
      <div className="card"><div className="h3">Futures open interest (all expiries)</div><TvChart height={220} series={[{ id: "oi", type: "histogram", data: lineData(d, h.data.map((s) => s.futOi)), options: { color: "#0891b2" } }]} /></div>
    </div>
  );
}
