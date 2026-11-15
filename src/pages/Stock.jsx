import { CHART_TFS } from "../../engine/calendar.js";
// Security page: bottom-up entry point. Every parent (sector, cap segment,
// country, region, global) is one click away, with the stock's full technical,
// relative, Weight Watcher, fundamental and score picture.
import { useEffect, useMemo, useState } from "react";
import { useData } from "../data/store.jsx";
import { useAsync } from "../lib/useAsync.js";
import { href } from "../lib/router.js";
import { PageHead, Badge, Pct, Loading, Seg, Select, STAGE_BADGE, TREND_BADGE, Kpi } from "../components/ui.jsx";
import { TvChart, ChartSync, lineData } from "../components/TvChart.jsx";
import { loadInstrument } from "../lib/series.js";
import { aggregate, emaStrict } from "../../engine/indicators.js";
import { EVENT_LABEL } from "../../engine/signals.js";
import { WW_TREND_LABEL } from "../../engine/weightWatcher.js";
import { Explain } from "./Scores.jsx";
import { NoteBox } from "./Notes.jsx";
import { usePersistent } from "../lib/storage.js";
import { setAgentContext } from "../components/AgentPanel.jsx";
import { fmtMoney, fmtNum } from "../lib/format.js";

export default function Stock({ route }) {
  const d = useData();
  const id = route.args[0];
  const sec = d.secById.get(id);
  useEffect(() => { if (sec) setAgentContext({ page: "stock", instrumentId: id, symbol: sec.symbol, name: sec.name }); return () => setAgentContext(null); }, [id, sec]);
  const [tf, setTf] = useState("D");
  const [wls, setWls] = usePersistent("watchlists", {});
  const [sync] = useState(() => new ChartSync());
  const { data, loading } = useAsync(async () => {
    const [snap, inst, events] = await Promise.all([d.api.snapshot(id), loadInstrument(d.api, { kind: "sec", id }, d), d.api.events(id)]);
    const ww = snap?.ww?.parentKey ? await d.api.ww(snap.ww.parentKey, "stock") : null;
    return { snap, inst, events, ww };
  }, [id]);

  const charts = useMemo(() => {
    if (!data?.inst) return null;
    const b = aggregate({ ...data.inst, volume: data.inst.volume || data.inst.close.map(() => 0) }, tf);
    const markers = [];
    for (const r of data.snap?.f?.results || []) {
      if (!r.filed || r.filed < b.time[0]) continue;
      const t = b.time.find((x) => x >= r.filed);
      if (t) markers.push({ time: t, position: "belowBar", shape: "circle", color: "#a78bfa", text: `R ${r.revenueYoY != null ? `${r.revenueYoY > 0 ? "+" : ""}${r.revenueYoY}%` : ""}` });
    }
    markers.sort((x, y) => (x.time < y.time ? -1 : 1));
    return {
      price: [
        { type: "candles", data: b.time.map((t, i) => ({ time: t, open: b.open[i], high: b.high[i], low: b.low[i], close: b.close[i] })), options: { upColor: "#16a34a", downColor: "#dc2626", borderVisible: false, wickUpColor: "#16a34a", wickDownColor: "#dc2626" }, markers },
        { type: "line", data: lineData(b.time, emaStrict(b.close, 20)), options: { color: "#22d3ee", lineWidth: 1, lastValueVisible: false } },
        { type: "line", data: lineData(b.time, emaStrict(b.close, 50)), options: { color: "#14a44d", lineWidth: 1, lastValueVisible: false } },
        { type: "line", data: lineData(b.time, emaStrict(b.close, 200)), options: { color: "#d97706", lineWidth: 1, lastValueVisible: false } },
      ],
      vol: [{ type: "histogram", data: b.time.map((t, i) => ({ time: t, value: b.volume[i], color: i && b.close[i] >= b.close[i - 1] ? "rgba(22,163,74,.6)" : "rgba(220,38,38,.6)" })), options: { priceFormat: { type: "volume" } } }],
    };
  }, [data, tf]);
  const wwChild = data?.ww?.children.find((c) => c.key === id);

  if (!sec) return <div className="empty">Unknown security</div>;
  const sn = data?.snap?.snap;
  const inList = (k) => wls[k]?.ids.includes(id);
  return (
    <div className="stack">
      <PageHead title={`${sec.symbol} · ${sec.name}`} sub={<span className="crumbs">
        <a href={href("explorer")}>Global</a><span className="sep">›</span><a href={href("explorer", { region: sec.region })}>{sec.region}</a><span className="sep">›</span>
        <a href={href("explorer", { region: sec.region, country: sec.country })}>{sec.country}</a>{sec.capSegment && <><span className="sep">›</span><a href={href("explorer", { region: sec.region, country: sec.country, cap: sec.capSegment })}>{sec.capSegment} Cap</a></>}
        <span className="sep">›</span><a href={href("explorer", { region: sec.region, country: sec.country, sector: sec.sector })}>{sec.sector}</a><span className="sep">›</span>
        <a href={href("explorer", { region: sec.region, country: sec.country, sector: sec.sector, ig: sec.industryGroup })}>{sec.industryGroup}</a></span>}>
        <a className="btn sm primary" href={href(`chart/${id}`)}>Chart lab</a>
        <a className="btn sm" href={href(`screens/RSIACC/${id}`)}>RSIACC</a><a className="btn sm" href={href(`screens/RSCACC/${id}`)}>RSCACC</a>
        <a className="btn sm" href={href(`screens/RSIMMA/${id}`)}>RSIMMA</a><a className="btn sm" href={href(`screens/RSCMMA/${id}`)}>RSCMMA</a>
        <Select value="" options={Object.entries(wls).map(([k, v]) => ({ value: k, label: `${inList(k) ? "✓ " : ""}${v.name}` }))} onChange={(k) => k && setWls({ ...wls, [k]: { ...wls[k], ids: inList(k) ? wls[k].ids.filter((x) => x !== id) : [...wls[k].ids, id] } })} allowEmpty="+ Watchlist" />
      </PageHead>
      {loading ? <Loading /> : !sn ? <div className="note">No stored analysis for this security (too little history, or not in the latest run).</div> : (
        <>
          <div className="grid g4">
            <div className="card"><Kpi label={`Close (${sec.currency}) · ${sn.asOf}`} value={fmtNum(sn.close)} sub={`USD ${fmtNum(sn.closeUsd)} · cap ${fmtMoney(sec.capUsdNow)} (est.)`} /></div>
            <div className="card"><Kpi label="Returns (local)" value={<Pct v={sn.ret["3M"]} />} sub={<>1M <Pct v={sn.ret["1M"]} /> · 12M <Pct v={sn.ret["12M"]} /> · YTD <Pct v={sn.ret.YTD} /></>} /></div>
            <div className="card"><Kpi label="Stage" value={<Badge kind={STAGE_BADGE[sn.stage.id]}>{sn.stage.label}</Badge>} sub={sn.stage.evidence.join("; ")} /></div>
            <div className="card"><Kpi label="Weight Watcher" value={data.snap.ww ? <Badge kind={TREND_BADGE[data.snap.ww.trend]}>{WW_TREND_LABEL[data.snap.ww.trend]}</Badge> : "—"} sub={data.snap.ww?.last != null ? `${data.snap.ww.last.toFixed(3)}% of ${sec.country} ${sec.sector}` : ""} /></div>
          </div>
          <div className="card tight">
            <div className="row between" style={{ padding: "0 4px 4px" }}><span className="small muted">EMA 20 / 50 / 200 · purple dots = results filed (revenue YoY){data.inst.adjustments?.length ? " · split-adjusted" : ""}</span><Seg value={tf} options={CHART_TFS} onChange={setTf} /></div>
            <TvChart height={330} series={charts.price} sync={sync} />
            <TvChart height={90} series={charts.vol} sync={sync} />
          </div>
          <div className="grid g2">
            <div className="card"><h3>Timeframe states</h3>
              <table className="tbl"><thead><tr><th></th><th>Daily</th><th>Weekly</th><th>Monthly</th></tr></thead><tbody>
                {[["MMA", (t) => t?.mma], ["Bull bars", (t) => t?.bullBars], ["RSI / RSI² / RSI³", (t) => (t ? `${t.rsi} / ${t.rsi2} / ${t.rsi3}` : "—")], ["Short MMA spread %", (t) => t?.shortSpread], ["Compression", (t) => String(t?.compression)], ["MACD", (t) => t?.macd], ["Consolidation", (t) => String(t?.consolidation)], ["Breakout (5 bars)", (t) => String(t?.breakoutRecent)], ["Reversal up/down", (t) => `${t?.reversalUp ? "up" : ""}${t?.reversalDown ? "down" : ""}` || "—"]].map(([l, f]) => (
                  <tr key={l}><td className="muted">{l}</td>{["D", "W", "M"].map((k) => <td key={k}>{f(sn.tf[k]) ?? "—"}</td>)}</tr>))}
              </tbody></table>
              {sn.tfShift && <div className="note" style={{ marginTop: 6 }}>{sn.tfShift}</div>}
              <div className="small" style={{ marginTop: 6 }}>Agreement: <Badge kind={sn.agreement.includes("bull") ? "g" : sn.agreement.includes("bear") ? "r" : "a"}>{sn.agreement.replace("_", " ")}</Badge> {sn.bullSignals.length} bullish · {sn.bearSignals.length} bearish</div>
            </div>
            <div className="card"><h3>Relative strength (RSC)</h3>
              <table className="tbl"><thead><tr><th>vs</th><th className="num">1M</th><th className="num">3M</th><th className="num">12M</th><th>Weekly</th></tr></thead><tbody>
                {[["country", `${sec.country} CW`], ["countrySector", `${sec.sector} (${sec.country})`], ["region", `${sec.region} CW`], ["global", "Global CW"]].map(([k, l]) => {
                  const r = sn.rsc[k];
                  return <tr key={k}><td>{l}</td>{["1M", "3M", "12M"].map((h) => <td key={h} className="num"><Pct v={r?.D?.chg?.[h]} /></td>)}
                    <td>{r?.W ? <>{r.W.rising ? <Badge kind="g">rising</Badge> : r.W.falling ? <Badge kind="r">falling</Badge> : <Badge>flat</Badge>}{r.W.turnUp && <Badge kind="g">inflection</Badge>}{r.W.atHigh && <Badge kind="g">high</Badge>}</> : "—"}</td></tr>;
                })}
              </tbody></table>
              <h3 style={{ marginTop: 10 }}>Levels & volume</h3>
              <div className="small">52W high {fmtNum(sn.day.high52)} (<Pct v={sn.day.pctFromHigh52} />) · low {fmtNum(sn.day.low52)} · ATH {fmtNum(sn.day.ath)} (<Pct v={sn.day.pctFromAth} />)</div>
              <div className="small">Volume {sn.day.volRatio}x 50-day · up/down volume {sn.day.udRatio} {sn.day.accumulation && <Badge kind="g">accumulation</Badge>}{sn.day.distribution && <Badge kind="r">distribution</Badge>}{sn.day.pvDivergence && <Badge kind="a">{sn.day.pvDivergence.replace(/_/g, " ")}</Badge>}</div>
              <div className="small">Avg traded value (20d): {fmtMoney(sn.day.tradedValue20Usd)}</div>
            </div>
          </div>
          <div className="grid g2">
            <div className="card">{data.snap.score ? <Explain snap={data.snap} sec={sec} weights={d.settings.scoreWeights} /> : "No score"}</div>
            <div className="stack">
              {wwChild && <div className="card tight"><div className="small muted" style={{ padding: "0 4px 4px" }}>Weight in {sec.country} {sec.sector} CW index (%), quarterly</div>
                <TvChart height={180} series={[{ type: "line", data: data.ww.dates.map((t, i) => ({ time: t, value: wwChild.weights[i] })).filter((x) => x.value != null), options: { color: "#14a44d", lineWidth: 2, pointMarkersVisible: true } }]} /></div>}
              <div className="card"><h3>Fundamentals</h3>
                {data.snap.f ? <div className="small">
                  <div>{data.snap.f.basis} to {data.snap.f.asOf} ({data.snap.f.currency})</div>
                  <div>Revenue growth <Pct v={data.snap.f.revenueGrowthYoY} /> (accel {data.snap.f.revenueGrowthAccel ?? "—"} pts) · EPS growth <Pct v={data.snap.f.epsGrowthYoY} /></div>
                  <div>Gross {data.snap.f.grossMargin ?? "—"}% · operating {data.snap.f.operatingMargin ?? "—"}% · net {data.snap.f.netMargin ?? "—"}% · FCF {data.snap.f.fcfMargin ?? "—"}%</div>
                  <div>ROE {data.snap.f.roe ?? "—"}% · D/E {data.snap.f.debtToEquity ?? "—"} · P/E {data.snap.f.pe ?? "—"}</div>
                  {data.snap.f.improving && <Badge kind="g">improving</Badge>}{data.snap.f.deteriorating && <Badge kind="r">deteriorating</Badge>}
                </div> : <div className="small muted">No fundamental data.</div>}
                {data.snap.glocom && <div className="small" style={{ marginTop: 6 }}>GLOCOM: <b>{data.snap.glocom.label}</b> (code {data.snap.glocom.code})</div>}
              </div>
              <div className="card"><h3>Recent inflections</h3>
                {data.events.slice(-8).reverse().map((e, i) => <div key={i} className="row between small"><span>{e.date} · {EVENT_LABEL[e.type] || e.type}</span><span>{e.fwd?.["1M"] != null ? <>1M after <Pct v={e.fwd["1M"]} /></> : <span className="muted">open</span>}</span></div>)}
                <a className="small" href={href("backtest", { tab: "log", id })}>Full inflection history →</a>
              </div>
              <div className="card"><h3>Research notes</h3><NoteBox target={`sec:${id}`} label={sec.symbol} /></div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
