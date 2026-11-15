// Cross-asset context: equities, REITs, commodities, crypto, currencies and
// fixed income on one page, in USD: returns heatmap, correlation matrix,
// volatility and relative strength against global equities.
import { useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { PageHead, Seg, Loading, ErrorBox, Empty, Pct } from "../components/ui.jsx";
import { DataTable } from "../components/DataTable.jsx";
import { TvChart, PALETTE } from "../components/TvChart.jsx";
import { useAsync } from "../lib/useAsync.js";
import { DATA_SOURCE } from "../data/api.js";
import { XASSETS, XASSET_CLASSES, xReturns, correlationMatrix, weeklyVol, relativeLine } from "../../engine/crossAsset.js";

async function loadSeries() {
  if (DATA_SOURCE === "demo") {
    // Demo: deterministic random walks with class-level co-movement (DEMO DATA banner is shown).
    let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const g = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, rnd()))) * Math.cos(2 * Math.PI * rnd());
    const dates = []; for (let t = Date.parse("2023-01-02"); dates.length < 900; t += 86400000) { const d = new Date(t); if (d.getUTCDay() % 6) dates.push(d.toISOString().slice(0, 10)); }
    const common = {}; for (const c of XASSET_CLASSES) common[c] = dates.map(() => g());
    const mkt = dates.map(() => g());
    return XASSETS.map((a, i) => { let p = 100; const vol = { Equities: 0.011, REITs: 0.013, Commodities: 0.014, Crypto: 0.035, Currencies: 0.005, "Fixed income": 0.006 }[a.cls]; const beta = a.cls === "Equities" || a.cls === "REITs" ? 0.8 : a.cls === "Crypto" ? 0.5 : a.cls === "Fixed income" ? -0.2 : 0.1;
      return { key: a.key, label: a.label, cls: a.cls, source: "demo", dates, close: dates.map((_, k) => (p *= Math.exp(vol * (0.6 * common[a.cls][k] + beta * mkt[k] + 0.5 * g()) + 0.0002 * (i % 3)))) }; });
  }
  const sb = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await sb.from("tas_xasset").select("key,label,asset_class,source,currency,dates,close,updated_at");
  if (error) throw new Error(error.message);
  const order = new Map(XASSETS.map((a, i) => [a.key, i]));
  return data.map((r) => ({ key: r.key, label: r.label, cls: r.asset_class, source: r.source, updated: r.updated_at, dates: r.dates, close: r.close })).sort((a, b) => (order.get(a.key) ?? 99) - (order.get(b.key) ?? 99));
}

const heat = (v) => (v == null ? "transparent" : `hsla(${v >= 0 ? 140 : 0}, 70%, 42%, ${Math.min(0.85, Math.abs(v) * 6 + 0.08)})`);

export default function CrossAsset() {
  const { data, loading, error } = useAsync(loadSeries, []);
  const [weeks, setWeeks] = useState(52);
  const [h, setH] = useState("3M");
  const rows = useMemo(() => (data || []).map((s) => ({ ...s, id: s.key, ret: xReturns(s), vol: weeklyVol(s, weeks), last: s.dates.at(-1) })), [data, weeks]);
  const corr = useMemo(() => (data?.length ? correlationMatrix(data, weeks) : null), [data, weeks]);
  const glob = data?.find((s) => s.key === "EQ_GLOBAL");
  const rsSeries = useMemo(() => {
    if (!glob) return [];
    const reps = ["EQ_EM", "RE_US", "CM_GOLD", "CM_OIL", "CR_BTC", "FX_USD", "FI_LONG", "FI_HY"];
    return reps.map((k, i) => { const s = data.find((x) => x.key === k); if (!s) return null; const r = relativeLine(s, glob); return { id: k, type: "line", data: r.dates.map((d, j) => ({ time: d, value: r.values[j] })), options: { color: PALETTE[i % PALETTE.length], lineWidth: 2, title: s.label.split(" (")[0] } }; }).filter(Boolean);
  }, [data, glob]);
  if (loading) return <Loading what="cross-asset series" />;
  if (error) return <ErrorBox error={error} />;
  if (!data?.length) return <Empty>No cross-asset series yet. The server builds them once a day (tas_xasset).</Empty>;
  const missing = XASSETS.filter((a) => !data.some((s) => s.key === a.key));
  return (
    <div className="stack">
      <PageHead title="Cross-asset context" sub="Equities, REITs, commodities, crypto, currencies and fixed income side by side, in USD." />
      <div className="card">
        <div className="row between"><div className="h3">Returns</div><Seg value={h} onChange={setH} options={["1W", "1M", "3M", "6M", "12M", "YTD"]} /></div>
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 6 }}>
          {rows.map((r) => <div key={r.key} className="card tight" style={{ background: heat(r.ret[h]) }} title={`${r.label} · ${r.source} · last ${r.last}`}><div className="small">{r.label}</div><div style={{ fontWeight: 700 }}><Pct v={r.ret[h] == null ? null : r.ret[h] * 100} /></div><div className="small muted">{r.cls}</div></div>)}
        </div>
      </div>
      <div className="card">
        <DataTable rows={rows} exportName="cross-asset" columns={[
          { key: "c", label: "Class", value: (r) => r.cls }, { key: "l", label: "Asset", value: (r) => r.label },
          ...["1W", "1M", "3M", "6M", "12M", "YTD"].map((k) => ({ key: k, label: k, num: true, value: (r) => r.ret[k], render: (r) => <Pct v={r.ret[k] == null ? null : r.ret[k] * 100} /> })),
          { key: "v", label: `Volatility (${weeks}w)`, num: true, value: (r) => r.vol, render: (r) => (r.vol == null ? "—" : `${(r.vol * 100).toFixed(1)}%`) },
          { key: "d", label: "Last", value: (r) => r.last }, { key: "s", label: "Source", value: (r) => r.source },
        ]} />
        {missing.length > 0 && <p className="legend-note">Not available yet: {missing.map((m) => m.label).join(", ")}.</p>}
      </div>
      <div className="card">
        <div className="row between"><div className="h3">Correlation of weekly returns ({corr?.weeks} weeks)</div><Seg value={weeks} onChange={setWeeks} options={[{ value: 26, label: "26w" }, { value: 52, label: "52w" }, { value: 156, label: "3y" }]} /></div>
        <div className="tbl-wrap"><table className="tbl chain">
          <thead><tr><th />{data.map((s) => <th key={s.key} title={s.label} style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", height: 110 }}>{s.label.split(" (")[0]}</th>)}</tr></thead>
          <tbody>{data.map((s, i) => <tr key={s.key}><td className="small">{s.label.split(" (")[0]}</td>{corr.matrix[i].map((v, j) => <td key={j} className="num" style={{ background: v == null ? undefined : `hsla(${v >= 0 ? 210 : 20}, 75%, 45%, ${Math.abs(v) * 0.85})`, color: v != null && Math.abs(v) > 0.5 ? "#fff" : undefined }}>{v == null ? "" : v.toFixed(2)}</td>)}</tr>)}</tbody>
        </table></div>
        <p className="legend-note">Weekly returns align markets with different holidays and closing times. Blue = move together, orange = move opposite.</p>
      </div>
      {rsSeries.length > 0 && <div className="card"><div className="h3">Relative strength vs global equities (rebased to 100)</div><TvChart height={300} series={rsSeries} /></div>}
    </div>
  );
}
