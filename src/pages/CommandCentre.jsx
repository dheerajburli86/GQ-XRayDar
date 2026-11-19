// Global market command centre: strength, breadth, rotation, opportunities,
// Weight Watcher movers and an AI brief on one screen.
import { useMemo } from "react";
import { useData } from "../data/store.jsx";
import { useAsync } from "../lib/useAsync.js";
import { PageHead, Kpi, Badge, Pct, StockLink, ScoreBar, QUAD_COLOR, Loading } from "../components/ui.jsx";
import { TvChart, lineData } from "../components/TvChart.jsx";
import { changeOver } from "../lib/indexMath.js";
import { breadthDivergence } from "../../engine/breadth.js";
import { writeBrief } from "../../engine/briefs.js";
import { href } from "../lib/router.js";
import { fmtPct } from "../lib/format.js";
import { rowRankCmp } from "../../engine/turnover.js";

export default function CommandCentre() {
  const d = useData();
  const regions = d.regions.filter((r) => d.indexByKey.has(`CW|USD|R:${r}`));
  const { data, loading } = useAsync(async () => {
    const [gc, ge, br, rot, ewcw, ...rs] = await Promise.all([
      d.api.indexSeries("CW|USD|G"), d.api.indexSeries("EW|USD|G"), d.api.breadth("G"), d.api.rotation("G"), d.api.ewcw(),
      ...regions.map((r) => d.api.indexSeries(`CW|USD|R:${r}`)),
    ]);
    const countries = await Promise.all(d.countries.filter((c) => d.indexByKey.has(`CW|USD|C:${c}`)).map(async (c) => ({ name: c, series: await d.api.indexSeries(`CW|USD|C:${c}`) })));
    return { gc, ge, br, rot: rot || [], ewcw, regions: regions.map((r, i) => ({ name: r, series: rs[i] })), countries };
  }, [d.api]);

  const top = useMemo(() => [...d.rows].filter((r) => r.flat.score != null).sort((a, b) => b.flat.score - a.flat.score).slice(0, 12), [d.rows]);
  const wwUp = useMemo(() => d.rows.filter((r) => r.flat.wwTrend === "turn_up_from_low").sort(rowRankCmp).slice(0, 10), [d.rows]);
  const stages = useMemo(() => { const c = {}; for (const r of d.rows) { const k = r.flat.stage || "—"; c[k] = (c[k] || 0) + 1; } return c; }, [d.rows]);

  if (loading || !data) return <Loading what="market overview" />;
  const { gc, ge, br, rot, ewcw, countries } = data;
  const n = br?.dates?.length ? br.dates.length - 1 : -1;
  const div = breadthDivergence(gc, br);
  const gEw = ewcw.find((e) => e.pairKey === "USD|G");
  const gReg = d.regimes["CW|USD|G"];
  const brief = writeBrief({ period: "weekly", asOf: d.info.asOf, global: { CW: gc, EW: ge }, regions: data.regions, countries, breadth: { global: br }, rotation: rot, regimes: d.regimes, ewcwGlobal: gEw, rows: d.rows, divergence: div });

  return (
    <div className="stack">
      <PageHead title="Global market command centre" sub={`Global CW / EW equity indices in USD, breadth, rotation and AI insights · latest session ${d.info.asOf}`} />
      <div className="grid g4">
        <div className="card"><Kpi label="Global CW (USD) 1M" value={fmtPct(changeOver(gc, 21))} cls={changeOver(gc, 21) >= 0 ? "pos" : "neg"} sub={`1D ${fmtPct(changeOver(gc, 1))} · 3M ${fmtPct(changeOver(gc, 63))} · level ${gc.level.at(-1).toFixed(1)}`} /></div>
        <div className="card"><Kpi label="Global EW (USD) 1M" value={fmtPct(changeOver(ge, 21))} cls={changeOver(ge, 21) >= 0 ? "pos" : "neg"} sub={gEw ? `EW/CW: ${gEw.label}` : ""} /></div>
        <div className="card"><Kpi label="Above 50-day EMA" value={n >= 0 ? `${br.pct50[n]}%` : "—"} sub={n >= 0 ? `200-day ${br.pct200[n]}% · new highs ${br.newHigh[n]} / lows ${br.newLow[n]}` : ""} /></div>
        <div className="card"><Kpi label="Global regime" value={gReg?.label || "—"} sub={gReg ? `efficiency ${gReg.er} · vol pctile ${gReg.volPctile}` : ""} />
          {div?.flag && <div className="small" style={{ marginTop: 6 }}><Badge kind="a">Breadth divergence</Badge> {div.reasons[0]}</div>}</div>
      </div>

      <div className="grid g2">
        <div className="card tight">
          <div className="row between" style={{ padding: "0 4px 6px" }}><h3>Global CW vs EW (USD)</h3><a href={href("indices", { key: "CW|USD|G" })} className="small">Open index →</a></div>
          <TvChart height={240} series={[
            { id: "cw", type: "line", data: lineData(gc.dates, gc.level), options: { color: "#14a44d", lineWidth: 2, title: "CW" } },
            { id: "ew", type: "line", data: lineData(ge.dates, ge.level), options: { color: "#2563eb", lineWidth: 1, title: "EW" } },
          ]} />
        </div>
        <div className="card tight">
          <div className="row between" style={{ padding: "0 4px 6px" }}><h3>Participation: % above 50 / 200-day EMA</h3><a href={href("breadth")} className="small">Breadth →</a></div>
          {br && <TvChart height={240} series={[
            { id: "p50", type: "line", data: lineData(br.dates, br.pct50), options: { color: "#14a44d", lineWidth: 1, title: "% > 50d" }, priceLines: [{ price: 50, color: "#888", title: "" }] },
            { id: "p200", type: "line", data: lineData(br.dates, br.pct200), options: { color: "#d97706", lineWidth: 1, title: "% > 200d" } },
          ]} />}
        </div>
      </div>

      <div className="grid g3">
        <div className="card">
          <h3>Regional strength (CW, USD)</h3>
          <table className="tbl"><thead><tr><th>Region</th><th className="num">1W</th><th className="num">1M</th><th className="num">3M</th><th>Regime</th></tr></thead><tbody>
            {data.regions.map((r) => (
              <tr key={r.name}><td><a href={href("explorer", { region: r.name })}>{r.name}</a></td>
                <td className="num"><Pct v={changeOver(r.series, 5)} /></td><td className="num"><Pct v={changeOver(r.series, 21)} /></td><td className="num"><Pct v={changeOver(r.series, 63)} /></td>
                <td className="small">{d.regimes[`CW|USD|R:${r.name}`]?.label || "—"}</td></tr>))}
          </tbody></table>
          <h3 style={{ marginTop: 12 }}>Countries, 1M (USD)</h3>
          {[...countries].map((c) => ({ ...c, v: changeOver(c.series, 21) })).filter((c) => c.v != null).sort((a, b) => b.v - a.v).map((c) => (
            <div key={c.name} className="row between small"><a href={href("explorer", { country: c.name })}>{c.name}</a><Pct v={c.v} /></div>))}
        </div>
        <div className="card">
          <div className="row between"><h3>Global sector rotation</h3><a href={href("rotation")} className="small">Rotation →</a></div>
          {["Leading", "Improving", "Weakening", "Lagging"].map((q) => (
            <div key={q} style={{ marginBottom: 8 }}>
              <div className="small" style={{ color: QUAD_COLOR[q], fontWeight: 700 }}>{q}</div>
              <div className="row">{rot.filter((s) => s.quadrant === q).map((s) => <Badge key={s.name}>{s.name}</Badge>)}{!rot.some((s) => s.quadrant === q) && <span className="small muted">none</span>}</div>
            </div>))}
          <h3 style={{ marginTop: 12 }}>Early-stage pipeline</h3>
          {Object.entries(stages).sort().map(([k, v]) => <div key={k} className="row between small"><span>{k}</span><span className="mono">{v}</span></div>)}
          <a href={href("early")} className="small">Early-stage scanner →</a>
        </div>
        <div className="card">
          <div className="row between"><h3>Top AI setup scores</h3><a href={href("scores")} className="small">Scores →</a></div>
          {top.map((r) => <div key={r.id} className="row between small"><span><StockLink sec={r.sec} /> <span className="muted">{r.sec.country}</span></span><ScoreBar v={r.flat.score} /></div>)}
          <h3 style={{ marginTop: 12 }}>Weight Watcher: turning up from a low</h3>
          {wwUp.length ? wwUp.map((r) => <div key={r.id} className="row between small"><StockLink sec={r.sec} /><span className="muted">{r.sec.sector} · {r.sec.country}</span></div>) : <div className="small muted">None this quarter</div>}
        </div>
      </div>

      <div className="card brief">
        <div className="row between"><h3>AI insight · {brief.title}</h3><a href={href("briefs")} className="small">All briefs →</a></div>
        {brief.sections.map((s) => <div key={s.title}><b className="small">{s.title}</b>{s.lines.map((l, i) => <p key={i}>{l}</p>)}</div>)}
        <div className="small muted">{brief.note}</div>
      </div>
    </div>
  );
}
