// Global opportunity funnel: global -> region -> country -> sector -> industry
// group -> stock, keeping the strongest at each step by relative strength.
// Automatic by default; any step can be overridden by hand.
import { useMemo, useState } from "react";
import { useData } from "../data/store.jsx";
import { useAsync } from "../lib/useAsync.js";
import { PageHead, Seg, Pct, Loading, StockLink, ScoreBar, ErrorBox } from "../components/ui.jsx";
import { changeOver, HBARS } from "../lib/indexMath.js";
import { countryFamily } from "../../engine/geography.js";

const rel = (s, b, h) => { const a = changeOver(s, HBARS[h]), c = changeOver(b, HBARS[h]); return a != null && c != null ? ((1 + a / 100) / (1 + c / 100) - 1) * 100 : null; };

export default function Funnel({ route }) {
  const d = useData();
  const [h, setH] = useState("3M");
  const [topN, setTopN] = useState(2);
  // owner (Nov 2026): start the funnel at a country (US, India) as well as at Global
  const [pick, setPick] = useState(() => (route?.query?.country ? { country: route.query.country } : {}));
  const { data, loading, error } = useAsync(async () => {
    const g = await d.api.indexSeries("CW|USD|G");
    const reg = await Promise.all(d.regions.map(async (r) => ({ name: r, s: await d.api.indexSeries(`CW|USD|R:${r}`) })));
    const ctry = await Promise.all(d.countries.map(async (c) => ({ name: c, region: d.secs.find((s) => s.country === c)?.region, ...(await Promise.all([d.api.indexSeries(`${countryFamily(c)}|USD|C:${c}`), d.api.indexSeries(`${countryFamily(c)}|LCL|C:${c}`)]).then(([s, l]) => ({ s, l }), () => ({ s: null, l: null }))) })));
    return { g, reg: reg.filter((x) => x.s), ctry: ctry.filter((x) => x.s) };
  }, []);
  const steps = useMemo(() => {
    if (!data) return null;
    const regions = data.reg.map((r) => ({ ...r, v: rel(r.s, data.g, h) })).filter((r) => r.v != null).sort((a, b) => b.v - a.v);
    const pinnedRegion = pick.country ? data.ctry.find((c) => c.name === pick.country)?.region : null;
    const selR = pick.region ? [pick.region] : pinnedRegion ? [pinnedRegion] : regions.slice(0, topN).map((r) => r.name);
    const countries = data.ctry.filter((c) => selR.includes(c.region)).map((c) => ({ ...c, v: rel(c.s, data.reg.find((r) => r.name === c.region)?.s, h) })).filter((c) => c.v != null).sort((a, b) => b.v - a.v);
    const selC = pick.country ? [pick.country] : countries.slice(0, topN).map((c) => c.name);
    return { regions, selR, countries, selC };
  }, [data, h, topN, pick]);
  const { data: sect } = useAsync(async () => {
    if (!steps) return [];
    const jobs = [];
    for (const c of steps.selC) {
      const base = data.ctry.find((x) => x.name === c)?.l;
      for (const s of d.sectors) {
        const key = `${countryFamily(c)}|LCL|C:${c}|S:${s}`;
        if (!d.indexByKey.has(key)) continue;
        jobs.push(d.api.indexSeries(key).then((ser) => ({ country: c, name: s, v: rel(ser, base, h) }), () => ({ country: c, name: s, v: null })));
      }
    }
    const out = await Promise.all(jobs);
    return out.filter((x) => x.v != null).sort((a, b) => b.v - a.v);
  }, [steps?.selC.join(), h]);
  const selS = pick.sector ? sect?.filter((x) => `${x.country}|${x.name}` === pick.sector) : sect?.slice(0, topN * 2);
  const igs = useMemo(() => {
    if (!selS) return [];
    const m = new Map();
    for (const r of d.rows) {
      if ((r.sec.assetClass || "Stock") !== "Stock") continue; // house-index rows and funds are not stocks
      if (!selS.some((s) => s.country === r.sec.country && s.name === r.sec.sector)) continue;
      const k = `${r.sec.country}|${r.sec.industryGroup}`;
      if (!m.has(k)) m.set(k, { key: k, country: r.sec.country, name: r.sec.industryGroup, a: 0, w: 0, rows: [] });
      // cap-weighted where caps exist; a country without a reliable cap (India) is averaged equally
      const g = m.get(k), v = r.flat[`rscChg_country_${h}`], c = countryFamily(r.sec.country) === "EW" ? 1 : r.sec.capUsdNow || 0;
      g.rows.push(r); if (v != null && c) { g.a += v * c; g.w += c; }
    }
    return [...m.values()].map((g) => ({ ...g, v: g.w ? g.a / g.w : null })).filter((g) => g.v != null).sort((a, b) => b.v - a.v);
  }, [selS, d.rows, h]);
  const selIG = pick.ig ? igs.filter((g) => g.key === pick.ig) : igs.slice(0, topN * 2);
  const stocks = useMemo(() => selIG.flatMap((g) => g.rows).filter((r) => r.flat[`rscChg_country_${h}`] != null).sort((a, b) => (b.flat.score ?? 0) - (a.flat.score ?? 0)).slice(0, 25), [selIG, h]);

  if (error) return <ErrorBox error={error} />;
  if (loading || !steps) return <Loading what="funnel" />;
  return (
    <div className="stack">
      <PageHead title="Global opportunity funnel" sub={`Each step keeps the strongest by relative strength vs its parent over ${h}. Click any item to fix that step by hand; click again to return to automatic.`}>
        <Seg value={h} options={["1M", "3M", "6M", "12M"]} onChange={setH} />
        <Seg value={topN} options={[1, 2, 3].map((n) => ({ value: n, label: `top ${n}` }))} onChange={setTopN} />
        <Seg value={pick.country === "United States" ? "us" : pick.country === "India" ? "in" : pick.country ? "other" : "g"} options={[{ value: "g", label: "Global" }, { value: "us", label: "US" }, { value: "in", label: "India" }]}
          onChange={(v) => setPick(v === "us" ? { country: "United States" } : v === "in" ? { country: "India" } : {})} />
        <button className="btn sm" onClick={() => setPick({})}>Reset to automatic</button>
      </PageHead>
      <div className="grid" style={{ gridTemplateColumns: "repeat(5, minmax(0,1fr))" }}>
        <FunnelCol title="1 · Regions vs global" items={steps.regions} selected={(x) => steps.selR.includes(x.name)} onPick={(x) => setPick({ region: pick.region === x.name ? null : x.name })} render={(x) => <span>{x.name}</span>} />
        <FunnelCol title="2 · Countries vs region" items={steps.countries} selected={(x) => steps.selC.includes(x.name)} onPick={(x) => setPick({ ...pick, country: pick.country === x.name ? null : x.name, sector: null, ig: null })} render={(x) => <span>{x.name}</span>} />
        <FunnelCol title="3 · Sectors vs country" items={sect || []} selected={(x) => selS?.includes(x)} onPick={(x) => setPick({ ...pick, sector: pick.sector === `${x.country}|${x.name}` ? null : `${x.country}|${x.name}`, ig: null })} render={(x) => <span>{x.name} <span className="muted">{x.country}</span></span>} />
        <FunnelCol title="4 · Industry groups" items={igs} selected={(x) => selIG.includes(x)} onPick={(x) => setPick({ ...pick, ig: pick.ig === x.key ? null : x.key })} render={(x) => <span>{x.name} <span className="muted">{x.country}</span></span>} />
        <div className="card"><h3>5 · Stocks (by AI score)</h3>
          {stocks.map((r) => <div key={r.id} className="row between small"><StockLink sec={r.sec} /><ScoreBar v={r.flat.score} /></div>)}</div>
      </div>
    </div>
  );
}

function FunnelCol({ title, items, selected, onPick, render }) {
  return (
    <div className="card" style={{ minWidth: 0 }}>
      <h3>{title}</h3>
      {items.map((x) => (
        <div key={x.key || x.name + (x.country || "")} className="row between small" style={{ padding: "3px 4px", borderRadius: 4, cursor: onPick ? "pointer" : "default", background: selected(x) ? "var(--gq-soft)" : "transparent" }} onClick={() => onPick?.(x)}>
          {render(x)}<Pct v={x.v} />
        </div>))}
    </div>);
}
