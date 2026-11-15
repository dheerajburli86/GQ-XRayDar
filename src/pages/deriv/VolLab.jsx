// Volatility & pricing lab: smile / skew with an SVI fit, surface grid, term
// structure and forward vol, realised-volatility estimators, IV rank /
// percentile, cones, the volatility risk premium, regimes, a statistical IV
// projection, event IV crush and the pricing-model comparison.
import { useMemo, useState } from "react";
import { PageHead, Kpi, Tabs, Select, Seg, Badge, Loading } from "../../components/ui.jsx";
import { DataTable } from "../../components/DataTable.jsx";
import { XYChart } from "../../components/XYChart.jsx";
import { TvChart, lineData } from "../../components/TvChart.jsx";
import { useAsync } from "../../lib/useAsync.js";
import { navigate } from "../../lib/router.js";
import { useData } from "../../data/store.jsx";
import { useDerivRows, DerivGate, UndSelect, DataNote, fp, fn, fiv, useUnderlyingSec } from "./common.jsx";
import { enrichChain, smile, fitSvi, skewMetrics, termStructure, surfaceGrid, atmIv } from "../../../engine/deriv/chain.js";
import { realisedVol, RV_METHODS, ivRank, volCone, vrp, volRegime, ivAlerts, ivForecast, eventCrush } from "../../../engine/deriv/volatility.js";
import { priceOption, MODEL_INFO } from "../../../engine/deriv/pricing.js";

export default function VolLab({ route }) {
  const d = useData();
  const { api, status, rows, loading, error } = useDerivRows();
  const und = route.query.und || rows?.find((r) => r.und === "NIFTY")?.und || rows?.[0]?.und;
  const row = rows?.find((r) => r.und === und);
  const secOf = useUnderlyingSec();
  const sec = row ? secOf(und, row.kind) : null;
  const [tab, setTab] = useState("smile");
  const day = useAsync(() => (und ? api.chain(und) : Promise.resolve(null)), [und]);
  const hist = useAsync(() => (und ? api.history(und) : Promise.resolve([])), [und]);
  const bars = useAsync(() => (sec ? d.api.bars(sec.id) : Promise.resolve(null)), [sec?.id]);
  const snap = useAsync(() => (sec && row?.kind === "stock" ? d.api.snapshot(sec.id) : Promise.resolve(null)), [sec?.id]);
  const chain = useMemo(() => (day.data ? enrichChain(day.data) : null), [day.data]);
  // Underlying bars: the heatmap's OHLC when the underlying is mapped, else the stored spot series (close only).
  const b = useMemo(() => {
    if (bars.data?.close?.length > 30) return { ...bars.data, ohlc: true };
    const h = hist.data || [];
    const c = h.map((x) => x.spot);
    return h.length ? { time: h.map((x) => x.date), open: c, high: c, low: c, close: c, ohlc: false } : null;
  }, [bars.data, hist.data]);
  return (
    <div className="stack">
      <PageHead title="Volatility & pricing lab" sub="Smile, skew, surface and term structure from the chain; realised volatility, IV rank, cones and the volatility risk premium from history." />
      <DerivGate status={status} loading={loading} error={error}>
        <div className="card row wrap" style={{ gap: 10 }}><UndSelect rows={rows} value={und} onChange={(u) => navigate("dvol", { und: u })} /><span className="small muted">{b?.ohlc ? "Realised vol from the underlying's OHLC bars" : "Realised vol from the stored spot series (close-to-close only)"}</span></div>
        <DataNote status={status} />
        <Tabs value={tab} onChange={setTab} tabs={[{ value: "smile", label: "Smile & skew" }, { value: "surface", label: "Surface & term structure" }, { value: "rv", label: "Realised vol & cones" }, { value: "ivr", label: "IV rank, VRP & regime" }, { value: "models", label: "Pricing models" }]} />
        {(day.loading || hist.loading) && <Loading />}
        {chain && tab === "smile" && <Smile chain={chain} />}
        {chain && tab === "surface" && <Surface chain={chain} />}
        {b && tab === "rv" && <Realised b={b} />}
        {hist.data && tab === "ivr" && <IvRank hist={hist.data} b={b} results={(snap.data?.f?.results || []).map((x) => x.filed).filter(Boolean)} />}
        {chain && tab === "models" && <Models chain={chain} />}
      </DerivGate>
    </div>
  );
}

function Smile({ chain }) {
  const exps = chain.expiries.filter((e) => e.rows.length >= 5);
  const [exp, setExp] = useState(exps[0]?.expiry);
  const ex = exps.find((e) => e.expiry === exp) || exps[0];
  const sm = smile(ex), svi = fitSvi(ex), sk = skewMetrics(ex);
  return (
    <div className="stack">
      <div className="card">
        <Select value={ex.expiry} onChange={setExp} options={exps.map((e) => ({ value: e.expiry, label: `${e.expiry} (${e.dte}d)` }))} label="Expiry" />
        <XYChart height={280} series={[{ name: "Market IV (OTM side)", type: "line", color: "#2563eb", points: sm.map((p) => ({ x: p.strike, y: p.iv * 100 })) }].concat(svi ? [{ name: "SVI fit", type: "line", color: "#d97706", dash: "5 3", points: svi.fitted.filter((p) => p.iv).map((p) => ({ x: p.strike, y: p.iv * 100 })) }] : [])}
          markers={[{ x: chain.spot, label: "spot" }, { x: ex.F, label: "forward", color: "#64748b" }]} xLabel="strike" yLabel="IV %" />
        <div className="kpis" style={{ border: 0 }}>
          <Kpi label="ATM IV" value={fiv(sk.atm)} /><Kpi label="25Δ put IV" value={fiv(sk.p25)} /><Kpi label="25Δ call IV" value={fiv(sk.c25)} />
          <Kpi label="25Δ skew (put − call)" value={sk.skew25 != null ? `${(sk.skew25 * 100).toFixed(2)} pts` : "—"} /><Kpi label="25Δ butterfly" value={sk.fly25 != null ? `${(sk.fly25 * 100).toFixed(2)} pts` : "—"} />
          <Kpi label="10Δ wing (put − call)" value={sk.wing10 != null ? `${(sk.wing10 * 100).toFixed(2)} pts` : "—"} />
        </div>
        {svi && <p className="small">SVI raw parameters a {svi.params.a.toFixed(5)}, b {svi.params.b.toFixed(4)}, ρ {svi.params.rho.toFixed(3)}, m {svi.params.m.toFixed(4)}, σ {svi.params.sigma.toFixed(4)} · fit RMSE {svi.rmse.toExponential(2)} (total variance) · {svi.butterflyArbFree ? <Badge kind="g">no butterfly arbitrage</Badge> : <Badge kind="r">butterfly arbitrage in the fit</Badge>}</p>}
        <p className="legend-note">The smile uses out-of-the-money contracts (puts below the forward, calls above), which are the traded side. SVI (stochastic-volatility-inspired) smooths the smile for interpolation; the arbitrage check uses Durrleman's condition on the fitted curve.</p>
      </div>
    </div>
  );
}

function Surface({ chain }) {
  const g = surfaceGrid(chain), ts = termStructure(chain);
  const all = g.flatMap((r) => r.cells).filter((x) => x != null), lo = Math.min(...all), hi = Math.max(...all);
  const col = (v) => (v == null ? "transparent" : `hsl(${220 - ((v - lo) / (hi - lo || 1)) * 220}, 70%, 45%)`);
  return (
    <div className="stack">
      <div className="card">
        <div className="h3">IV surface: expiry × strike / forward</div>
        <div className="tbl-wrap"><table className="tbl chain">
          <thead><tr><th>Expiry</th><th>DTE</th>{g[0]?.buckets.map((b) => <th key={b}>{(b * 100).toFixed(1)}%</th>)}</tr></thead>
          <tbody>{g.map((r) => <tr key={r.expiry}><td>{r.expiry}</td><td className="num">{r.dte}</td>{r.cells.map((v, i) => <td key={i} className="num" style={{ background: col(v), color: v == null ? undefined : "#fff" }}>{v == null ? "" : (v * 100).toFixed(1)}</td>)}</tr>)}</tbody>
        </table></div>
        <p className="legend-note">Each cell is IV interpolated linearly across listed strikes at that moneyness; blank = outside the listed range. Colour runs from low (blue) to high (red) IV.</p>
      </div>
      <div className="card">
        <div className="h3">Term structure and forward volatility</div>
        <XYChart height={220} series={[{ name: "ATM IV %", type: "line", color: "#2563eb", points: ts.points.map((p) => ({ x: p.dte, y: p.iv * 100 })) }, { name: "Forward vol %", type: "line", color: "#d97706", dash: "4 3", points: ts.points.filter((p) => p.fwdVol).map((p) => ({ x: p.dte, y: p.fwdVol * 100 })) }]} xLabel="days to expiry" />
        {ts.inverted && <div className="note warn small">Inverted: near-term IV above the next expiry.</div>}
        {ts.points.some((p) => p.fwdNegative) && <div className="note warn small">Total variance falls between two expiries (negative forward variance): a calendar inconsistency in end-of-day prices.</div>}
      </div>
    </div>
  );
}

function Realised({ b }) {
  const methods = b.ohlc ? Object.keys(RV_METHODS) : ["cc"];
  const [m, setM] = useState("cc");
  const wins = [10, 20, 60, 120];
  const rows = methods.map((k) => ({ id: k, method: RV_METHODS[k], ...Object.fromEntries(wins.map((w) => [w, realisedVol(b, w, k)])) }));
  const cone = volCone(b, [10, 20, 40, 60, 120, 252], m);
  return (
    <div className="stack">
      <div className="card">
        <DataTable compact rows={rows} exportName="realised-vol" columns={[{ key: "m", label: "Estimator", value: (r) => r.method }, ...wins.map((w) => ({ key: String(w), label: `${w} sessions`, num: true, value: (r) => r[w], render: (r) => fiv(r[w]) }))]} />
        <p className="legend-note">Close-to-close uses closes only; Parkinson uses the high-low range; Garman-Klass adds open and close; Yang-Zhang also handles overnight gaps. All annualised with 252 sessions.</p>
      </div>
      <div className="card">
        <div className="row between"><div className="h3">Volatility cone</div>{methods.length > 1 && <Seg value={m} onChange={setM} options={methods.map((k) => ({ value: k, label: RV_METHODS[k].split(" ")[0] }))} />}</div>
        <XYChart height={260} series={[["0.05", "#94a3b8"], ["0.25", "#64748b"], ["0.5", "#2563eb"], ["0.75", "#64748b"], ["0.95", "#94a3b8"]].map(([p, c]) => ({ name: `${Math.round(+p * 100)}th pct`, type: "line", color: c, dash: p === "0.5" ? undefined : "4 3", points: cone.filter((x) => x.bands).map((x) => ({ x: x.n, y: x.bands[p] * 100 })) })).concat([{ name: "Current", type: "line", color: "#dc2626", width: 2.5, points: cone.filter((x) => x.current).map((x) => ({ x: x.n, y: x.current * 100 })) }])} xLabel="window (sessions)" yLabel="vol %" />
      </div>
    </div>
  );
}

function IvRank({ hist, b, results }) {
  const [lb, setLb] = useState(252);
  const ivs = hist.map((h) => h.atmIv), dates = hist.map((h) => h.date);
  const ir = ivRank(ivs, lb), reg = volRegime(ir.percentile), al = ivAlerts(ivs), fc = ivForecast(ivs, 5);
  const vr = b ? vrp(ivs, dates, b, 20) : null;
  const crush = results.length ? eventCrush(dates, ivs, results) : [];
  return (
    <div className="stack">
      <div className="kpis">
        <Kpi label="ATM IV now" value={fiv(ir.cur)} sub={dates.at(-1)} />
        <Kpi label="IV rank" value={ir.rank != null ? Math.round(ir.rank * 100) : "—"} sub={`range ${fiv(ir.lo)}–${fiv(ir.hi)}`} />
        <Kpi label="IV percentile" value={ir.percentile != null ? Math.round(ir.percentile * 100) : "—"} sub={`over ${ir.n} sessions (look-back ${lb})`} />
        <Kpi label="Regime" value={reg.label} />
        <Kpi label="VRP (IV − 20d RV)" value={vr?.rows.at(-1)?.vrpTrailing != null ? `${(vr.rows.at(-1).vrpTrailing * 100).toFixed(1)} pts` : "—"} />
      </div>
      <div className="card">
        <Seg value={lb} onChange={setLb} options={[{ value: 63, label: "3M look-back" }, { value: 126, label: "6M" }, { value: 252, label: "1Y" }]} />
        {ir.n < lb && <p className="small muted">Only {ir.n} sessions are stored so far; rank and percentile use what exists and become comparable to a full {lb}-session look-back as history builds.</p>}
        {al.map((a) => <div key={a} className="note small">{a}</div>)}
        <TvChart height={240} series={[{ id: "iv", type: "line", data: lineData(dates, ivs.map((x) => (x != null ? x * 100 : null))).filter((p) => p.value != null), options: { color: "#db2777", title: "ATM IV" } }, { id: "rv", type: "line", data: lineData(dates, hist.map((h) => (h.rv20 != null ? h.rv20 * 100 : null))).filter((p) => p.value != null), options: { color: "#64748b", title: "20d RV" } }]} />
      </div>
      {vr && <div className="card"><div className="h3">Volatility risk premium</div>
        <p className="small">{vr.sellerRegime || "Not enough completed windows yet."} {vr.avgSubsequent != null ? `Average IV minus the volatility realised over the following 20 sessions: ${(vr.avgSubsequent * 100).toFixed(1)} pts.` : ""}</p>
        <TvChart height={200} series={[{ id: "v", type: "histogram", data: vr.rows.filter((x) => x.vrpTrailing != null).map((x) => ({ time: x.date, value: x.vrpTrailing * 100, color: x.vrpTrailing >= 0 ? "#16a34a" : "#dc2626" })) }]} />
      </div>}
      {fc && <div className="card"><div className="h3">Short-term IV projection (statistical)</div>
        <p className="small">AR(1) mean reversion on log IV fitted to {fc.n} sessions: long-run level {fiv(fc.longRun)}, half-life {fc.halfLife ? `${fc.halfLife.toFixed(1)} sessions` : "—"}. It projects the pull toward the average, not events.</p>
        <DataTable compact rows={fc.path.map((p) => ({ ...p, id: p.step }))} exportName="iv-projection" columns={[{ key: "s", label: "Sessions ahead", num: true, value: (p) => p.step }, { key: "i", label: "IV", num: true, value: (p) => p.iv, render: (p) => fiv(p.iv) }, { key: "l", label: "−1 sd", num: true, value: (p) => p.lo, render: (p) => fiv(p.lo) }, { key: "h", label: "+1 sd", num: true, value: (p) => p.hi, render: (p) => fiv(p.hi) }]} />
      </div>}
      {crush.length > 0 && <div className="card"><div className="h3">Results and IV crush</div>
        <DataTable compact rows={crush.map((c) => ({ ...c, id: c.event }))} exportName="iv-crush" columns={[{ key: "e", label: "Results filed", value: (c) => c.event }, { key: "b", label: "IV before", num: true, value: (c) => c.before, render: (c) => fiv(c.before) }, { key: "a", label: "IV after", num: true, value: (c) => c.after, render: (c) => fiv(c.after) }, { key: "c", label: "Change", num: true, value: (c) => c.change, render: (c) => fp(c.change) }]} />
      </div>}
    </div>
  );
}

function Models({ chain }) {
  const ex = chain.expiries.find((e) => e.rows.length >= 5) || chain.expiries[0];
  const K = ex.rows.reduce((b, x) => (Math.abs(x.strike - ex.F) < Math.abs(b - ex.F) ? x.strike : b), ex.rows[0].strike);
  const [strike, setStrike] = useState(K);
  const [cp, setCp] = useState(1);
  const [v, setV] = useState(Math.round((atmIv(ex) || 0.2) * 1000) / 10);
  const [q, setQ] = useState(0);
  const r = 0.065, iv = v / 100;
  const rows = [["BSM", { cp, S: chain.spot, K: strike, T: ex.T, r, q, v: iv }], ["BLACK76", { cp, S: chain.spot, F: ex.F, K: strike, T: ex.T, r, v: iv }], ["CRR", { cp, S: chain.spot, K: strike, T: ex.T, r, q, v: iv, american: true, steps: 300 }], ["TRINOMIAL", { cp, S: chain.spot, K: strike, T: ex.T, r, q, v: iv, american: true, steps: 200 }], ["BAW", { cp, S: chain.spot, K: strike, T: ex.T, r, q, v: iv }], ["BACHELIER", { cp, S: chain.spot, F: ex.F, K: strike, T: ex.T, r, v: iv * ex.F }]]
    .map(([m, inp]) => ({ id: m, model: MODEL_INFO[m], ...priceOption(m, inp) }));
  const mkt = ex.rows.find((x) => x.strike === strike)?.[cp > 0 ? "ce" : "pe"]?.px;
  return (
    <div className="card">
      <div className="row wrap" style={{ gap: 10 }}>
        <Seg value={cp} onChange={setCp} options={[{ value: 1, label: "Call" }, { value: -1, label: "Put" }]} />
        <Select value={strike} onChange={(x) => setStrike(+x)} options={ex.rows.map((x) => ({ value: x.strike, label: String(x.strike) }))} label="Strike" />
        <label className="small muted">IV % <input type="number" step="0.5" value={v} onChange={(e) => setV(+e.target.value || 0)} style={{ width: 70 }} /></label>
        <label className="small muted">Dividend yield % <input type="number" step="0.1" value={q * 100} onChange={(e) => setQ((+e.target.value || 0) / 100)} style={{ width: 70 }} /></label>
        <span className="small muted">Expiry {ex.expiry} · T {ex.T.toFixed(4)} y · spot {fn(chain.spot)} · forward {fn(ex.F)} · r 6.50% · market price {fn(mkt)}</span>
      </div>
      <DataTable compact rows={rows} exportName="model-comparison" columns={[{ key: "m", label: "Model", value: (x) => x.model }, { key: "p", label: "Price", num: true, value: (x) => x.price, render: (x) => x.price?.toFixed(2) }, ...["delta", "gamma", "theta", "vega"].map((k) => ({ key: k, label: k, num: true, value: (x) => x[k], render: (x) => (x[k] == null ? "—" : (+x[k]).toFixed(k === "gamma" ? 5 : 3)) }))]} />
      <p className="legend-note">Trees and BAW price American exercise (shown for comparison: NSE index and stock options are European). Bachelier uses an absolute volatility equal to IV × forward. Tree Greeks are numerical (finite differences).</p>
    </div>
  );
}
