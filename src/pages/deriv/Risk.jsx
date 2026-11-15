// Portfolio risk & attribution for saved practice positions: raw and
// beta-weighted Greeks, P&L attribution, stress tests (beta-scaled and with
// correlation breakdown), parametric / historical / Monte Carlo VaR and
// expected shortfall, hedge ideas, margin use with a what-if, risk limits with
// hard / soft levels, and position sizing. Everything is an end-of-day estimate.
import { useEffect, useMemo, useState } from "react";
import { PageHead, Kpi, Tabs, Seg, Select, Badge, Loading, Empty, Check } from "../../components/ui.jsx";
import { DataTable } from "../../components/DataTable.jsx";
import { useAsync } from "../../lib/useAsync.js";
import { usePersistent } from "../../lib/storage.js";
import { logAi, logRisk } from "../../lib/audit.js";
import { useDerivRows, DerivGate, fn, pc, Tag } from "./common.jsx";
import { enrichChain } from "../../../engine/deriv/chain.js";
import { legLabel, strategyMetrics } from "../../../engine/deriv/strategy.js";
import { alignedReturns, beta, betaWeighted, pnlAttribution, stressPortfolio, portfolioVar, hedgeIdeas, sizing, SIZING_METHODS, checkLimits, marginMonitor } from "../../../engine/deriv/risk.js";

const DEFAULTS = { capital: 1000000, bench: "NIFTY", conf: 0.99, corrScale: 1, limits: { maxUnderlyingPct: 0.6, maxExpiryPct: 0.8, maxNetDelta: null, maxNetVega: null, maxNetGamma: null, maxDailyLoss: 25000, maxMarginPct: 0.6, hard: ["maxDailyLoss"] } };
const LIMIT_LABEL = { maxUnderlyingPct: "Max share of gross delta in one underlying", maxExpiryPct: "Max share of contracts in one expiry", maxNetDelta: "Max |beta-weighted delta| (index units)", maxNetVega: "Max |net vega|", maxNetGamma: "Max |net gamma|", maxDailyLoss: "Max one-session loss (₹)", maxMarginPct: "Max estimated margin / collateral" };
const PCT_LIMITS = new Set(["maxUnderlyingPct", "maxExpiryPct", "maxMarginPct"]);

export default function Risk() {
  const { api, status, loading, error } = useDerivRows();
  const [positions] = usePersistent("deriv.positions", []);
  const [cfgRaw, setCfg] = usePersistent("deriv.risk", DEFAULTS);
  const cfg = { ...DEFAULTS, ...cfgRaw, limits: { ...DEFAULTS.limits, ...(cfgRaw?.limits || {}) } };
  const set = (p) => setCfg({ ...cfg, ...p });
  const [tab, setTab] = useState("greeks");
  const unds = useMemo(() => [...new Set([...positions.map((p) => p.und), cfg.bench])].sort(), [positions, cfg.bench]);
  const loaded = useAsync(async () => {
    const out = { chains: {}, prev: {}, hist: {} };
    await Promise.all(unds.map(async (u) => {
      const [d, dates, h] = await Promise.all([api.chain(u), api.chainDates(u), api.history(u)]);
      if (d) out.chains[u] = enrichChain(d);
      const pd = (dates || []).filter((x) => x < d?.date).at(-1);
      if (pd) { const p = await api.chain(u, pd); if (p) out.prev[u] = enrichChain(p); }
      out.hist[u] = h || [];
    }));
    return out;
  }, [unds.join(",")]);

  const calc = useMemo(() => {
    const L = loaded.data;
    if (!L) return null;
    const series = Object.fromEntries(unds.map((u) => [u, Object.fromEntries((L.hist[u] || []).filter((h) => h.spot > 0).map((h) => [h.date, h.spot]))]));
    const { rets } = alignedReturns(series);
    const betas = Object.fromEntries(unds.map((u) => [u, u === cfg.bench ? { beta: 1, n: rets[u]?.length || 0, estimated: false } : beta(rets[u] || [], rets[cfg.bench] || [])]));
    const live = positions.filter((p) => L.chains[p.und]);
    const bench = L.chains[cfg.bench];
    const book = betaWeighted(live, L.chains, { betas, benchSpot: bench?.spot });
    const attrib = live.map((p) => (L.prev[p.und] ? { id: p.id, name: p.name, ...pnlAttribution(p.legs, L.prev[p.und], L.chains[p.und]) } : null)).filter(Boolean);
    const dayPnl = attrib.reduce((s, a) => s + a.actual, 0);
    const margin = marginMonitor(live, L.chains, { capital: cfg.capital });
    return { rets, betas, live, bench, book, attrib, dayPnl, margin };
  }, [loaded.data, positions, unds, cfg.bench, cfg.capital]);

  if (!positions.length) return <div className="stack"><PageHead title="Portfolio risk" /><Empty>No saved positions. Build one in the Strategy builder and press “Save position”; it appears here with its risk.</Empty></div>;
  return (
    <div className="stack">
      <PageHead title="Portfolio risk & attribution" sub="Saved practice positions, marked to the latest stored session. Greeks are Black-76 at each leg's IV; margin is a stress estimate, not exchange SPAN.">
        <label className="small muted">Collateral ₹ <input type="number" value={cfg.capital} onChange={(e) => set({ capital: +e.target.value || 0 })} style={{ width: 120 }} /></label>
        <label className="small muted">Benchmark <select value={cfg.bench} onChange={(e) => set({ bench: e.target.value })}>{["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"].map((x) => <option key={x}>{x}</option>)}</select></label>
      </PageHead>
      <DerivGate status={status} loading={loading} error={error}>
        {!calc ? <Loading what="positions and history" /> : <>
          <div className="kpis">
            <Kpi label="Positions marked" value={`${calc.live.length} / ${positions.length}`} />
            <Kpi label="Net delta (units)" value={fn(calc.book.total.delta, 0)} sub={`₹ ${fn(calc.book.total.deltaValue, 0)}`} />
            <Kpi label={`Beta-weighted delta (${cfg.bench})`} value={fn(calc.book.total.betaDelta, 1)} sub={`₹ ${fn(calc.book.total.betaDeltaValue, 0)}`} />
            <Kpi label="Gamma" value={calc.book.total.gamma.toFixed(3)} /><Kpi label="Theta / day" value={fn(calc.book.total.theta, 0)} /><Kpi label="Vega / pt" value={fn(calc.book.total.vega, 0)} />
            <Kpi label="Last session P&L" value={fn(calc.dayPnl, 0)} cls={calc.dayPnl >= 0 ? "pos" : "neg"} />
            <Kpi label="Margin (estimate)" value={fn(calc.margin.total, 0)} sub={calc.margin.utilisation != null ? `${pc(calc.margin.utilisation)} of collateral` : ""} />
          </div>
          <Tabs value={tab} onChange={setTab} tabs={[{ value: "greeks", label: "Greeks" }, { value: "attr", label: "P&L attribution" }, { value: "stress", label: "Stress test" }, { value: "var", label: "VaR & ES" }, { value: "hedge", label: "Hedges" }, { value: "margin", label: "Margin & what-if" }, { value: "limits", label: "Limits" }, { value: "size", label: "Position sizing" }]} />
          {tab === "greeks" && <Greeks calc={calc} bench={cfg.bench} />}
          {tab === "attr" && <Attribution calc={calc} />}
          {tab === "stress" && <Stress calc={calc} chains={loaded.data.chains} />}
          {tab === "var" && <VarPanel calc={calc} chains={loaded.data.chains} cfg={cfg} set={set} />}
          {tab === "hedge" && <Hedges calc={calc} bench={cfg.bench} />}
          {tab === "margin" && <Margin calc={calc} chains={loaded.data.chains} positions={positions} capital={cfg.capital} />}
          {tab === "limits" && <Limits calc={calc} cfg={cfg} set={set} />}
          {tab === "size" && <Sizing calc={calc} chains={loaded.data.chains} capital={cfg.capital} />}
        </>}
      </DerivGate>
    </div>
  );
}

function Greeks({ calc, bench }) {
  return (
    <div className="card">
      <div className="h3">By position<Tag k="calc" /></div>
      <DataTable rows={calc.book.rows.map((r) => ({ ...r, id: r.id }))} exportName="portfolio-greeks-beta" columns={[
        { key: "n", label: "Position", value: (r) => r.name }, { key: "u", label: "Underlying", value: (r) => r.und },
        { key: "b", label: `Beta to ${bench}`, num: true, value: (r) => r.beta, render: (r) => (r.missing ? "no data" : <span title={r.betaEstimated ? "fewer than 20 shared sessions: beta set to 1" : ""}>{r.beta?.toFixed(2)}{r.betaEstimated ? "*" : ""}</span>) },
        { key: "d", label: "Delta", num: true, value: (r) => r.g?.delta, render: (r) => fn(r.g?.delta, 1) }, { key: "bd", label: "β-delta (index units)", num: true, value: (r) => r.betaDelta, render: (r) => fn(r.betaDelta, 1) },
        { key: "g", label: "Gamma", num: true, value: (r) => r.g?.gamma, render: (r) => r.g?.gamma?.toFixed(4) }, { key: "t", label: "Theta", num: true, value: (r) => r.g?.theta, render: (r) => fn(r.g?.theta, 0) },
        { key: "v", label: "Vega", num: true, value: (r) => r.g?.vega, render: (r) => fn(r.g?.vega, 0) }, { key: "rho", label: "Rho", num: true, value: (r) => r.g?.rho, render: (r) => fn(r.g?.rho, 0) },
        { key: "l", label: "Legs", value: (r) => r.legs.map(legLabel).join(" · ") },
      ]} />
      <p className="legend-note">Beta-weighted delta = delta × spot × beta ÷ benchmark spot: how many units of the benchmark index move like the position. Beta is the OLS slope of daily moves on the benchmark over the stored F&O sessions (* = too few sessions, set to 1).</p>
    </div>
  );
}

function Attribution({ calc }) {
  if (!calc.attrib.length) return <Empty>Attribution needs the previous session's chain for each underlying; it appears once two sessions are stored.</Empty>;
  const tot = calc.attrib.reduce((a, x) => { for (const k of Object.keys(x.parts)) a[k] = (a[k] || 0) + x.parts[k]; a.residual += x.residual; a.actual += x.actual; return a; }, { residual: 0, actual: 0 });
  return (
    <div className="card">
      <div className="h3">What moved the P&L between the last two sessions<Tag k="calc" /></div>
      <div className="kpis">{["delta", "gamma", "theta", "vega", "rho"].map((k) => <Kpi key={k} label={k} value={fn(tot[k], 0)} cls={tot[k] >= 0 ? "pos" : "neg"} />)}<Kpi label="Residual" value={fn(tot.residual, 0)} /><Kpi label="Actual" value={fn(tot.actual, 0)} cls={tot.actual >= 0 ? "pos" : "neg"} /></div>
      <DataTable rows={calc.attrib} exportName="pnl-attribution" columns={[
        { key: "n", label: "Position", value: (a) => a.name }, { key: "f", label: "From → to", value: (a) => `${a.from} → ${a.to}` },
        { key: "ds", label: "Spot move", num: true, value: (a) => a.dS, render: (a) => fn(a.dS, 1) }, { key: "di", label: "IV change (pts)", num: true, value: (a) => a.dIv, render: (a) => (a.dIv * 100).toFixed(2) },
        ...["delta", "gamma", "theta", "vega", "rho"].map((k) => ({ key: k, label: k, num: true, value: (a) => a.parts[k], render: (a) => fn(a.parts[k], 0) })),
        { key: "r", label: "Residual", num: true, value: (a) => a.residual, render: (a) => fn(a.residual, 0) }, { key: "a", label: "Actual", num: true, value: (a) => a.actual, render: (a) => <span className={a.actual >= 0 ? "pos" : "neg"}>{fn(a.actual, 0)}</span> },
      ]} />
      <p className="legend-note">{calc.attrib[0].note}</p>
    </div>
  );
}

function Grid({ g, shocks }) {
  return (
    <div className="tbl-wrap"><table className="tbl chain">
      <thead><tr><th>IV shift</th>{shocks.map((s) => <th key={s}>{s >= 0 ? "+" : ""}{(s * 100).toFixed(0)}%</th>)}</tr></thead>
      <tbody>{g.map((r) => <tr key={r.ivShift}><td>{r.ivShift >= 0 ? "+" : ""}{(r.ivShift * 100).toFixed(0)}%</td>{r.cells.map((c) => <td key={c.shock} className={`num ${c.pnl >= 0 ? "pos" : "neg"}`}>{fn(c.pnl, 0)}</td>)}</tr>)}</tbody>
    </table></div>
  );
}

function Stress({ calc, chains }) {
  const [mode, setMode] = useState("beta");
  const [days, setDays] = useState(0);
  const st = useMemo(() => stressPortfolio(calc.live, chains, { betas: calc.betas, days }), [calc, chains, days]);
  const worst = Math.min(...(mode === "beta" ? st.betaScaled : st.corrBreakdown).flatMap((r) => r.cells.map((c) => c.pnl)));
  return (
    <div className="card">
      <div className="row wrap" style={{ gap: 10 }}>
        <Seg value={mode} onChange={setMode} options={[{ value: "beta", label: "Beta-scaled moves" }, { value: "corr", label: "Correlation breakdown" }]} />
        <label className="small muted">After <input type="number" min={0} max={60} value={days} onChange={(e) => setDays(Math.max(0, +e.target.value || 0))} style={{ width: 55 }} /> days</label>
        <Badge kind="r">worst cell {fn(worst, 0)}</Badge><Tag k="est" />
      </div>
      <Grid g={mode === "beta" ? st.betaScaled : st.corrBreakdown} shocks={st.spotShocks} />
      <p className="legend-note">{st.note}</p>
    </div>
  );
}

function VarPanel({ calc, chains, cfg, set }) {
  const [horizon, setHorizon] = useState(1);
  const v = useMemo(() => portfolioVar(calc.live, chains, calc.rets, { conf: cfg.conf, corrScale: cfg.corrScale, horizonDays: horizon, sims: 2000 }), [calc, chains, cfg.conf, cfg.corrScale, horizon]);
  useEffect(() => { if (v) logAi("risk", "risk", { params: { conf: cfg.conf, corrScale: cfg.corrScale, horizon }, features: { positions: calc.live.map((p) => ({ und: p.und, legs: p.legs })), sessions: v.sessions }, output: { parametric: v.parametric, historical: { var: v.historical.var, es: v.historical.es }, monteCarlo: { var: v.monteCarlo.var, es: v.monteCarlo.es } } }); }, [v]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!v) return <Empty>VaR needs stored history for the positions' underlyings.</Empty>;
  return (
    <div className="card">
      <div className="row wrap" style={{ gap: 10 }}>
        <Seg value={cfg.conf} onChange={(c) => set({ conf: c })} options={[{ value: 0.95, label: "95%" }, { value: 0.99, label: "99%" }]} />
        <Seg value={horizon} onChange={setHorizon} options={[{ value: 1, label: "1 day" }, { value: 5, label: "5 days" }, { value: 10, label: "10 days" }]} />
        <label className="small muted">Correlation × <input type="range" min={0} max={1.5} step={0.1} value={cfg.corrScale} onChange={(e) => set({ corrScale: +e.target.value })} /> {cfg.corrScale.toFixed(1)}</label>
        <Tag k="est" />
      </div>
      <table className="tbl compact" style={{ marginTop: 8 }}>
        <thead><tr><th>Method</th><th className="num">VaR</th><th className="num">Expected shortfall</th><th>Basis</th></tr></thead>
        <tbody>
          <tr><td>Parametric (delta-gamma)</td><td className="num">{fn(v.parametric.var, 0)}</td><td className="num">{fn(v.parametric.es, 0)}</td><td className="small muted">normal moves from the covariance</td></tr>
          <tr><td>Historical</td><td className="num">{fn(v.historical.var, 0)}</td><td className="num">{fn(v.historical.es, 0)}</td><td className="small muted">{v.historical.n} stored joint moves, full revaluation</td></tr>
          <tr><td>Monte Carlo</td><td className="num">{fn(v.monteCarlo.var, 0)}</td><td className="num">{fn(v.monteCarlo.es, 0)}</td><td className="small muted">{v.monteCarlo.sims} correlated draws, seed {v.monteCarlo.seed}</td></tr>
        </tbody>
      </table>
      <p className="legend-note">{v.assumptions} Expected shortfall is the average loss beyond the VaR level. Underlyings: {v.underlyings.join(", ")}.</p>
    </div>
  );
}

function Hedges({ calc, bench }) {
  const perUnd = useMemo(() => { const m = new Map(); for (const r of calc.book.rows.filter((x) => !x.missing)) { const a = m.get(r.und) || { und: r.und, delta: 0, lot: r.lot }; a.delta += r.g.delta; m.set(r.und, a); } return [...m.values()]; }, [calc]);
  const ideas = hedgeIdeas({ betaDelta: calc.book.total.betaDelta, vega: calc.book.total.vega, bench: calc.bench ? { und: bench, lot: calc.bench.lot, chain: calc.bench } : null, perUnd: perUnd.filter((u) => u.und !== bench) });
  return (
    <div className="card">
      <div className="h3">Hedge ideas<Tag k="calc" /></div>
      {ideas.map((h, i) => <div key={i} className="small" style={{ marginBottom: 4 }}><Badge kind={h.kind === "vega" ? "a" : h.kind === "delta" ? "b" : ""}>{h.kind}</Badge> {h.text}</div>)}
      <p className="legend-note">Sizes come from today's Greeks and change as spot, time and IV move. A suggestion, not an instruction; nothing is traded.</p>
    </div>
  );
}

function Margin({ calc, chains, positions, capital }) {
  const [pid, setPid] = useState("");
  const proposed = positions.find((p) => p.id === pid);
  const mm = useMemo(() => marginMonitor(calc.live.filter((p) => p.id !== pid), chains, { capital, proposed }), [calc, chains, capital, pid, proposed]);
  return (
    <div className="card">
      <div className="row wrap" style={{ gap: 10 }}><div className="h3">Margin use<Tag k="est" /></div><Select label="What-if: add" value={pid} onChange={setPid} options={positions.map((p) => ({ value: p.id, label: p.name }))} allowEmpty="(nothing)" /></div>
      <DataTable compact rows={mm.rows} exportName="margin-monitor" columns={[{ key: "n", label: "Position", value: (r) => r.name }, { key: "u", label: "Underlying", value: (r) => r.und }, { key: "m", label: "Margin (estimate)", num: true, value: (r) => r.margin, render: (r) => fn(r.margin, 0) }]} />
      <div className="kpis" style={{ marginTop: 8 }}>
        <Kpi label="Total" value={fn(mm.total, 0)} /><Kpi label="Collateral" value={fn(capital, 0)} /><Kpi label="Utilisation" value={pc(mm.utilisation)} />
        {mm.whatIf && <><Kpi label="Proposed alone" value={fn(mm.whatIf.alone, 0)} /><Kpi label="Incremental margin" value={fn(mm.whatIf.incremental, 0)} /><Kpi label="Hedge benefit" value={fn(mm.whatIf.benefit, 0)} cls={mm.whatIf.benefit >= 0 ? "pos" : "neg"} /><Kpi label="Total after" value={fn(mm.whatIf.totalAfter, 0)} /></>}
      </div>
      <p className="legend-note">{mm.label}. Exact SPAN + exposure margin needs the exchange's SPAN risk-parameter file and a licensed calculator; this stresses each underlying's combined legs, so spread and hedge benefits show up as a lower incremental margin.</p>
    </div>
  );
}

function Limits({ calc, cfg, set }) {
  const breaches = checkLimits(calc.book, cfg.limits, { capital: cfg.capital, dayPnl: calc.dayPnl, margin: calc.margin.total });
  const [overridden, setOverridden] = useState({});
  const L = cfg.limits;
  const setL = (k, v) => set({ limits: { ...L, [k]: v } });
  const hard = new Set(L.hard || []);
  return (
    <div className="grid g2">
      <div className="card">
        <div className="h3">Limits</div>
        <table className="tbl compact"><thead><tr><th>Limit</th><th>Value</th><th>Hard</th></tr></thead><tbody>
          {Object.keys(LIMIT_LABEL).map((k) => <tr key={k}><td>{LIMIT_LABEL[k]}</td>
            <td><input type="number" step="any" value={L[k] == null ? "" : PCT_LIMITS.has(k) ? +(L[k] * 100).toFixed(2) : L[k]} placeholder="off" onChange={(e) => setL(k, e.target.value === "" ? null : PCT_LIMITS.has(k) ? +e.target.value / 100 : +e.target.value)} style={{ width: 100 }} />{PCT_LIMITS.has(k) ? " %" : ""}</td>
            <td><Check checked={hard.has(k)} onChange={(x) => setL("hard", x ? [...hard, k] : [...hard].filter((y) => y !== k))} /></td></tr>)}
        </tbody></table>
        <p className="legend-note">Soft limits warn. A hard-limit breach stays flagged in red until it is cleared or overridden with a written reason; every override is written to the append-only audit log.</p>
      </div>
      <div className="card">
        <div className="h3">Breaches now</div>
        {!breaches.length ? <div className="small">No limit is breached.</div> : breaches.map((b) => (
          <div key={b.key + b.msg} className="row between small" style={{ marginBottom: 6 }}>
            <span><Badge kind={b.level === "hard" ? "r" : "a"}>{b.level}</Badge> {b.msg}</span>
            {b.level === "hard" && (overridden[b.key] ? <Badge>overridden (logged)</Badge> : <button className="btn sm" onClick={() => { const why = prompt("Reason for overriding this hard limit (kept in the audit log)"); if (!why) return; logRisk("risk_override", { limit: b.key, message: b.msg, value: b.value, limit_value: b.limit, reason: why }); setOverridden({ ...overridden, [b.key]: true }); }}>Override…</button>)}
          </div>
        ))}
      </div>
    </div>
  );
}

function Sizing({ calc, chains, capital }) {
  const [method, setMethod] = useState("fixedFractional");
  const [pid, setPid] = useState(calc.live[0]?.id || "");
  const [p, setP] = useState({ riskPct: 0.01, targetDailyPct: 0.005, winRate: 0.55, payoffRatio: 1.2, fraction: 0.25, budget: { delta: 500, vega: 5000, gamma: 50 } });
  const pos = calc.live.find((x) => x.id === pid);
  const ch = pos ? chains[pos.und] : null;
  const per = useMemo(() => {
    if (!pos || !ch) return null;
    const lots = Math.max(1, Math.max(...pos.legs.map((l) => l.qty)));
    const unit = pos.legs.map((l) => ({ ...l, qty: l.qty / lots }));
    const m = strategyMetrics(unit, ch);
    const hist = calc.rets[pos.und] || [];
    const annVol = hist.length > 10 ? Math.sqrt(hist.reduce((a, x) => a + x * x, 0) / hist.length * 252) : m.iv;
    return { m, annVol, maxLossPerLot: Number.isFinite(m.maxLoss) ? -m.maxLoss : null, deltaPerLot: m.greeks.delta, greeks: m.greeks };
  }, [pos, ch, calc.rets]);
  const res = per ? sizing(method, { capital, ...p, maxLossPerLot: per.maxLossPerLot, deltaPerLot: per.deltaPerLot, spot: ch.spot, annVol: per.annVol, per: { delta: per.greeks.delta, vega: per.greeks.vega, gamma: per.greeks.gamma } }) : null;
  const inp = (k, label, scale = 1, step = "any") => <label className="small muted">{label} <input type="number" step={step} value={+(p[k] * scale).toFixed(4)} onChange={(e) => setP({ ...p, [k]: (+e.target.value || 0) / scale })} style={{ width: 80 }} /></label>;
  return (
    <div className="card stack">
      <div className="row wrap" style={{ gap: 10 }}>
        <Select label="Structure" value={pid} onChange={setPid} options={calc.live.map((x) => ({ value: x.id, label: x.name }))} />
        <Select label="Method" value={method} onChange={setMethod} options={Object.entries(SIZING_METHODS).map(([k, v]) => ({ value: k, label: v.split(":")[0] }))} />
      </div>
      <div className="small muted">{SIZING_METHODS[method]}</div>
      <div className="row wrap" style={{ gap: 10 }}>
        {method === "fixedFractional" && inp("riskPct", "Risk per trade %", 100)}
        {method === "volTarget" && inp("targetDailyPct", "Target daily vol % of capital", 100)}
        {method === "kelly" && <>{inp("winRate", "Win rate %", 100)}{inp("payoffRatio", "Avg win / avg loss")}{inp("fraction", "Kelly fraction (e.g. 0.25)")}</>}
        {method === "greekBudget" && ["delta", "vega", "gamma"].map((k) => <label key={k} className="small muted">{k} budget <input type="number" value={p.budget[k]} onChange={(e) => setP({ ...p, budget: { ...p.budget, [k]: +e.target.value || 0 } })} style={{ width: 80 }} /></label>)}
      </div>
      {per && <div className="small">Per lot: max loss {per.maxLossPerLot == null ? "unlimited" : fn(per.maxLossPerLot, 0)}, delta {fn(per.deltaPerLot, 1)}, vega {fn(per.greeks.vega, 0)}, gamma {per.greeks.gamma.toFixed(4)}; underlying volatility {pc(per.annVol, 1)} a year.</div>}
      {res && <div className="kpis"><Kpi label="Suggested size" value={res.lots == null ? "—" : `${res.lots} lot${res.lots === 1 ? "" : "s"}`} sub={res.detail} /><Tag k="calc" /></div>}
      {method !== "greekBudget" && per && per.maxLossPerLot == null && <div className="note warn small">This structure's loss is open-ended, so loss-based sizing cannot cap it; use a volatility target or a Greek budget, or add a protective leg.</div>}
    </div>
  );
}
