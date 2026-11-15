// Strategy builder & analyser: templates, free multi-leg construction, payoff
// at expiry and before it, risk / reward, probabilities, costs, a margin
// estimate, Greeks, scenario matrix, side-by-side comparison, a rule-based
// recommender, adjustment ideas, saved positions with portfolio risk, and a
// trade journal. Practice only: nothing here places an order.
import { useMemo, useState } from "react";
import { PageHead, Kpi, Tabs, Select, Seg, Badge, Loading, Empty } from "../../components/ui.jsx";
import { DataTable } from "../../components/DataTable.jsx";
import { XYChart } from "../../components/XYChart.jsx";
import { useAsync } from "../../lib/useAsync.js";
import { navigate } from "../../lib/router.js";
import { usePersistent, uid } from "../../lib/storage.js";
import { useDerivRows, DerivGate, UndSelect, fn, fiv, pc } from "./common.jsx";
import { enrichChain, oiWalls } from "../../../engine/deriv/chain.js";
import { TEMPLATES, TEMPLATE_GROUPS, legsFromTemplate, makeLeg, strategyMetrics, positionPnl, positionGreeks, scenarioMatrix, strategyCosts, marginEstimate, recommend, adjustments, legLabel } from "../../../engine/deriv/strategy.js";
import { settlementInfo } from "../../../engine/deriv/futures.js";

const money = (v) => (v === Infinity ? "Unlimited" : v === -Infinity ? "Unlimited" : fn(v, 0));

export default function Strategy({ route }) {
  const { api, status, rows, loading, error } = useDerivRows();
  const und = route.query.und || rows?.find((r) => r.und === "NIFTY")?.und || rows?.[0]?.und;
  const day = useAsync(() => (und ? api.chain(und) : Promise.resolve(null)), [und]);
  const chain = useMemo(() => (day.data ? enrichChain(day.data) : null), [day.data]);
  const row = rows?.find((r) => r.und === und);
  const [tab, setTab] = useState("build");
  return (
    <div className="stack">
      <PageHead title="Strategy builder" sub="Build any multi-leg position from futures, calls, puts and shares; see its payoff, risk, probabilities and costs. Practice only: no orders are placed." />
      <DerivGate status={status} loading={loading} error={error}>
        <div className="card row wrap" style={{ gap: 10 }}><UndSelect rows={rows} value={und} onChange={(u) => navigate("dstrat", { und: u })} />{chain && <span className="small muted">Prices from session {chain.date}; spot {fn(chain.spot)}; lot {chain.lot}</span>}</div>
        <Tabs value={tab} onChange={setTab} tabs={[{ value: "build", label: "Build & analyse" }, { value: "rec", label: "Recommender" }, { value: "cmp", label: "Compare" }, { value: "book", label: "My positions & risk" }, { value: "journal", label: "Trade journal" }]} />
        {day.loading && <Loading />}
        {chain && tab === "build" && <Builder chain={chain} und={und} />}
        {chain && tab === "rec" && <Recommender chain={chain} row={row} und={und} />}
        {chain && tab === "cmp" && <Compare chain={chain} />}
        {tab === "book" && <Book api={api} />}
        {tab === "journal" && <Journal />}
      </DerivGate>
    </div>
  );
}

function useDraft(chain) {
  const [legs, setLegs] = useState(() => legsFromTemplate(TEMPLATES.find((t) => t.name === "Bull Call Spread"), chain));
  return [legs, setLegs];
}

function Builder({ chain, und }) {
  const [legs, setLegs] = useDraft(chain);
  const [tpl, setTpl] = useState("Bull Call Spread");
  const [lots, setLots] = useState(1);
  const [ei, setEi] = useState(0);
  const [days, setDays] = useState(0);
  const [dv, setDv] = useState(0);
  const [, setPositions] = usePersistent("deriv.positions", []);
  const apply = (name = tpl, l = lots, e = ei) => setLegs(legsFromTemplate(TEMPLATES.find((t) => t.name === name), chain, { lots: l, expiryIndex: e }));
  const exps = chain.expiries.filter((e) => e.rows.length >= 3);
  const save = () => { const name = prompt("Name this position", `${und} ${tpl}`); if (!name) return; setPositions((p) => [...p, { id: uid(), name, und, kind: chain.kind, lot: chain.lot, opened: chain.date, legs, tag: tpl }]); };
  return (
    <div className="stack">
      <div className="card">
        <div className="row wrap" style={{ gap: 10 }}>
          <label className="lbl-ctl">Template<select value={tpl} onChange={(e) => { setTpl(e.target.value); apply(e.target.value); }}>{TEMPLATE_GROUPS.map((g) => <optgroup key={g} label={g}>{TEMPLATES.filter((t) => t.group === g).map((t) => <option key={t.name}>{t.name}</option>)}</optgroup>)}</select></label>
          <label className="small muted">Lots <input type="number" min={1} value={lots} onChange={(e) => { const l = Math.max(1, +e.target.value || 1); setLots(l); apply(tpl, l); }} style={{ width: 60 }} /></label>
          <Select value={ei} onChange={(x) => { setEi(+x); apply(tpl, lots, +x); }} options={exps.map((e, i) => ({ value: i, label: `${e.expiry} (${e.dte}d)` }))} label="Expiry" />
          <div className="grow" />
          <button className="btn sm" onClick={() => setLegs([...legs, makeLeg(chain, { type: "CE", side: 1, strike: exps[ei]?.rows[Math.floor(exps[ei].rows.length / 2)]?.strike, expiry: exps[ei]?.expiry, qty: 1 })])}>+ Leg</button>
          <button className="btn sm primary" onClick={save}>Save position</button>
        </div>
        <LegEditor chain={chain} legs={legs} setLegs={setLegs} />
      </div>
      <Analysis chain={chain} legs={legs} days={days} setDays={setDays} dv={dv} setDv={setDv} />
    </div>
  );
}

function LegEditor({ chain, legs, setLegs }) {
  const set = (i, patch) => setLegs(legs.map((l, j) => (j === i ? makeLeg(chain, { ...l, ...patch, price: patch.price ?? (patch.strike || patch.expiry || patch.type ? null : l.price) }) : l)));
  return (
    <table className="tbl" style={{ marginTop: 8 }}>
      <thead><tr><th>Side</th><th>Instrument</th><th>Expiry</th><th>Strike</th><th>Qty (lots)</th><th>Entry price</th><th>IV</th><th /></tr></thead>
      <tbody>{legs.map((l, i) => {
        const ex = chain.expiries.find((e) => e.expiry === l.expiry);
        return (
          <tr key={i}>
            <td><select value={l.side} onChange={(e) => set(i, { side: +e.target.value })}><option value={1}>Buy</option><option value={-1}>Sell</option></select></td>
            <td><select value={l.type} onChange={(e) => set(i, { type: e.target.value, expiry: e.target.value === "EQ" ? null : l.expiry || chain.expiries[0].expiry })}><option>CE</option><option>PE</option><option>FUT</option><option value="EQ">Shares</option></select></td>
            <td>{l.type === "EQ" ? "—" : <select value={l.expiry || ""} onChange={(e) => set(i, { expiry: e.target.value })}>{(l.type === "FUT" ? chain.futures.map((f) => f.expiry) : chain.expiries.map((e) => e.expiry)).map((x) => <option key={x}>{x}</option>)}</select>}</td>
            <td>{l.type === "CE" || l.type === "PE" ? <select value={l.strike ?? ""} onChange={(e) => set(i, { strike: +e.target.value })}>{(ex?.rows || []).map((x) => <option key={x.strike} value={x.strike}>{x.strike}</option>)}</select> : "—"}</td>
            <td><input type="number" min={1} value={l.qty} onChange={(e) => set(i, { qty: Math.max(1, +e.target.value || 1) })} style={{ width: 60 }} /></td>
            <td><input type="number" step="0.05" value={l.price ?? ""} onChange={(e) => setLegs(legs.map((x, j) => (j === i ? { ...x, price: +e.target.value } : x)))} style={{ width: 90 }} /></td>
            <td className="num">{l.type === "CE" || l.type === "PE" ? fiv(l.iv) : "—"}</td>
            <td><a style={{ cursor: "pointer" }} onClick={() => setLegs(legs.filter((_, j) => j !== i))}>remove</a></td>
          </tr>
        );
      })}</tbody>
    </table>
  );
}

function Analysis({ chain, legs, days, setDays, dv, setDv }) {
  const m = useMemo(() => (legs.length ? strategyMetrics(legs, chain, { dv }) : null), [legs, chain, dv]);
  const tN = useMemo(() => {
    if (!m) return [];
    return m.grid.filter((_, i) => i % 6 === 0).map((g) => ({ x: g.S, y: positionPnl(legs, g.S, chain, { t: days / 365, dv }) }));
  }, [m, legs, chain, days, dv]);
  const t0 = useMemo(() => (m ? m.grid.filter((_, i) => i % 6 === 0).map((g) => ({ x: g.S, y: positionPnl(legs, g.S, chain, { t: 0, dv }) })) : []), [m, legs, chain, dv]);
  if (!m) return <Empty>Add a leg to analyse.</Empty>;
  const costs = strategyCosts(legs, chain), mg = marginEstimate(legs, chain), adj = adjustments(legs, chain, m);
  const sm = scenarioMatrix(legs, chain, { days });
  const physical = chain.kind === "stock" && legs.some((l) => l.expiry && settlementInfo("stock", l.expiry, chain.date).deliveryWindow);
  const roM = mg.estimate > 0 && Number.isFinite(m.maxProfit) ? m.maxProfit / mg.estimate : null;
  return (
    <div className="stack">
      <div className="kpis">
        <Kpi label={m.netPremium >= 0 ? "Net credit" : "Net debit"} value={fn(Math.abs(m.netPremium), 0)} />
        <Kpi label="Max profit" value={money(m.maxProfit)} cls="pos" /><Kpi label="Max loss" value={money(m.maxLoss)} cls="neg" />
        <Kpi label="Breakevens" value={m.breakevens.map((b) => fn(b, 0)).join(" / ") || "—"} />
        <Kpi label="Reward / risk" value={m.rewardRisk?.toFixed(2) ?? "—"} />
        <Kpi label="Probability of profit" value={pc(m.pop)} sub={`touch: ${m.pot.map((p) => pc(p)).join(" / ") || "—"}`} />
        <Kpi label="Expected value" value={fn(m.ev, 0)} sub="risk-neutral" />
        <Kpi label="Margin (estimate)" value={fn(mg.estimate, 0)} sub={roM != null ? `max return on margin ${pc(roM)}` : mg.label} />
        <Kpi label="Costs, round trip" value={fn(costs.total, 0)} />
      </div>
      {physical && <div className="note warn small">A stock leg is in the physical-settlement window: in-the-money stock options and futures held into expiry settle by delivery of shares, and delivery margins rise in the last days.</div>}
      <div className="card">
        <div className="row wrap" style={{ gap: 12 }}>
          <label className="small muted">Before expiry: T + <input type="number" min={0} max={365} value={days} onChange={(e) => setDays(Math.max(0, +e.target.value || 0))} style={{ width: 60 }} /> days</label>
          <label className="small muted">IV shift <input type="number" step="1" value={dv * 100} onChange={(e) => setDv((+e.target.value || 0) / 100)} style={{ width: 60 }} /> pts</label>
        </div>
        <XYChart height={300} zeroLine series={[{ name: "At expiry", type: "line", color: "#2563eb", width: 2.2, points: m.grid.filter((_, i) => i % 3 === 0).map((g) => ({ x: g.S, y: g.pnl })) }, { name: "Today (T+0)", type: "line", color: "#64748b", dash: "4 3", points: t0 }, { name: `T+${days}`, type: "line", color: "#d97706", points: tN }]}
          markers={[{ x: chain.spot, label: "spot", color: "var(--text)" }, ...m.breakevens.map((b) => ({ x: b, label: "BE", color: "#16a34a" }))]} xLabel="underlying at expiry" />
        <p className="legend-note">{m.assumptions} Probabilities are risk-neutral (from IV), not forecasts.</p>
      </div>
      <div className="grid g2">
        <div className="card">
          <div className="h3">Greeks now (whole position)</div>
          <DataTable compact rows={Object.entries(m.greeks).map(([k, v]) => ({ id: k, k, v }))} exportName="position-greeks" columns={[{ key: "k", label: "Greek", value: (x) => x.k }, { key: "v", label: "Value", num: true, value: (x) => x.v, render: (x) => (Math.abs(x.v) < 0.01 ? x.v.toExponential(2) : x.v.toFixed(3)) }]} />
          <div className="h3" style={{ marginTop: 8 }}>Adjustment ideas</div>
          {adj.map((a) => <div key={a} className="small">• {a}</div>)}
        </div>
        <div className="card">
          <div className="h3">Costs and margin</div>
          <DataTable compact rows={costs.rows.map((c, i) => ({ ...c, id: i }))} exportName="costs" columns={[{ key: "l", label: "Leg", value: (c) => c.leg }, { key: "o", label: "Open", num: true, value: (c) => c.open, render: (c) => fn(c.open) }, { key: "c", label: "Close", num: true, value: (c) => c.close, render: (c) => fn(c.close) }, { key: "s", label: "of which STT", num: true, value: (c) => c.stt, render: (c) => fn(c.stt) }]} />
          <p className="legend-note">{costs.note} Margin: <b>{mg.label}</b>. {mg.note}</p>
        </div>
      </div>
      <div className="card">
        <div className="h3">Scenario matrix: P&L (and delta) by spot move × IV shift, T + {days} days</div>
        <div className="tbl-wrap"><table className="tbl chain">
          <thead><tr><th>IV shift</th>{sm[0].cells.map((c) => <th key={c.shock}>{c.shock >= 0 ? "+" : ""}{(c.shock * 100).toFixed(0)}%</th>)}</tr></thead>
          <tbody>{sm.map((r) => <tr key={r.dv}><td>{r.dv >= 0 ? "+" : ""}{(r.dv * 100).toFixed(0)} pts</td>{r.cells.map((c) => <td key={c.shock} className={`num ${c.pnl >= 0 ? "pos" : "neg"}`} title={`delta ${c.delta.toFixed(1)} · gamma ${c.gamma.toFixed(4)} · vega ${c.vega.toFixed(1)} · theta ${c.theta.toFixed(1)}`}>{fn(c.pnl, 0)}<div className="muted small">Δ {c.delta.toFixed(0)}</div></td>)}</tr>)}</tbody>
        </table></div>
      </div>
    </div>
  );
}

function Recommender({ chain, row, und }) {
  const [view, setView] = useState("bullish");
  const [maxLoss, setMaxLoss] = useState("");
  const [ei, setEi] = useState(0);
  const walls = useMemo(() => { const ex = chain.expiries.find((e) => e.rows.length >= 3); return ex ? oiWalls(ex, chain.spot) : null; }, [chain]);
  const list = useMemo(() => recommend(chain, { view, ivPercentile: row?.s?.ivPct ?? null, maxLoss: maxLoss ? +maxLoss : null, expiryIndex: ei, walls }), [chain, view, row, maxLoss, ei, walls]);
  const [, setPositions] = usePersistent("deriv.positions", []);
  const exps = chain.expiries.filter((e) => e.rows.length >= 3);
  return (
    <div className="stack">
      <div className="card row wrap" style={{ gap: 10 }}>
        <Seg value={view} onChange={setView} options={[{ value: "bullish", label: "Bullish" }, { value: "bearish", label: "Bearish" }, { value: "neutral", label: "Range-bound" }, { value: "volatile", label: "Big move either way" }]} />
        <Select value={ei} onChange={(x) => setEi(+x)} options={exps.map((e, i) => ({ value: i, label: `${e.expiry} (${e.dte}d)` }))} label="Horizon (expiry)" />
        <label className="small muted">Max loss ₹ <input type="number" value={maxLoss} onChange={(e) => setMaxLoss(e.target.value)} style={{ width: 100 }} placeholder="none" /></label>
        <span className="small muted">IV percentile now: {row?.s?.ivPct != null ? Math.round(row.s.ivPct * 100) : "—"}</span>
      </div>
      <div className="card">
        <DataTable rows={list.map((x, i) => ({ ...x, id: i }))} exportName="strategy-ranking" pageSize={20} columns={[
          { key: "t", label: "Structure", value: (x) => x.template }, { key: "s", label: "Score", num: true, value: (x) => x.score },
          { key: "pop", label: "PoP", num: true, value: (x) => x.metrics.pop, render: (x) => pc(x.metrics.pop) },
          { key: "mp", label: "Max profit", num: true, value: (x) => x.metrics.maxProfit, render: (x) => money(x.metrics.maxProfit) },
          { key: "ml", label: "Max loss", num: true, value: (x) => x.metrics.maxLoss, render: (x) => money(x.metrics.maxLoss) },
          { key: "legs", label: "Legs", value: (x) => x.legs.map(legLabel).join(" · ") },
          { key: "why", label: "Why", value: (x) => x.reasons.join("; ") },
          { key: "save", label: "", export: false, value: () => "", render: (x) => <a style={{ cursor: "pointer" }} onClick={() => setPositions((p) => [...p, { id: uid(), name: `${und} ${x.template}`, und, kind: chain.kind, lot: chain.lot, opened: chain.date, legs: x.legs, tag: x.template }])}>save</a> },
        ]} />
        <p className="legend-note">A ranking of structures against your view, the underlying's IV percentile, OI walls, liquidity and your loss limit. It explains its scores and is not a recommendation to trade.</p>
      </div>
    </div>
  );
}

function Compare({ chain }) {
  const [names, setNames] = useState(["Iron Condor", "Short Strangle", "Iron Butterfly"]);
  const rows = names.map((n) => { const legs = legsFromTemplate(TEMPLATES.find((t) => t.name === n), chain); return { id: n, n, legs, m: strategyMetrics(legs, chain), mg: marginEstimate(legs, chain), c: strategyCosts(legs, chain) }; });
  const colors = ["#2563eb", "#d97706", "#16a34a", "#db2777"];
  return (
    <div className="stack">
      <div className="card row wrap" style={{ gap: 10 }}>
        {names.map((n, i) => <select key={i} value={n} onChange={(e) => setNames(names.map((x, j) => (j === i ? e.target.value : x)))}>{TEMPLATES.map((t) => <option key={t.name}>{t.name}</option>)}</select>)}
        {names.length < 4 && <button className="btn sm" onClick={() => setNames([...names, "Long Straddle"])}>+ Add</button>}
      </div>
      <div className="card">
        <XYChart height={300} zeroLine series={rows.map((r, i) => ({ name: r.n, type: "line", color: colors[i], points: r.m.grid.filter((_, k) => k % 4 === 0).map((g) => ({ x: g.S, y: g.pnl })) }))} markers={[{ x: chain.spot, label: "spot" }]} />
        <DataTable compact rows={rows} exportName="strategy-compare" columns={[
          { key: "n", label: "Structure", value: (r) => r.n }, { key: "pop", label: "PoP", num: true, value: (r) => r.m.pop, render: (r) => pc(r.m.pop) },
          { key: "mp", label: "Max profit", num: true, value: (r) => r.m.maxProfit, render: (r) => money(r.m.maxProfit) }, { key: "ml", label: "Max loss", num: true, value: (r) => r.m.maxLoss, render: (r) => money(r.m.maxLoss) },
          { key: "be", label: "Breakevens", value: (r) => r.m.breakevens.map((b) => fn(b, 0)).join(" / ") }, { key: "mg", label: "Margin (est.)", num: true, value: (r) => r.mg.estimate, render: (r) => fn(r.mg.estimate, 0) },
          { key: "th", label: "Theta / day", num: true, value: (r) => r.m.greeks.theta, render: (r) => fn(r.m.greeks.theta, 0) }, { key: "ve", label: "Vega", num: true, value: (r) => r.m.greeks.vega, render: (r) => fn(r.m.greeks.vega, 0) },
          { key: "c", label: "Costs", num: true, value: (r) => r.c.total, render: (r) => fn(r.c.total, 0) },
        ]} />
        <p className="legend-note">All structures use the same session prices, IV and expiry, so differences come from the structures alone.</p>
      </div>
    </div>
  );
}

function Book({ api }) {
  const [positions, setPositions] = usePersistent("deriv.positions", []);
  const unds = [...new Set(positions.map((p) => p.und))];
  const chains = useAsync(async () => Object.fromEntries(await Promise.all(unds.map(async (u) => { const d = await api.chain(u); return [u, d ? enrichChain(d) : null]; }))), [unds.join(",")]);
  const [by, setBy] = useState("und");
  if (!positions.length) return <Empty>No saved positions. Build one and press “Save position”.</Empty>;
  if (!chains.data) return <Loading what="latest prices" />;
  const rows = positions.map((p) => {
    const ch = chains.data[p.und];
    if (!ch) return { ...p, missing: true };
    const legs = p.legs.map((l) => ({ ...l }));
    const now = legs.reduce((s, l) => { const cur = makeLeg(ch, { ...l, price: null }); return s + l.side * l.qty * (l.type === "EQ" ? 1 : ch.lot) * ((cur.price ?? l.price) - l.price); }, 0);
    const g = positionGreeks(legs, ch);
    const expiries = [...new Set(legs.map((l) => l.expiry).filter(Boolean))].sort();
    return { ...p, pnl: now, g, expiry: expiries[0] || "—", spot: ch.spot };
  });
  const groups = new Map();
  for (const r of rows.filter((x) => !x.missing)) {
    const k = by === "und" ? r.und : by === "expiry" ? r.expiry : by === "tag" ? r.tag || "—" : (r.kind === "index" ? "Index" : "Stock");
    const a = groups.get(k) || { id: k, key: k, n: 0, pnl: 0, delta: 0, gamma: 0, theta: 0, vega: 0 };
    a.n++; a.pnl += r.pnl; a.delta += r.g.delta; a.gamma += r.g.gamma; a.theta += r.g.theta; a.vega += r.g.vega;
    groups.set(k, a);
  }
  return (
    <div className="stack">
      <div className="card">
        <div className="row between"><div className="h3">Aggregated risk</div><Seg value={by} onChange={setBy} options={[{ value: "und", label: "By underlying" }, { value: "expiry", label: "By expiry" }, { value: "tag", label: "By strategy" }, { value: "kind", label: "Index / stock" }]} /></div>
        <DataTable compact rows={[...groups.values()]} exportName="portfolio-greeks" columns={[{ key: "k", label: "Group", value: (a) => a.key }, { key: "n", label: "Positions", num: true, value: (a) => a.n }, { key: "p", label: "P&L (marked)", num: true, value: (a) => a.pnl, render: (a) => <span className={a.pnl >= 0 ? "pos" : "neg"}>{fn(a.pnl, 0)}</span> }, ...["delta", "gamma", "theta", "vega"].map((k) => ({ key: k, label: k, num: true, value: (a) => a[k], render: (a) => fn(a[k], 2) }))]} />
      </div>
      <div className="card">
        <div className="h3">Positions (marked to the latest stored session)</div>
        <DataTable rows={rows} exportName="positions" columns={[
          { key: "n", label: "Name", value: (p) => p.name }, { key: "u", label: "Underlying", value: (p) => p.und }, { key: "o", label: "Opened", value: (p) => p.opened }, { key: "e", label: "First expiry", value: (p) => p.expiry },
          { key: "l", label: "Legs", value: (p) => p.legs.map(legLabel).join(" · ") }, { key: "p", label: "P&L", num: true, value: (p) => p.pnl, render: (p) => (p.missing ? "no data" : <span className={p.pnl >= 0 ? "pos" : "neg"}>{fn(p.pnl, 0)}</span>) },
          { key: "d", label: "Delta", num: true, value: (p) => p.g?.delta, render: (p) => fn(p.g?.delta, 1) },
          { key: "x", label: "", export: false, value: () => "", render: (p) => <a style={{ cursor: "pointer" }} onClick={() => confirm(`Remove ${p.name}?`) && setPositions(positions.filter((x) => x.id !== p.id))}>remove</a> },
        ]} />
        <p className="legend-note">Practice positions only, kept in your account. Greeks per position use Black-76 at today's IV for each leg.</p>
      </div>
    </div>
  );
}

function Journal() {
  const [items, setItems] = usePersistent("deriv.journal", []);
  const [positions] = usePersistent("deriv.positions", []);
  const [draft, setDraft] = useState({ position: "", thesis: "", outcome: "", lesson: "", pnl: "" });
  const add = () => { if (!draft.thesis.trim()) return; setItems([{ id: uid(), at: new Date().toISOString().slice(0, 10), ...draft, pnl: draft.pnl === "" ? null : +draft.pnl }, ...items]); setDraft({ position: "", thesis: "", outcome: "", lesson: "", pnl: "" }); };
  const closed = items.filter((x) => x.pnl != null), wins = closed.filter((x) => x.pnl > 0);
  const coach = [];
  if (closed.length >= 5) {
    coach.push(`Win rate ${Math.round((wins.length / closed.length) * 100)}% over ${closed.length} closed entries; average win ${fn(wins.reduce((a, x) => a + x.pnl, 0) / (wins.length || 1), 0)}, average loss ${fn(closed.filter((x) => x.pnl <= 0).reduce((a, x) => a + x.pnl, 0) / ((closed.length - wins.length) || 1), 0)}.`);
    const words = new Map(); for (const x of closed.filter((y) => y.pnl <= 0)) for (const w of String(x.lesson).toLowerCase().match(/[a-z]{5,}/g) || []) words.set(w, (words.get(w) || 0) + 1);
    const top = [...words.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map((x) => x[0]);
    if (top.length) coach.push(`Words that recur in the lessons of losing entries: ${top.join(", ")}.`);
  } else coach.push("Log at least five closed entries (with P&L) to see patterns here.");
  return (
    <div className="stack">
      <div className="card">
        <div className="row wrap" style={{ gap: 8 }}>
          <select value={draft.position} onChange={(e) => setDraft({ ...draft, position: e.target.value })}><option value="">(no saved position)</option>{positions.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}</select>
          <input placeholder="Thesis: why this trade" value={draft.thesis} onChange={(e) => setDraft({ ...draft, thesis: e.target.value })} style={{ flex: 2, minWidth: 220 }} />
          <input placeholder="Outcome" value={draft.outcome} onChange={(e) => setDraft({ ...draft, outcome: e.target.value })} style={{ flex: 1, minWidth: 140 }} />
          <input placeholder="Lesson" value={draft.lesson} onChange={(e) => setDraft({ ...draft, lesson: e.target.value })} style={{ flex: 1, minWidth: 140 }} />
          <input type="number" placeholder="P&L ₹ (if closed)" value={draft.pnl} onChange={(e) => setDraft({ ...draft, pnl: e.target.value })} style={{ width: 130 }} />
          <button className="btn sm primary" onClick={add}>Add</button>
        </div>
      </div>
      <div className="card"><div className="h3">Review</div>{coach.map((c) => <div key={c} className="small">• {c}</div>)}</div>
      <div className="card">
        <DataTable rows={items} exportName="trade-journal" columns={[{ key: "a", label: "Date", value: (x) => x.at }, { key: "p", label: "Position", value: (x) => x.position }, { key: "t", label: "Thesis", value: (x) => x.thesis }, { key: "o", label: "Outcome", value: (x) => x.outcome }, { key: "l", label: "Lesson", value: (x) => x.lesson }, { key: "pnl", label: "P&L", num: true, value: (x) => x.pnl, render: (x) => (x.pnl == null ? "open" : <span className={x.pnl >= 0 ? "pos" : "neg"}>{fn(x.pnl, 0)}</span>) }, { key: "x", label: "", export: false, value: () => "", render: (x) => <a style={{ cursor: "pointer" }} onClick={() => setItems(items.filter((y) => y.id !== x.id))}>delete</a> }]} />
      </div>
    </div>
  );
}
