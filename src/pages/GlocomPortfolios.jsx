// GLOCOM / LOCOM category portfolios: strong, weak (long only) and neutral baskets of indices / ETFs, weekly vs
// monthly rebalancing, editable category and index weights, point-in-time back-test. Maths: engine/glocomPortfolio.js.
import { useMemo, useRef, useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";
import { PageHead, Seg, Select, Loading, ErrorBox, Empty, Check } from "../components/ui.jsx";
import { TvChart } from "../components/TvChart.jsx";
import { useAsync } from "../lib/useAsync.js";
import { usePersistent } from "../lib/storage.js";
import { DATA_SOURCE } from "../data/api.js";
import { exportCsv, exportXlsx } from "../lib/exporters.js";
import { GLOCOM_RULES, glocomBand } from "../../engine/glocom.js";
import { GP_UNIVERSES, GP_KEYS } from "../../engine/gpUniverses.js";
import { PORTFOLIOS, runPortfolio, sliceRun, stats, rolling, drawdown, normaliseWeights } from "../../engine/glocomPortfolio.js";

const CODE = Object.fromEntries([...GLOCOM_RULES.map((r) => [r.label, r.code]), ["Neutral 40 60", 3]]);
const catColor = (l) => glocomBand(CODE[l]).bg;
const fp = (v, d = 1) => (v == null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(d)}%`);
const f2 = (v) => (v == null || !Number.isFinite(v) ? "—" : v.toFixed(2));
// Saved configurations are a synced document ("gp.configs"): they follow the login across devices. Ones saved here
// before the sync existed (plain localStorage) are carried over once.
const OLD_CFG_KEY = "gqta.gp.configs";
const oldCfgs = () => { try { return JSON.parse(localStorage.getItem(OLD_CFG_KEY) || "{}"); } catch { return {}; } };

const cache = new Map();
const ratingCache = new Map(); // ratings depend only on the universe and the rebalance day, not on the weights being edited
async function loadUniverse(uk) {
  if (cache.has(uk)) return cache.get(uk);
  let out;
  if (DATA_SOURCE === "demo") {
    let seed = 11; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const g = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, rnd()))) * Math.cos(2 * Math.PI * rnd());
    const dates = []; for (let t = Date.parse("2014-01-01"); dates.length < 2400; t += 86400000) { const d = new Date(t); if (d.getUTCDay() % 6) dates.push(d.toISOString().slice(0, 10)); }
    const common = dates.map(() => g());
    out = Array.from({ length: 13 }, (_, k) => { let p = 100; const bench = k === 12; return { key: bench ? "BENCH" : `D${k}`, label: bench ? "Demo benchmark" : `Demo index ${k + 1}`, bench, dates, close: dates.map((_, i) => (p *= Math.exp(0.0002 + 0.008 * (0.7 * common[i] + 0.7 * g()) + (k - 6) * 0.00005))) }; });
  } else {
    const sb = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const { data, error } = await sb.from("tas_gp_series").select("key,label,is_bench,dates,close,updated_at").eq("universe", uk);
    if (error) throw new Error(error.message);
    out = data.map((r) => ({ key: r.key, label: r.label, bench: r.is_bench, dates: r.dates, close: r.close, updated: r.updated_at }));
  }
  cache.set(uk, out);
  return out;
}

const STAT_ROWS = [
  ["1M return", (s) => s.r1m, fp], ["3M return", (s) => s.r3m, fp], ["6M return", (s) => s.r6m, fp], ["1Y return", (s) => s.r1y, fp],
  ["2Y CAGR", (s) => s.cagr2, fp], ["3Y CAGR", (s) => s.cagr3, fp], ["CAGR since start", (s) => s.cagrAll, fp], ["Total return", (s) => s.total, fp],
  ["Max drawdown", (s) => s.maxDD, fp], ["Volatility (annualised)", (s) => s.vol, fp], ["Sharpe", (s) => s.sharpe, f2],
  ["Hit ratio (periods beating the benchmark)", (s) => s.hit, fp, true], ["Turnover (annualised, one way)", (s) => s.turnover, fp, true],
  ["CAGR minus benchmark CAGR", (s) => s.excessCagr, fp, true],
];

export default function GlocomPortfolios() {
  const [uk, setUk] = useState("us_sector");
  const [pk, setPk] = useState("strong");
  const [view, setView] = useState("W");
  const [cost, setCost] = useState(10);
  const [rf, setRf] = useState(0);
  const [extra, setExtra] = useState([]);
  const [catW, setCatW] = useState(null);   // {label: percent} or null = equal
  const [idxW, setIdxW] = useState({});     // {key: relative weight}
  const [cfgName, setCfgName] = useState("");
  const [cfgStored, setCfgs] = usePersistent("gp.configs", null);
  const cfgs = cfgStored || {};
  useEffect(() => { if (cfgStored === null) { const o = oldCfgs(); if (Object.keys(o).length) setCfgs(o); } }, [cfgStored, setCfgs]);
  const [when, setWhen] = useState(null);
  const { data, loading, error } = useAsync(() => loadUniverse(uk), [uk]);
  const pending = useRef(null); // a saved configuration waiting for the universe / portfolio switch to settle
  useEffect(() => {
    const c = pending.current; pending.current = null;
    setWhen(null);
    if (c) { setExtra(c.extra || []); setCatW(c.catW || null); setIdxW(c.idxW || {}); setCost(c.cost ?? 10); }
    else { setCatW(null); setIdxW({}); setExtra([]); }
  }, [uk, pk]);

  const members = useMemo(() => (data || []).filter((s) => !s.bench), [data]);
  const bench = useMemo(() => (data || []).find((s) => s.bench) || null, [data]);
  const P = PORTFOLIOS[pk];
  const cats = useMemo(() => [...P.categories, ...extra.filter((c) => P.optional.includes(c))], [P, extra]);
  const norm = useMemo(() => (catW ? normaliseWeights(catW, cats) : null), [catW, cats]);
  const custom = !!(catW || Object.values(idxW).some((v) => v !== "" && v != null));
  const idxClean = useMemo(() => { const o = {}; for (const [k, v] of Object.entries(idxW)) if (v !== "" && v != null && Number.isFinite(+v)) o[k] = +v; return o; }, [idxW]);

  const runs = useMemo(() => {
    if (loading || !members.length) return null;
    const go = (freq, withCustom) => {
      const ck = `${uk}|${freq}|${members.map((m) => m.key).join(",")}`;
      const r = runPortfolio(members, bench, { freq, categories: cats, costBps: cost, catWeights: withCustom && norm ? norm.w : null, idxWeights: withCustom ? idxClean : null, ratings: ratingCache.get(ck) });
      if (!ratingCache.has(ck)) ratingCache.set(ck, r.ratings);
      return r;
    };
    const W = go("W", true), M = go("M", true);
    const dW = custom ? go("W", false) : null, dM = custom ? go("M", false) : null;
    const start = [W, M, dW, dM].filter(Boolean).map((r) => r.dates[0]).filter(Boolean).sort().at(-1);
    if (!start) return { empty: true };
    const cut = (r) => (r ? sliceRun(r, start) : null);
    return { start, W: cut(W), M: cut(M), dW: cut(dW), dM: cut(dM) };
  }, [loading, members, bench, uk, cats, cost, norm, idxClean, custom]);

  const st = useMemo(() => {
    if (!runs || runs.empty) return null;
    const o = { W: stats(runs.W, rf), M: stats(runs.M, rf) };
    if (runs.dW) { o.dW = stats(runs.dW, rf); o.dM = stats(runs.dM, rf); }
    return o;
  }, [runs, rf]);

  if (loading) return <Loading what="portfolio universe" />;
  if (error) return <ErrorBox error={error} />;
  if (!members.length) return <Empty>No series for this universe yet. The server copies them from the heatmap once a day (tas_gp_series).</Empty>;
  if (!runs || runs.empty) return <Empty>Not enough history yet to rate this universe (a year of prices and at least 8 members are needed).</Empty>;

  const cur = runs[view];
  const line = (id, title, dates, vals, color, extraOpt = {}) => ({ id, type: "line", data: dates.map((d, i) => ({ time: d, value: vals[i] })).filter((p) => p.value != null && Number.isFinite(p.value)), options: { color, lineWidth: 2, title, ...extraOpt } });
  const navSeries = [
    line("W", "Weekly", runs.W.dates, runs.W.nav, "#16a34a"), line("M", "Monthly", runs.M.dates, runs.M.nav, "#2563eb"),
    ...(runs.W.bench.length ? [line("B", "Benchmark", runs.W.dates, runs.W.bench, "#9ca3af")] : []),
    ...(runs.dW ? [line("dW", "Weekly (equal weights)", runs.dW.dates, runs.dW.nav, "#16a34a", { lineStyle: 2, lineWidth: 1 }), line("dM", "Monthly (equal weights)", runs.dM.dates, runs.dM.nav, "#2563eb", { lineStyle: 2, lineWidth: 1 })] : []),
  ];
  const ddSeries = [line("W", "Weekly", runs.W.dates, drawdown(runs.W.nav), "#16a34a"), line("M", "Monthly", runs.M.dates, drawdown(runs.M.nav), "#2563eb"), ...(runs.W.bench.length ? [line("B", "Benchmark", runs.W.dates, drawdown(runs.W.bench), "#9ca3af")] : [])];
  const rollSeries = (days) => [line("W", "Weekly", runs.W.dates, rolling(runs.W.dates, runs.W.nav, days), "#16a34a"), line("M", "Monthly", runs.M.dates, rolling(runs.M.dates, runs.M.nav, days), "#2563eb"), ...(runs.W.bench.length ? [line("B", "Benchmark", runs.W.dates, rolling(runs.W.dates, runs.W.bench, days), "#9ca3af")] : [])];
  const contribSeries = Object.entries(cur.catContribution).map(([c, a]) => line(c, c, cur.dates, a, catColor(c)));
  const hold = cur.holdings;
  const whenH = hold.find((h) => h.date === when) || hold.at(-1);
  const freqName = { W: "Weekly", M: "Monthly" };

  const saveCfg = () => { const n = cfgName.trim(); if (!n) return; const next = { ...cfgs, [n]: { uk, pk, extra, catW, idxW, cost } }; setCfgs(next); };
  const loadCfg = (n) => {
    const c = cfgs[n]; if (!c) return;
    if (c.uk === uk && c.pk === pk) { setExtra(c.extra || []); setCatW(c.catW || null); setIdxW(c.idxW || {}); setCost(c.cost ?? 10); return; }
    pending.current = c; setUk(c.uk); setPk(c.pk);
  };
  const delCfg = (n) => { const next = { ...cfgs }; delete next[n]; setCfgs(next); };
  const setCat = (c, v) => setCatW((w) => ({ ...(w || Object.fromEntries(cats.map((x) => [x, +(100 / cats.length).toFixed(2)]))), [c]: v === "" ? 0 : +v }));

  const statCols = [{ k: "W", l: "Weekly" }, { k: "M", l: "Monthly" }, ...(st.dW ? [{ k: "dW", l: "Weekly (equal)" }, { k: "dM", l: "Monthly (equal)" }] : [])];
  const exportAll = async () => {
    const compRows = [];
    for (const f of ["W", "M"]) for (const h of runs[f].holdings) for (const m of h.members) compRows.push({ freq: freqName[f], date: h.date, category: m.category, key: m.key, label: m.label, weight: m.w, cash: h.cash, turnover: h.turnover });
    const navDates = runs.W.dates;
    const mIdx = new Map(runs.M.dates.map((d, i) => [d, i]));
    const navRows = navDates.map((d, i) => ({ d, w: runs.W.nav[i], m: runs.M.nav[mIdx.get(d)], b: runs.W.bench[i] }));
    const statRows = STAT_ROWS.map(([label, f, , bOnly]) => ({ label, w: f(st.W), m: f(st.M), b: bOnly ? null : f(st.W.bench) }));
    await exportXlsx(`glocom-portfolio-${uk}-${pk}`, [
      { name: "Statistics", note: `${GP_UNIVERSES[uk].label} · ${P.label} · ${cats.join(", ")} · cost ${cost} bp per unit traded · price return, point-in-time ratings`, columns: [{ label: "Measure", value: (r) => r.label }, { label: "Weekly", value: (r) => r.w }, { label: "Monthly", value: (r) => r.m }, { label: "Benchmark", value: (r) => r.b }], rows: statRows },
      { name: "NAV", columns: [{ label: "Date", value: (r) => r.d }, { label: "Weekly", value: (r) => r.w }, { label: "Monthly", value: (r) => r.m }, { label: "Benchmark", value: (r) => r.b }], rows: navRows },
      { name: "Composition", columns: [{ label: "Rebalance", value: (r) => r.freq }, { label: "Date", value: (r) => r.date }, { label: "Category", value: (r) => r.category }, { label: "Symbol", value: (r) => r.key }, { label: "Index", value: (r) => r.label }, { label: "Weight", value: (r) => r.weight }, { label: "Cash weight", value: (r) => r.cash }, { label: "One-way turnover", value: (r) => r.turnover }], rows: compRows },
    ]);
  };

  return (
    <div className="stack">
      <PageHead title="GLOCOM / LOCOM category portfolios" sub="Hold the indices that sit in chosen GLOCOM categories; re-rate and re-weight at every weekly or monthly rebalance. Ratings use only data up to each rebalance date. Limits: price returns only (no dividends, no total-return series held); the ETF and index lists are today's, so delisted or closed funds are not in the history; US benchmark is the S&P 500." />
      <div className="card">
        <div className="row" style={{ flexWrap: "wrap", gap: 12 }}>
          <Select label="Universe" value={uk} onChange={(v) => v && setUk(v)} options={GP_KEYS.map((k) => ({ value: k, label: GP_UNIVERSES[k].label }))} />
          <Seg value={pk} onChange={setPk} options={Object.entries(PORTFOLIOS).map(([k, p]) => ({ value: k, label: p.label }))} />
          <Seg value={view} onChange={setView} options={[{ value: "W", label: "Weekly view" }, { value: "M", label: "Monthly view" }]} />
          <label className="lbl-ctl">Cost per unit traded (bp)<input type="number" min={0} step={1} value={cost} onChange={(e) => setCost(Math.max(0, +e.target.value || 0))} style={{ width: 70 }} /></label>
          <label className="lbl-ctl">Risk-free rate (% a year)<input type="number" step={0.25} value={rf * 100} onChange={(e) => setRf((+e.target.value || 0) / 100)} style={{ width: 70 }} /></label>
          <button className="btn" onClick={exportAll}>⬇ Excel (stats, NAV, composition)</button>
        </div>
        <p className="legend-note">{GP_UNIVERSES[uk].note} Benchmark: {GP_UNIVERSES[uk].benchmark.label}. Window: {runs.start} to {runs.W.dates.at(-1)} ({members.length} members). History is limited by the price series held, which start in 2010 (ETFs from their launch).</p>
      </div>

      <div className="card">
        <div className="h3">Categories and weights</div>
        <div className="row" style={{ flexWrap: "wrap", gap: 14 }}>
          {P.optional.map((c) => <Check key={c} checked={extra.includes(c)} onChange={(v) => setExtra((e) => (v ? [...e, c] : e.filter((x) => x !== c)))}>Also hold {c}</Check>)}
          {P.optional.length > 0 && <span className="small muted">Optional.</span>}
        </div>
        <div className="row" style={{ flexWrap: "wrap", gap: 10, marginTop: 8 }}>
          {cats.map((c) => (
            <label key={c} className="lbl-ctl" style={{ borderLeft: `6px solid ${catColor(c)}`, paddingLeft: 6 }}>{c} %
              <input type="number" min={0} step={1} style={{ width: 70 }} value={catW ? catW[c] ?? 0 : +(100 / cats.length).toFixed(2)} onChange={(e) => setCat(c, e.target.value)} />
            </label>
          ))}
          <span className={norm && !norm.ok ? "neg" : "muted"} style={{ alignSelf: "center" }}>Total {catW ? norm.total.toFixed(2) : "100"}%{norm && !norm.ok ? " — must be 100%; it is rescaled to 100% in the results" : ""}</span>
          <button className="btn" onClick={() => { setCatW(null); setIdxW({}); }}>Reset to equal weight</button>
        </div>
        <p className="legend-note">A category with no qualifying index at a rebalance is skipped and the others are re-normalised to 100%. With nothing qualifying the portfolio holds cash.</p>
        <div className="row" style={{ flexWrap: "wrap", gap: 8, marginTop: 6 }}>
          <input placeholder="Name this configuration" value={cfgName} onChange={(e) => setCfgName(e.target.value)} />
          <button className="btn" onClick={saveCfg} disabled={!cfgName.trim()}>Save</button>
          {Object.keys(cfgs).length > 0 && <Select label="Saved" value="" allowEmpty="Load…" options={Object.keys(cfgs)} onChange={(n) => n && loadCfg(n)} />}
          {Object.keys(cfgs).map((n) => <span key={n} className="small muted">{n} <a href="#" onClick={(e) => { e.preventDefault(); delCfg(n); }} title="Delete">✕</a></span>)}
          <span className="small muted">Saved in this browser.</span>
        </div>
        <details style={{ marginTop: 8 }}>
          <summary>Individual index weights (relative; blank = equal inside its category)</summary>
          <div className="tbl-wrap" style={{ maxHeight: 260, overflow: "auto" }}><table className="tbl">
            <thead><tr><th>Index</th><th>Now in</th><th>Relative weight</th></tr></thead>
            <tbody>{members.map((m) => {
              const lastRow = (cur.ratings || [])[cur.ratings.length - 1] || [];
              const lab = lastRow[members.indexOf(m)];
              return <tr key={m.key}><td>{m.label} <span className="muted small">{m.key}</span></td><td>{lab ? <span className="badge" style={{ background: catColor(lab), color: "#fff" }}>{lab}</span> : <span className="muted">not rated</span>}</td>
                <td><input type="number" min={0} step={0.5} style={{ width: 80 }} value={idxW[m.key] ?? ""} onChange={(e) => setIdxW((w) => ({ ...w, [m.key]: e.target.value }))} /></td></tr>;
            })}</tbody></table></div>
        </details>
      </div>

      <div className="card">
        <div className="h3">Weekly vs monthly vs benchmark</div>
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>Measure</th>{statCols.map((c) => <th key={c.k} className="num">{c.l}</th>)}<th className="num">Benchmark</th></tr></thead>
          <tbody>{STAT_ROWS.map(([label, f, fmt, bOnly]) => (
            <tr key={label}><td>{label}</td>{statCols.map((c) => <td key={c.k} className="num">{fmt(f(st[c.k]))}</td>)}<td className="num">{bOnly ? "—" : fmt(f(st.W.bench))}</td></tr>
          ))}</tbody></table></div>
        <p className="legend-note">Sharpe = annualised mean daily return less the risk-free rate, over annualised volatility. Hit ratio counts rebalance periods in which the portfolio beat the benchmark. Weekly and monthly are separate runs over the same window starting {runs.start}; costs are charged on the weight traded at every rebalance.</p>
      </div>

      <div className="card"><div className="h3">Growth of 1 (log scale)</div><TvChart height={320} logScale legend series={navSeries} /></div>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 10 }}>
        <div className="card"><div className="h3">Drawdown</div><TvChart height={240} series={ddSeries} /></div>
        <div className="card"><div className="h3">Rolling 1-year return</div><TvChart height={240} series={rollSeries(365)} /></div>
        <div className="card"><div className="h3">Rolling 3-year return</div><TvChart height={240} series={rollSeries(1095)} /></div>
        <div className="card"><div className="h3">Contribution by category ({freqName[view]}, cumulative)</div><TvChart height={240} legend series={contribSeries} /></div>
      </div>

      <div className="card">
        <div className="h3">Allocation over time ({freqName[view]})</div>
        <Alloc holdings={hold} cats={cats} />
      </div>

      <div className="card">
        <div className="row between"><div className="h3">Composition at each rebalance ({freqName[view]})</div>
          <div className="row" style={{ gap: 8 }}>
            <Select label="Rebalance" value={whenH?.date} onChange={(v) => setWhen(v)} options={[...hold].reverse().map((h) => h.date)} />
            <button className="btn" onClick={() => exportCsv(`glocom-composition-${uk}-${pk}-${view}`, [{ label: "Date", value: (r) => r.date }, { label: "Category", value: (r) => r.category }, { label: "Symbol", value: (r) => r.key }, { label: "Index", value: (r) => r.label }, { label: "Weight", value: (r) => r.w }], hold.flatMap((h) => h.members.map((m) => ({ ...m, date: h.date }))))}>⬇ CSV (all dates)</button>
          </div></div>
        {whenH ? <>
          <p className="small muted">Traded {fp(whenH.turnover)} one way · cash {fp(whenH.cash)} · {whenH.members.length} holdings</p>
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Category</th><th>Index</th><th className="num">Weight</th></tr></thead>
            <tbody>{[...whenH.members].sort((a, b) => cats.indexOf(a.category) - cats.indexOf(b.category) || b.w - a.w).map((m) => <tr key={m.key}><td><span className="badge" style={{ background: catColor(m.category), color: "#fff" }}>{m.category}</span></td><td>{m.label} <span className="muted small">{m.key}</span></td><td className="num">{fp(m.w, 2)}</td></tr>)}</tbody></table></div>
        </> : <Empty>No rebalance yet.</Empty>}
      </div>
    </div>
  );
}

/** Stacked bars of the category weights (and cash) at each rebalance. */
function Alloc({ holdings, cats }) {
  if (!holdings.length) return <Empty>No holdings yet.</Empty>;
  const W = 1000, H = 150, n = holdings.length, bw = W / n;
  const keys = [...cats, "Cash"];
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 150 }} preserveAspectRatio="none">
        {holdings.map((h, i) => {
          let y = 0;
          return keys.map((c) => { const v = c === "Cash" ? h.cash : h.cats[c] ? h.cats[c] * (1 - h.cash) : 0; const rect = <rect key={`${i}${c}`} x={i * bw} y={y * H} width={Math.max(0.5, bw)} height={v * H} fill={c === "Cash" ? "#6b7280" : catColor(c)} />; y += v; return rect; });
        })}
      </svg>
      <div className="row small" style={{ gap: 12, flexWrap: "wrap" }}>{keys.map((c) => <span key={c}><span style={{ display: "inline-block", width: 10, height: 10, background: c === "Cash" ? "#6b7280" : catColor(c), marginRight: 4 }} />{c}</span>)}<span className="muted">{holdings[0].date} → {holdings.at(-1).date}</span></div>
    </>
  );
}
