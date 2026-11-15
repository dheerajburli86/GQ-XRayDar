// Derivatives research: how did the underlying behave after each kind of
// positioning / volatility signal (hit rates and forward returns from stored
// history), and how participant positioning lined up with the index.
import { useMemo, useState } from "react";
import { PageHead, Seg, Kpi, Tabs, Loading, Empty } from "../../components/ui.jsx";
import { DataTable } from "../../components/DataTable.jsx";
import { useAsync } from "../../lib/useAsync.js";
import { useDerivRows, DerivGate, DataNote, fp, pc, UndSelect, Tag } from "./common.jsx";
import { XYChart } from "../../components/XYChart.jsx";
import { derivCalibration, ivForecastAudit, psi, psiLabel } from "../../../engine/validation.js";

const SIGNALS = {
  long_buildup: { label: "Long build-up", test: (s) => s.buildup === "long_buildup", dir: 1 },
  short_buildup: { label: "Short build-up", test: (s) => s.buildup === "short_buildup", dir: -1 },
  short_covering: { label: "Short covering", test: (s) => s.buildup === "short_covering", dir: 1 },
  long_unwinding: { label: "Long unwinding", test: (s) => s.buildup === "long_unwinding", dir: -1 },
  pcr_high: { label: "PCR 2 sd above norm", test: (s) => s.pcrZ >= 2, dir: 1 },
  pcr_low: { label: "PCR 2 sd below norm", test: (s) => s.pcrZ <= -2, dir: -1 },
  ivr_high: { label: "IV rank ≥ 80", test: (s) => s.ivRank >= 0.8, dir: 0 },
  ivr_low: { label: "IV rank ≤ 20", test: (s) => s.ivRank <= 0.2, dir: 0 },
  put_write: { label: "Fresh OTM put writing heavier than call writing", test: (s) => s.otmPutWrite > 2 * (s.otmCallWrite || 0) && s.otmPutWrite > 0, dir: 1 },
  call_write: { label: "Fresh OTM call writing heavier than put writing", test: (s) => s.otmCallWrite > 2 * (s.otmPutWrite || 0) && s.otmCallWrite > 0, dir: -1 },
};

export default function DerivResearch() {
  const { api, status, rows, market, loading, error } = useDerivRows();
  const [tab, setTab] = useState("bt");
  return (
    <div className="stack">
      <PageHead title="Derivatives research" sub="Test derivatives signals against what the underlying did next, and compare participant positioning with the index." />
      <DerivGate status={status} loading={loading} error={error}>
        <DataNote status={status} />
        <Tabs value={tab} onChange={setTab} tabs={[{ value: "bt", label: "Signal backtest" }, { value: "part", label: "Participants vs index" }, { value: "cal", label: "Forecast calibration & drift" }]} />
        {tab === "bt" && <Backtest api={api} rows={rows} />}
        {tab === "part" && <PartVsIndex api={api} market={market} />}
        {tab === "cal" && <Calibration api={api} rows={rows} />}
      </DerivGate>
    </div>
  );
}

function Backtest({ api, rows }) {
  const [scope, setScope] = useState("index");
  const [h, setH] = useState(5);
  const [go, setGo] = useState(0);
  const unds = useMemo(() => {
    const r = (rows || []).filter((x) => (scope === "index" ? x.kind === "index" : x.kind === "stock"));
    return (scope === "index" ? r : r.sort((a, b) => (b.s.optTurnover || 0) - (a.s.optTurnover || 0)).slice(0, 40)).map((x) => x.und);
  }, [rows, scope]);
  const res = useAsync(async () => {
    if (!go) return null;
    const hists = await Promise.all(unds.map((u) => api.history(u)));
    const out = Object.fromEntries(Object.keys(SIGNALS).map((k) => [k, { n: 0, sum: 0, hit: 0, rets: [] }]));
    let base = { n: 0, sum: 0, up: 0 };
    for (const hist of hists) for (let i = 0; i + h < hist.length; i++) {
      const s = hist[i], fwd = hist[i + h].spot / s.spot - 1;
      if (!Number.isFinite(fwd)) continue;
      base.n++; base.sum += fwd; if (fwd > 0) base.up++;
      for (const [k, sig] of Object.entries(SIGNALS)) if (sig.test(s)) { const o = out[k]; o.n++; o.sum += fwd; o.rets.push(fwd); if (sig.dir === 0 ? Math.abs(fwd) > 0 : Math.sign(fwd) === sig.dir) o.hit++; }
    }
    return { base, rows: Object.entries(out).map(([k, o]) => ({ id: k, label: SIGNALS[k].label, dir: SIGNALS[k].dir, n: o.n, mean: o.n ? o.sum / o.n : null, hit: o.n ? o.hit / o.n : null, absMean: o.n ? o.rets.reduce((a, x) => a + Math.abs(x), 0) / o.n : null })), sessions: hists.reduce((a, x) => a + x.length, 0) };
  }, [go, h, scope]);
  const bm = res.data ? res.data.base.sum / (res.data.base.n || 1) : null;
  return (
    <div className="card">
      <div className="row wrap" style={{ gap: 10 }}>
        <Seg value={scope} onChange={setScope} options={[{ value: "index", label: "Index underlyings" }, { value: "stock", label: "40 most active stocks" }]} />
        <Seg value={h} onChange={setH} options={[{ value: 1, label: "Next session" }, { value: 5, label: "5 sessions" }, { value: 10, label: "10 sessions" }]} />
        <button className="btn sm primary" onClick={() => setGo((x) => x + 1)}>Run</button>
      </div>
      {!go ? <Empty>Pick a scope and horizon, then Run. Uses every stored session; results firm up as history builds.</Empty> : res.loading ? <Loading what="history" /> : res.data && (
        <>
          <div className="kpis" style={{ border: 0 }}>
            <Kpi label="Sessions tested" value={res.data.sessions} />
            <Kpi label={`Average ${h}-session move, all sessions`} value={fp(bm, 2)} sub={`up ${pc(res.data.base.up / (res.data.base.n || 1))} of the time`} />
          </div>
          <DataTable compact rows={res.data.rows} exportName="deriv-signal-backtest" columns={[
            { key: "l", label: "Signal (on the session)", value: (r) => r.label }, { key: "n", label: "Occurrences", num: true, value: (r) => r.n },
            { key: "m", label: `Avg move next ${h}`, num: true, value: (r) => r.mean, render: (r) => fp(r.mean, 2) },
            { key: "x", label: "vs all sessions", num: true, value: (r) => (r.mean != null ? r.mean - bm : null), render: (r) => fp(r.mean != null ? r.mean - bm : null, 2) },
            { key: "h", label: "Hit rate", num: true, value: (r) => r.hit, render: (r) => (r.dir === 0 ? `|move| avg ${fp(r.absMean, 2)}` : pc(r.hit)) },
          ]} />
          <p className="legend-note">Hit rate = share of occurrences where the underlying moved in the direction the signal reads (up for long build-up, down for short build-up, ...). Volatility signals have no direction, so their average absolute move is shown. Small samples are noisy: read the occurrence count first.</p>
        </>
      )}
    </div>
  );
}

function PartVsIndex({ api, market }) {
  const nifty = useAsync(() => api.history("NIFTY"), []);
  const [who, setWho] = useState("FII");
  const rows = useMemo(() => {
    if (!nifty.data || !market) return [];
    const spot = new Map(nifty.data.map((h, i) => [h.date, { s: h.spot, next: nifty.data[i + 1]?.spot }]));
    return market.filter((m) => m.participants?.length).map((m) => {
      const r = m.participants.find((x) => String(x.type).toUpperCase() === who.toUpperCase()) || {};
      const net = (r["Future Index Long"] || 0) - (r["Future Index Short"] || 0);
      const sp = spot.get(m.date);
      return { id: m.date, date: m.date, net, spot: sp?.s, nextRet: sp?.next && sp?.s ? sp.next / sp.s - 1 : null };
    });
  }, [nifty.data, market, who]);
  if (!rows.length) return <Empty>Needs stored participant OI files and the NIFTY history.</Empty>;
  const ch = rows.slice(1).map((r, i) => ({ d: r.net - rows[i].net, ret: r.nextRet })).filter((x) => x.ret != null);
  const corr = (() => { const n = ch.length; if (n < 10) return null; const mx = ch.reduce((a, x) => a + x.d, 0) / n, my = ch.reduce((a, x) => a + x.ret, 0) / n; let sxy = 0, sxx = 0, syy = 0; for (const x of ch) { sxy += (x.d - mx) * (x.ret - my); sxx += (x.d - mx) ** 2; syy += (x.ret - my) ** 2; } return sxy / Math.sqrt(sxx * syy); })();
  const types = market.at(-1)?.participants?.map((x) => x.type).filter((t) => !/total/i.test(t)) || ["FII"];
  return (
    <div className="card">
      <Seg value={who} onChange={setWho} options={types} />
      <div className="kpis" style={{ border: 0 }}>
        <Kpi label="Sessions" value={ch.length} />
        <Kpi label="Correlation: change in net index futures vs NIFTY next session" value={corr?.toFixed(2) ?? "—"} sub={corr == null ? "needs 10+ sessions" : Math.abs(corr) < 0.1 ? "no meaningful relationship" : corr > 0 ? "adds tended to precede up sessions" : "adds tended to precede down sessions"} />
      </div>
      <DataTable compact rows={rows.slice().reverse()} exportName={`participants-vs-nifty-${who}`} columns={[{ key: "d", label: "Session", value: (r) => r.date }, { key: "n", label: "Net index futures", num: true, value: (r) => r.net, render: (r) => r.net.toLocaleString("en-IN") }, { key: "s", label: "NIFTY", num: true, value: (r) => r.spot, render: (r) => r.spot?.toFixed(1) ?? "—" }, { key: "r", label: "NIFTY next session", num: true, value: (r) => r.nextRet, render: (r) => fp(r.nextRet, 2) }]} />
      <p className="legend-note">Participant OI is exchange-published end-of-day data (fact). The correlation is descriptive over the stored window and says nothing about cause.</p>
    </div>
  );
}


const DRIFT = [["atmIv", "ATM IV"], ["pcrOi", "PCR (OI)"], ["futOiChgPct", "Futures OI change"], ["optVolZ", "Option volume z"], ["skew25", "25-delta skew"], ["fut.basisPct", "Futures basis"]];
const pick = (o, path) => path.split(".").reduce((x, k) => (x == null ? x : x[k]), o);

function Calibration({ api, rows }) {
  const [und, setUnd] = useState("NIFTY");
  const h = useAsync(() => api.history(und), [und]);
  const res = useMemo(() => {
    const hist = h.data || [];
    if (hist.length < 30) return null;
    const cal = derivCalibration(hist), iv = ivForecastAudit(hist.map((x) => x.atmIv), { minFit: Math.min(60, Math.floor(hist.length / 2)) });
    const cut = Math.max(20, hist.length - 60);
    const drift = DRIFT.map(([k, label]) => { const v = psi(hist.slice(0, cut).map((x) => pick(x, k)), hist.slice(cut).map((x) => pick(x, k))); return { id: k, label, psi: v, verdict: psiLabel(v) }; });
    return { cal, iv, drift, n: hist.length };
  }, [h.data]);
  return (
    <div className="stack">
      <div className="card row wrap" style={{ gap: 10 }}><UndSelect rows={rows} value={und} onChange={setUnd} />{res && <span className="small muted">{res.n} stored sessions</span>}</div>
      {h.loading && <Loading />}
      {!h.loading && !res && <Empty>Calibration needs at least 30 stored sessions for this underlying.</Empty>}
      {res?.cal && <div className="card">
        <div className="h3">Are the option market's probabilities right?<Tag k="calc" /></div>
        <div className="kpis">
          <Kpi label="Brier score" value={res.cal.brier.toFixed(4)} sub={`always-average: ${res.cal.brierClimatology.toFixed(4)}`} />
          <Kpi label="Log loss" value={res.cal.logLoss.toFixed(3)} /><Kpi label="Hit rate at 50%" value={pc(res.cal.classification.hitRate)} />
          <Kpi label="False positives" value={pc(res.cal.classification.falsePositiveRate)} /><Kpi label="Settled within 1 sd" value={pc(res.cal.withinOneSd)} sub="about 68% if IV is fair" />
          <Kpi label="Forecasts checked" value={res.cal.n} sub={`${res.cal.sessions} sessions`} />
        </div>
        <XYChart height={260} xFmt={(v) => pc(v)} yFmt={(v) => pc(v)} series={[{ name: "perfect", type: "line", color: "#64748b", dash: "4 3", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }, { name: "observed", type: "line", color: "#2563eb", width: 2.2, points: res.cal.curve.map((c) => ({ x: c.predicted, y: c.observed })) }]} xLabel="stated probability of finishing above the strike" />
        <p className="legend-note">{res.cal.method}</p>
      </div>}
      {res?.iv && <div className="card">
        <div className="h3">IV forecast audit ({res.iv.h} sessions ahead)<Tag k="est" /></div>
        <div className="kpis"><Kpi label="Direction right" value={pc(res.iv.directionHitRate)} /><Kpi label="Mean abs. error" value={`${(res.iv.mae * 100).toFixed(2)} pts`} /><Kpi label="Bias" value={`${(res.iv.bias * 100).toFixed(2)} pts`} /><Kpi label="Inside 1-sd band" value={pc(res.iv.bandCoverage)} sub="about 68% if well calibrated" /><Kpi label="Forecasts" value={res.iv.n} /></div>
        <p className="legend-note">{res.iv.method}</p>
      </div>}
      {res && <div className="card">
        <div className="h3">Feature drift: last 60 sessions vs the earlier history</div>
        <DataTable compact rows={res.drift} exportName="feature-drift" columns={[{ key: "l", label: "Input", value: (r) => r.label }, { key: "p", label: "PSI", num: true, value: (r) => r.psi, render: (r) => (r.psi == null ? "—" : r.psi.toFixed(3)) }, { key: "v", label: "Verdict", value: (r) => r.verdict }]} />
        <p className="legend-note">Population stability index: under 0.1 stable, 0.1-0.25 moderate drift, above 0.25 material drift (the inputs a signal or score uses no longer look like the history it was judged on).</p>
      </div>}
    </div>
  );
}
