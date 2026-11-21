// Market command centre (owner, Nov 2026): one screen per market -- Global, a region, a market
// classification or a country (US and India one click away). Index strength, breadth, sector and
// industry strength with their GLOCOM / LOCOM bands, rotation, a setup report and a PDF of it all.
import { useMemo, useRef, useState } from "react";
import { useData } from "../data/store.jsx";
import { useAsync } from "../lib/useAsync.js";
import { PageHead, Kpi, Badge, Pct, StockLink, ScoreBar, QUAD_COLOR, Loading, Select } from "../components/ui.jsx";
import { TvChart, lineData } from "../components/TvChart.jsx";
import { changeOver } from "../lib/indexMath.js";
import { breadthDivergence } from "../../engine/breadth.js";
import { writeBrief } from "../../engine/briefs.js";
import { groupMoves } from "../../engine/glocom.js";
import { countryFamily } from "../../engine/geography.js";
import { STAGES } from "../../engine/signals.js";
import { href, navigate } from "../lib/router.js";
import { fmtPct } from "../lib/format.js";
import { rowRankCmp } from "../../engine/turnover.js";
import { GBadge, BandChange, comName } from "../components/glocomUi.jsx";
import { downloadPage } from "../lib/pagePicture.js";

// what each early-stage label means, for the setup report
const STAGE_NOTE = {
  6: "breakout within the last 5 sessions on volume at least 1.5x its 50-bar average",
  5: "price broke out of its range in the last 5 bars, volume not yet confirming",
  4: "relative strength turned up against the market before price broke out",
  3: "short and long moving averages squeezed together: energy building",
  2: "sideways range after a decline",
  7: "established uptrend: already moving, later in the cycle",
  1: "decline slowing", 0: "downtrend",
};
const REPORT_ORDER = [6, 5, 4, 3, 2, 7];

export default function CommandCentre({ route }) {
  const d = useData();
  const q = route?.query || {};
  const m = q.m || "G";
  const set = (v) => navigate("market", { m: v });
  const isCountry = m.startsWith("C:");
  const country = isCountry ? m.slice(2) : null;
  const fam = isCountry ? countryFamily(country) : "CW";
  const ccy = isCountry ? "LCL" : "USD";
  const scopeName = m === "G" ? "Global" : m.slice(2);
  const sheet = comName(m);
  const shotRef = useRef(null);
  const [busy, setBusy] = useState(false);

  const scopeOptions = useMemo(() => [
    { value: "G", label: "Global" },
    ...d.regions.filter((r) => d.indexByKey.has(`CW|USD|R:${r}`)).map((r) => ({ value: `R:${r}`, label: `${r} (region)` })),
    ...d.classifications.filter((c) => d.indexByKey.has(`CW|USD|M:${c}`)).map((c) => ({ value: `M:${c}`, label: `${c} (classification)` })),
    ...d.countries.map((c) => ({ value: `C:${c}`, label: c })),
  ], [d.regions, d.classifications, d.countries, d.indexByKey]);

  // sub-scopes: regions of Global, countries of a region / classification
  const subs = useMemo(() => {
    if (m === "G") return d.regions.filter((r) => d.indexByKey.has(`CW|USD|R:${r}`)).map((r) => ({ name: r, key: `CW|USD|R:${r}`, go: `R:${r}` }));
    if (m.startsWith("R:") || m.startsWith("M:")) {
      const field = m[0] === "R" ? "region" : "classification";
      const cs = [...new Set(d.secs.filter((s) => s[field] === m.slice(2)).map((s) => s.country))].sort();
      return cs.filter((c) => d.indexByKey.has(`CW|USD|C:${c}`)).map((c) => ({ name: c, key: `CW|USD|C:${c}`, go: `C:${c}` }));
    }
    return [];
  }, [m, d.regions, d.secs, d.indexByKey]);
  const sectorKeys = useMemo(() => d.indices.filter((x) => x.family === fam && x.ccy === ccy && x.scopeKey?.startsWith(`${m}|S:`) && !x.scopeKey.slice(m.length + 3).includes("|"))
    .map((x) => ({ name: x.scopeKey.slice(m.length + 3), key: x.key })), [d.indices, fam, ccy, m]);

  const { data, loading } = useAsync(async () => {
    const safe = (p) => p.catch(() => null);
    const [main, ew, br, rot, ewcw, gSec, gInd] = await Promise.all([
      safe(d.api.indexSeries(`${fam}|${ccy}|${m}`)), safe(d.api.indexSeries(`EW|${ccy}|${m}`)), safe(d.api.breadth(m)), safe(d.api.rotation(m)), safe(d.api.ewcw()),
      m === "G" || isCountry ? safe(d.api.glocomGroups(`${m}|sector`)) : null, m === "G" || isCountry ? safe(d.api.glocomGroups(`${m}|industry`)) : null,
    ]);
    const subSeries = await Promise.all(subs.map(async (s) => ({ ...s, series: await safe(d.api.indexSeries(s.key)) })));
    const secSeries = await Promise.all(sectorKeys.map(async (s) => ({ ...s, series: await safe(d.api.indexSeries(s.key)) })));
    return { main, ew, br, rot: rot || [], ewcw: ewcw || [], gSec, gInd, subSeries, secSeries };
  }, [m, subs.length, sectorKeys.length]);

  const inScope = useMemo(() => d.rows.filter((r) => (r.sec.assetClass || "Stock") === "Stock" && (m === "G" || (m.startsWith("C:") ? r.sec.country === country : m.startsWith("R:") ? r.sec.region === m.slice(2) : r.sec.classification === m.slice(2)))), [d.rows, m, country]);
  const top = useMemo(() => [...inScope].filter((r) => r.flat.score != null).sort((a, b) => b.flat.score - a.flat.score).slice(0, 12), [inScope]);
  const wwUp = useMemo(() => inScope.filter((r) => r.flat.wwTrend === "turn_up_from_low").sort(rowRankCmp).slice(0, 10), [inScope]);
  const byStage = useMemo(() => { const c = new Map(); for (const r of inScope) { const k = r.flat.stageId; if (k == null) continue; if (!c.has(k)) c.set(k, []); c.get(k).push(r); } for (const v of c.values()) v.sort((a, b) => (b.flat.score ?? -1) - (a.flat.score ?? -1)); return c; }, [inScope]);

  const back = (h) => Math.max(1, Math.min(5, (h?.dates?.length || 1) - 1));
  const secMoves = useMemo(() => (data?.gSec ? groupMoves(data.gSec, back(data.gSec)) : []), [data]);
  const indMoves = useMemo(() => (data?.gInd ? groupMoves(data.gInd, back(data.gInd)) : []), [data]);
  const bandOf = useMemo(() => new Map(secMoves.map((x) => [x.name, x])), [secMoves]);

  if (loading || !data) return <Loading what={`${scopeName} overview`} />;
  const { main, ew, br, rot, ewcw, subSeries, secSeries } = data;
  const n = br?.dates?.length ? br.dates.length - 1 : -1;
  const div = main && br ? breadthDivergence(main, br) : null;
  const pair = ewcw.find((e) => e.pairKey === `${ccy}|${m}`) || ewcw.find((e) => e.pairKey === `USD|${m}`);
  const reg = d.regimes[`${fam}|${ccy}|${m}`] || d.regimes[`CW|USD|${m}`];
  const idxName = `${scopeName} ${fam}${isCountry ? ` (${ccy === "LCL" ? "local currency" : "USD"})` : " (USD)"}`;
  const brief = m === "G" && main ? writeBrief({ period: "weekly", asOf: d.info.asOf, global: { CW: main, EW: ew }, regions: subSeries.map((s) => ({ name: s.name, series: s.series })), countries: [], breadth: { global: br }, rotation: rot, regimes: d.regimes, ewcwGlobal: pair, rows: d.rows, divergence: div }) : null;
  const strong = secMoves.filter((x) => /^(US|LTS)/.test(x.label || "")).map((x) => x.name);
  const weak = secMoves.filter((x) => /^(UW|LTW)/.test(x.label || "")).map((x) => x.name);
  const indChanges = indMoves.filter((x) => x.bandMove);
  const downloadPdf = async () => { setBusy(true); try { await downloadPage(shotRef.current, "pdf", { name: `command_centre_${scopeName}`, title: `GQ XRayDar · ${scopeName} command centre`, subtitle: `Latest session ${d.info.asOf}` }); } finally { setBusy(false); } };

  return (
    <div className="stack" ref={shotRef}>
      <PageHead title={`${scopeName} command centre`} sub={`${idxName} index, breadth, sector and industry strength with ${sheet} bands, rotation and a setup report · latest session ${d.info.asOf}`}>
        <div className="seg" data-html2canvas-ignore>{[["G", "Global"], ["C:United States", "US"], ["C:India", "India"]].map(([k, l]) => <button key={k} className={m === k ? "on" : ""} onClick={() => set(k)}>{l}</button>)}</div>
        <span data-html2canvas-ignore><Select label="Market" value={m} options={scopeOptions} onChange={(v) => set(v || "G")} /></span>
        <button className="btn sm primary" data-html2canvas-ignore disabled={busy} onClick={downloadPdf}>{busy ? "Preparing…" : "Download PDF"}</button>
      </PageHead>

      <div className="grid g4">
        <div className="card"><Kpi label={`${idxName} 1M`} value={main ? fmtPct(changeOver(main, 21)) : "—"} cls={changeOver(main, 21) >= 0 ? "pos" : "neg"} sub={main ? `1D ${fmtPct(changeOver(main, 1))} · 1W ${fmtPct(changeOver(main, 5))} · 3M ${fmtPct(changeOver(main, 63))}` : "no index"} /></div>
        <div className="card"><Kpi label={`${scopeName} EW 1M`} value={ew ? fmtPct(changeOver(ew, 21)) : "—"} cls={changeOver(ew, 21) >= 0 ? "pos" : "neg"} sub={fam === "EW" ? "no reliable market cap: equal-weighted is the benchmark" : pair ? `EW/CW: ${pair.label}` : ""} /></div>
        <div className="card"><Kpi label="Above 50-day EMA" value={n >= 0 ? `${br.pct50[n]}%` : "—"} sub={n >= 0 ? `200-day ${br.pct200[n]}% · new highs ${br.newHigh[n]} / lows ${br.newLow[n]}` : ""} /></div>
        <div className="card"><Kpi label="Regime" value={reg?.label || "—"} sub={reg ? `efficiency ${reg.er} · vol pctile ${reg.volPctile}` : ""} />
          {div?.flag && <div className="small" style={{ marginTop: 6 }}><Badge kind="a">Breadth divergence</Badge> {div.reasons[0]}</div>}</div>
      </div>

      <div className="grid g2">
        <div className="card tight">
          <div className="row between" style={{ padding: "0 4px 6px" }}><h3>{scopeName} {fam === "EW" ? "EW" : "CW vs EW"}</h3>{main && <a href={href("indices", { key: `${fam}|${ccy}|${m}` })} className="small">Open index →</a>}</div>
          {main ? <TvChart height={240} series={[
            { id: "cw", type: "line", data: lineData(main.dates, main.level), options: { color: "#14a44d", lineWidth: 2, title: fam } },
            ...(ew && fam !== "EW" ? [{ id: "ew", type: "line", data: lineData(ew.dates, ew.level), options: { color: "#2563eb", lineWidth: 1, title: "EW" } }] : []),
          ]} /> : <div className="small muted">No index for this market.</div>}
        </div>
        <div className="card tight">
          <div className="row between" style={{ padding: "0 4px 6px" }}><h3>Participation: % above 50 / 200-day EMA</h3><a href={href("breadth", { scope: m })} className="small">Breadth →</a></div>
          {br ? <TvChart height={240} series={[
            { id: "p50", type: "line", data: lineData(br.dates, br.pct50), options: { color: "#14a44d", lineWidth: 1, title: "% > 50d" }, priceLines: [{ price: 50, color: "#888", title: "" }] },
            { id: "p200", type: "line", data: lineData(br.dates, br.pct200), options: { color: "#d97706", lineWidth: 1, title: "% > 200d" } },
          ]} /> : <div className="small muted">No breadth series for this market.</div>}
        </div>
      </div>

      <div className="grid g2">
        <div className="card">
          <div className="row between"><h3>Sector strength ({fam}, {ccy === "LCL" ? "local" : "USD"})</h3><a className="small" href={href("glocom", { m, lv: "sector" })}>{sheet} →</a></div>
          <table className="tbl"><thead><tr><th>Sector</th><th className="num">1W</th><th className="num">1M</th><th className="num">3M</th><th>{sheet}</th><th>Change (1W)</th></tr></thead><tbody>
            {secSeries.map((s) => ({ ...s, v: changeOver(s.series, 21) })).sort((a, b) => (b.v ?? -9) - (a.v ?? -9)).map((s) => {
              const g = bandOf.get(s.name);
              return <tr key={s.name}><td><a href={href("explorer", { ...(country ? { country } : {}), sector: s.name })}>{s.name}</a></td>
                <td className="num"><Pct v={changeOver(s.series, 5)} /></td><td className="num"><Pct v={s.v} /></td><td className="num"><Pct v={changeOver(s.series, 63)} /></td>
                <td>{g ? <GBadge small code={g.code} label={g.label} /> : <span className="muted">—</span>}</td>
                <td>{g?.bandMove ? <BandChange small prevCode={g.prevCode} prevLabel={g.prevLabel} code={g.code} label={g.label} /> : <span className="muted small">{g ? "same" : ""}</span>}</td></tr>;
            })}
            {!secSeries.length && <tr><td colSpan={6} className="muted small">No sector indices for this market.</td></tr>}
          </tbody></table>
          {subSeries.length > 0 && <>
            <h3 style={{ marginTop: 12 }}>{m === "G" ? "Regions" : "Countries"} (CW, USD)</h3>
            <table className="tbl"><thead><tr><th>{m === "G" ? "Region" : "Country"}</th><th className="num">1W</th><th className="num">1M</th><th className="num">3M</th></tr></thead><tbody>
              {subSeries.map((s) => ({ ...s, v: changeOver(s.series, 21) })).sort((a, b) => (b.v ?? -9) - (a.v ?? -9)).map((s) => (
                <tr key={s.name}><td><a onClick={() => set(s.go)} style={{ cursor: "pointer" }}>{s.name} ›</a></td><td className="num"><Pct v={changeOver(s.series, 5)} /></td><td className="num"><Pct v={s.v} /></td><td className="num"><Pct v={changeOver(s.series, 63)} /></td></tr>))}
            </tbody></table></>}
        </div>
        <div className="card">
          <div className="row between"><h3>Industry strength ({sheet}, equal-weighted)</h3><a className="small" href={href("glocom", { m, lv: "industry" })}>{sheet} →</a></div>
          {indMoves.length ? (
            <div style={{ maxHeight: 520, overflow: "auto" }}><table className="tbl"><thead><tr><th>#</th><th>Industry group</th><th className="num">1W</th><th className="num">6M</th><th className="num">1Y</th><th>{sheet} (change 1W)</th></tr></thead><tbody>
              {[...indMoves].sort((a, b) => a.rank - b.rank).map((x) => (
                <tr key={x.name}><td className="mono">{x.rank}</td><td style={{ fontWeight: x.bandMove ? 700 : 400 }}><a href={href("glocom", { m, lv: "industry", g: x.name })}>{x.name}</a></td>
                  <td className="num"><Pct v={x.w == null ? null : x.w * 100} /></td><td className="num"><Pct v={x.m6 == null ? null : x.m6 * 100} /></td><td className="num"><Pct v={x.y == null ? null : x.y * 100} /></td>
                  <td><BandChange small prevCode={x.prevCode} prevLabel={x.prevLabel} code={x.code} label={x.label} /></td></tr>))}
            </tbody></table></div>
          ) : <div className="small muted">{sheet} industry ranks are kept for Global and for each country; pick one of those to see them.</div>}
        </div>
      </div>

      <div className="card">
        <h3>Setup report · {scopeName} · {d.info.asOf}</h3>
        <div className="small muted" style={{ marginBottom: 8 }}>Descriptive read of the stored calculations, not a recommendation. Stages come from the weekly trend, MMA compression, relative strength and volume; names are ranked by the AI setup score.</div>
        <div className="stack small" style={{ gap: 4, marginBottom: 10 }}>
          {strong.length > 0 && <div><b>Strong sectors ({sheet} US / LTS bands):</b> {strong.join(", ")}.</div>}
          {weak.length > 0 && <div><b>Weak sectors ({sheet} UW / LTW bands):</b> {weak.join(", ")}.</div>}
          {indChanges.length > 0 && <div><b>Industry category changes this week:</b> {indChanges.slice(0, 12).map((x) => `${x.name} ${x.prevLabel} → ${x.label}`).join("; ")}{indChanges.length > 12 ? ` and ${indChanges.length - 12} more` : ""}.</div>}
          {n >= 0 && <div><b>Participation:</b> {br.pct50[n]}% of stocks above their 50-day EMA, {br.pct200[n]}% above the 200-day; {br.newHigh[n]} new 52-week highs vs {br.newLow[n]} lows.{div?.flag ? ` Breadth divergence: ${div.reasons[0]}.` : ""}</div>}
        </div>
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 10 }}>
          {REPORT_ORDER.map((id) => {
            const list = byStage.get(id) || [];
            return (
              <div key={id} className="card tight" style={{ padding: 8 }}>
                <div className="row between"><b>{STAGES[id].label}</b><span className="mono small">{list.length}</span></div>
                <div className="small muted" style={{ marginBottom: 4 }}>{STAGE_NOTE[id]}</div>
                {list.slice(0, 6).map((r) => (
                  <div key={r.id} className="row between small" style={{ gap: 6 }}>
                    <span><StockLink sec={r.sec} /> <span className="muted">{isCountry ? r.sec.industryGroup : r.sec.country}</span></span>
                    <span className="row" style={{ gap: 4 }}>{r.flat.glocom && <GBadge small code={r.flat.glocomCode} label={r.flat.glocom} />}<ScoreBar v={r.flat.score} /></span>
                  </div>))}
                {!list.length && <div className="small muted">none</div>}
              </div>);
          })}
        </div>
        <a href={href("early")} className="small">Early-stage scanner →</a>
      </div>

      <div className="grid g3">
        <div className="card">
          <div className="row between"><h3>{scopeName} sector rotation</h3><a href={href("rotation", { scope: m })} className="small">Rotation →</a></div>
          {rot.length ? ["Leading", "Improving", "Weakening", "Lagging"].map((qd) => (
            <div key={qd} style={{ marginBottom: 8 }}>
              <div className="small" style={{ color: QUAD_COLOR[qd], fontWeight: 700 }}>{qd}</div>
              <div className="row" style={{ flexWrap: "wrap" }}>{rot.filter((s) => s.quadrant === qd).map((s) => <Badge key={s.name}>{s.name}</Badge>)}{!rot.some((s) => s.quadrant === qd) && <span className="small muted">none</span>}</div>
            </div>)) : <div className="small muted">No rotation data for this market.</div>}
        </div>
        <div className="card">
          <div className="row between"><h3>Top AI setup scores</h3><a href={href("scores")} className="small">Scores →</a></div>
          {top.map((r) => <div key={r.id} className="row between small"><span><StockLink sec={r.sec} /> <span className="muted">{isCountry ? r.sec.sector : r.sec.country}</span></span><ScoreBar v={r.flat.score} /></div>)}
          {!top.length && <div className="small muted">No scored stocks in this market.</div>}
        </div>
        <div className="card">
          <h3>Weight Watcher: turning up from a low</h3>
          {wwUp.length ? wwUp.map((r) => <div key={r.id} className="row between small"><StockLink sec={r.sec} /><span className="muted">{r.sec.sector} · {r.sec.country}</span></div>) : <div className="small muted">None this quarter{country === "India" ? " (India has no market cap, so no Weight Watcher)" : ""}</div>}
        </div>
      </div>

      {brief && (
        <div className="card brief">
          <div className="row between"><h3>AI insight · {brief.title}</h3><a href={href("briefs")} className="small">All briefs →</a></div>
          {brief.sections.map((s) => <div key={s.title}><b className="small">{s.title}</b>{s.lines.map((l, i) => <p key={i}>{l}</p>)}</div>)}
          <div className="small muted">{brief.note}</div>
        </div>
      )}
    </div>
  );
}
