// Market breadth: advance/decline, % above 20/50/200-day EMA, new 52-week
// highs and lows, EW/CW participation, bullish-MMA share and sector
// participation, with automatic breadth-divergence detection.
import { useMemo, useState } from "react";
import { useData } from "../data/store.jsx";
import { useAsync } from "../lib/useAsync.js";
import { PageHead, Select, Badge, Kpi, Loading, Pct } from "../components/ui.jsx";
import { TvChart, ChartSync, lineData } from "../components/TvChart.jsx";
import { DataTable } from "../components/DataTable.jsx";
import { breadthDivergence } from "../../engine/breadth.js";
import { ewcw } from "../../engine/analytics.js";

export default function Breadth({ route }) {
  const d = useData();
  const { data: keys } = useAsync(() => d.api.breadthKeys(), []);
  const [scope, setScope] = useState(route.query.scope || "G");
  const ccy = scope.startsWith("C:") ? "LCL" : "USD";
  const [sync] = useState(() => new ChartSync());
  const { data: raw, loading } = useAsync(async () => {
    const [b, cw, ew] = await Promise.all([d.api.breadth(scope), d.api.indexSeries(`CW|${ccy}|${scope}`), d.api.indexSeries(`EW|${ccy}|${scope}`)]);
    const sectorKeys = (keys || []).filter((k) => k.light && k.key.startsWith(`${scope}|S:`));
    const sectors = await Promise.all(sectorKeys.map(async (k) => ({ name: k.key.split("|S:")[1], rec: await d.api.breadth(k.key) })));
    return { b, cw, ew, sectors };
  }, [scope, keys?.length]);
  // period: a standard look-back or the user's own from / to dates
  const [per, setPer] = useState("All");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const data = useMemo(() => {
    if (!raw?.b) return raw;
    const dates = raw.b.dates, last = dates.at(-1);
    let a = "0000-00-00", z = to || last;
    if (per === "Custom") a = from || a;
    else if (per !== "All") {
      const e = new Date(`${(to || last)}T00:00:00Z`);
      if (per === "YTD") a = `${(to || last).slice(0, 4)}-01-01`;
      else { const k = +per.slice(0, -1); if (per.endsWith("M")) e.setUTCMonth(e.getUTCMonth() - k); else e.setUTCFullYear(e.getUTCFullYear() - k); a = e.toISOString().slice(0, 10); }
    }
    const idx = []; dates.forEach((x, i) => { if (x >= a && x <= z) idx.push(i); });
    if (idx.length < 2) return raw;
    const cut = (o) => { if (!o) return o; const out = {}; for (const [k, v] of Object.entries(o)) out[k] = Array.isArray(v) && v.length === dates.length ? idx.map((i) => v[i]) : v; return out; };
    const cutSeries = (s) => { if (!s) return s; const ok = idx.length ? s.dates : []; const set = new Set(idx.map((i) => dates[i])); const keep = []; ok.forEach((x, i) => { if (set.has(x)) keep.push(i); }); const out = {}; for (const [k, v] of Object.entries(s)) out[k] = Array.isArray(v) && v.length === s.dates.length ? keep.map((i) => v[i]) : v; return out; };
    return { ...raw, b: cut(raw.b), cw: cutSeries(raw.cw), ew: cutSeries(raw.ew), sectors: raw.sectors };
  }, [raw, per, from, to]);
  const scopes = (keys || []).filter((k) => !k.light).map((k) => k.key).sort((a, b) => (a === "G" ? -1 : b === "G" ? 1 : a.localeCompare(b)));
  const label = (k) => (k === "G" ? "Global" : `${k.slice(2)} (${{ R: "region", M: "classification", C: "country" }[k[0]]})`);
  const charts = useMemo(() => {
    if (!data?.b) return null;
    const b = data.b;
    const ratio = data.cw && data.ew ? ewcw(data.ew, data.cw) : null;
    return {
      idx: [{ type: "line", data: lineData(data.cw.dates, data.cw.level), options: { color: "#14a44d", lineWidth: 2, title: "CW index" } }],
      ad: [{ type: "line", data: lineData(b.dates, b.adLine), options: { color: "#2563eb", lineWidth: 2, title: "A/D line" } }],
      pct: [{ type: "line", data: lineData(b.dates, b.pct20), options: { color: "#22d3ee", lineWidth: 1, title: "% > 20d" } }, { type: "line", data: lineData(b.dates, b.pct50), options: { color: "#14a44d", lineWidth: 2, title: "% > 50d" }, priceLines: [{ price: 50, color: "#6b7280" }] }, { type: "line", data: lineData(b.dates, b.pct200), options: { color: "#d97706", lineWidth: 1, title: "% > 200d" } }],
      hl: [{ type: "histogram", data: lineData(b.dates, b.newHigh), options: { color: "#16a34a", title: "52W highs" } }, { type: "histogram", data: lineData(b.dates, b.newLow.map((x) => -x)), options: { color: "#dc2626", title: "52W lows" } }],
      mma: [{ type: "line", data: lineData(b.dates, b.pctBullMma), options: { color: "#a78bfa", lineWidth: 2, title: "% bullish weekly MMA" } }],
      ewcw: ratio ? [{ type: "line", data: lineData(ratio.dates, ratio.ratio), options: { color: "#f472b6", lineWidth: 2, title: "EW/CW" }, priceLines: [{ price: 100, color: "#6b7280" }] }] : [],
    };
  }, [data]);
  const div = data?.b && data?.cw ? breadthDivergence(data.cw, data.b) : null;
  const n = data?.b ? data.b.dates.length - 1 : -1;
  return (
    <div className="stack">
      <PageHead title="Market breadth" sub="Participation behind the index. A rising index with deteriorating breadth is flagged automatically.">
        <Select label="Market" value={scope} options={scopes.map((k) => ({ value: k, label: label(k) }))} onChange={setScope} />
        <Select label="Period" value={per} options={["1M", "3M", "6M", "YTD", "1Y", "3Y", "5Y", "All", "Custom"]} onChange={(v) => setPer(v || "All")} />
        {per === "Custom" && <><label className="lbl-ctl">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label><label className="lbl-ctl">To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label></>}
      </PageHead>
      {loading || !charts ? <Loading /> : (
        <>
          <div className="grid g4">
            <div className="card"><Kpi label="Advancers / decliners" value={`${data.b.adv[n]} / ${data.b.dec[n]}`} sub={`of ${data.b.n[n]} listed · ${data.b.dates[n]}`} /></div>
            <div className="card"><Kpi label="% above 50 / 200-day" value={`${data.b.pct50[n]}% / ${data.b.pct200[n]}%`} sub={`20-day: ${data.b.pct20[n]}%`} /></div>
            <div className="card"><Kpi label="New 52W highs / lows" value={`${data.b.newHigh[n]} / ${data.b.newLow[n]}`} sub={`bullish weekly MMA: ${data.b.pctBullMma[n] ?? "—"}%`} /></div>
            <div className="card"><Kpi label="Breadth divergence (20 sessions)" value={div?.flag ? "Yes" : "No"} cls={div?.flag ? "neg" : "pos"} sub={div ? (div.flag ? div.reasons.join("; ") : `index ${div.indexChg > 0 ? "+" : ""}${div.indexChg}%, participation not deteriorating`) : ""} /></div>
          </div>
          <div className="grid g2">
            {[["CW index", charts.idx], ["Advance / decline line", charts.ad], ["% above 20 / 50 / 200-day EMA", charts.pct], ["New 52-week highs (up) and lows (down)", charts.hl], ["% of stocks with a bullish weekly MMA", charts.mma], ["EW / CW ratio (participation)", charts.ewcw]].map(([t, s]) => (
              <div key={t} className="card tight"><div className="small muted" style={{ padding: "0 4px 4px" }}>{t}</div><TvChart height={190} series={s} sync={sync} /></div>))}
          </div>
          {data.sectors.length > 0 && <div className="card"><h3>Sector participation (% above 50-day EMA)</h3>
            <DataTable exportName="sector_participation" rowKey={(r) => r.name} pageSize={20} initialSort={{ key: "now", dir: "desc" }}
              rows={data.sectors.map((s) => { const p = s.rec.pct50, k = p.length - 1; return { name: s.name, now: p[k], c1: k >= 21 ? p[k] - p[k - 21] : null, c3: k >= 63 ? p[k] - p[k - 63] : null }; })}
              columns={[{ key: "name", label: "Sector", value: (r) => r.name }, { key: "now", label: "% > 50d", num: true, value: (r) => r.now },
                { key: "c1", label: "Δ 1M (pts)", num: true, value: (r) => r.c1, render: (r) => <Pct v={r.c1} /> }, { key: "c3", label: "Δ 3M (pts)", num: true, value: (r) => r.c3, render: (r) => <Pct v={r.c3} /> },
                { key: "state", label: "", value: (r) => (r.now >= 60 ? "broad" : r.now <= 40 ? "narrow" : "mixed"), render: (r) => <Badge kind={r.now >= 60 ? "g" : r.now <= 40 ? "r" : ""}>{r.now >= 60 ? "broad" : r.now <= 40 ? "narrow" : "mixed"}</Badge> }]} /></div>}
        </>
      )}
    </div>
  );
}
