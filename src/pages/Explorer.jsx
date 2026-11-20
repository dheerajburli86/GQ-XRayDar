// Top-down / bottom-up navigation: Global -> Region -> Country -> Cap segment
// -> Sector -> Industry group -> Stock, with every level shown against its parent.
import { useMemo } from "react";
import { useData } from "../data/store.jsx";
import { useAsync } from "../lib/useAsync.js";
import { navigate, href } from "../lib/router.js";
import { PageHead, Seg, Pct, Badge, TREND_BADGE, Loading } from "../components/ui.jsx";
import { DataTable } from "../components/DataTable.jsx";
import { TvChart, lineData } from "../components/TvChart.jsx";
import { idColumns, fieldColumn, applyScope } from "../components/pickers.jsx";
import { HBARS, changeOver } from "../lib/indexMath.js";
import { wwTrend, WW_TREND_LABEL } from "../../engine/weightWatcher.js";
import { CAPS } from "../../engine/indexEngine.js";

const H = ["1W", "1M", "3M", "6M", "12M"];

export default function Explorer({ route }) {
  const d = useData();
  const q = route.query;
  const level = q.ig || q.sub ? "ig" : q.sector ? "sector" : q.cap ? "cap" : q.country ? "country" : q.region ? "region" : "global";
  const fam = d.settings.family, rel = d.settings.relative;
  const ccy = q.country && d.settings.ccy === "LCL" ? "LCL" : "USD";
  const groupBy = q.group || (level === "global" ? "region" : level === "region" ? "country" : level === "country" ? "cap" : "sector");
  const set = (patch) => navigate("explorer", { ...q, ...patch });

  // parent index + children definitions
  const parentScope = q.country ? `C:${q.country}${q.sector && !q.cap ? `|S:${q.sector}` : ""}${q.sector && q.cap ? `|S:${q.sector}|K:${q.cap}` : ""}${q.cap && !q.sector ? `|K:${q.cap}` : ""}` : q.region ? `R:${q.region}` : "G";
  const children = useMemo(() => {
    const ex = (k) => d.indexByKey.has(`${fam}|${ccy}|${k}`);
    if (level === "global") {
      if (groupBy === "classification") return d.classifications.map((c) => ({ name: c, scope: `M:${c}`, go: null, wwP: ["G", "classification"] })).filter((c) => ex(c.scope));
      if (groupBy === "country") return d.countries.map((c) => ({ name: c, scope: `C:${c}`, go: { country: c, region: d.secs.find((s) => s.country === c)?.region }, wwP: ["G", "country"] })).filter((c) => ex(c.scope));
      if (groupBy === "sector") return d.sectors.map((s) => ({ name: s, scope: `G|S:${s}`, go: null, wwP: ["G", "sector"] })).filter((c) => ex(c.scope));
      if (groupBy === "cap") return CAPS.map((s) => ({ name: s, scope: `G|K:${s}`, go: null, wwP: ["G", "cap"] })).filter((c) => ex(c.scope));
      return d.regions.map((r) => ({ name: r, scope: `R:${r}`, go: { region: r }, wwP: ["G", "region"] })).filter((c) => ex(c.scope));
    }
    if (level === "region") {
      if (groupBy === "sector") return d.sectors.map((s) => ({ name: s, scope: `R:${q.region}|S:${s}`, go: null, wwP: [`R:${q.region}`, "sector"] })).filter((c) => ex(c.scope));
      return d.countries.filter((c) => d.secs.some((s) => s.country === c && s.region === q.region)).map((c) => ({ name: c, scope: `C:${c}`, go: { country: c }, wwP: [`R:${q.region}`, "country"] })).filter((c) => ex(c.scope));
    }
    if (level === "country") {
      if (groupBy === "sector") return d.sectors.map((s) => ({ name: s, scope: `C:${q.country}|S:${s}`, go: { sector: s }, wwP: [`C:${q.country}`, "sector"] })).filter((c) => ex(c.scope));
      return CAPS.map((k) => ({ name: `${k} Cap`, scope: `C:${q.country}|K:${k}`, go: { cap: k }, wwP: [`C:${q.country}`, "cap"], wwKey: k })).filter((c) => ex(c.scope));
    }
    if (level === "cap") return d.sectors.map((s) => ({ name: s, scope: `C:${q.country}|S:${s}|K:${q.cap}`, go: { sector: s }, wwP: null })).filter((c) => ex(c.scope));
    return [];
  }, [level, groupBy, d, fam, ccy, q.region, q.country, q.cap]);

  const parentKey = `${fam}|${ccy}|${parentScope}`;
  const wwParent = children[0]?.wwP;
  const { data, loading } = useAsync(async () => {
    const [parent, ...ser] = await Promise.all([d.api.indexSeries(parentKey), ...children.map((c) => d.api.indexSeries(`${fam}|${ccy}|${c.scope}`))]);
    const ww = wwParent ? await d.api.ww(wwParent[0], wwParent[1]) : null;
    const pairs = await Promise.all(children.map((c) => d.api.indexSeries(`${fam === "CW" ? "EW" : "CW"}|${ccy}|${c.scope}`)));
    return { parent, ser, ww, pairs };
  }, [parentKey, children.map((c) => c.scope).join(",")]);

  const rowsAtLevel = useMemo(() => {
    const rs = applyScope(d.rows, { region: q.region, country: q.country, cap: q.cap, sector: q.sector, industryGroup: q.ig });
    return q.sub ? rs.filter((r) => r.sec.subIndustry === q.sub) : rs;
  }, [d.rows, q.region, q.country, q.cap, q.sector, q.ig, q.sub]);
  // sub-industries inside the current sector / industry group (stocks without one, outside the owner's US workbook and rules, are not listed)
  const subs = useMemo(() => {
    if (level !== "sector" && level !== "ig") return [];
    const m = new Map();
    for (const r of rowsAtLevel) {
      const k = r.sec.subIndustry; if (!k) continue;
      if (!m.has(k)) m.set(k, { name: k, n: 0, cap: 0, w: {} });
      const g = m.get(k); g.n++; const c = r.sec.capUsdNow || 0; g.cap += c;
      for (const h of H) { const v = r.flat[`retUsd${h}`]; if (v != null && c) { g.w[h] = (g.w[h] || 0) + v * c; g[`c${h}`] = (g[`c${h}`] || 0) + c; } }
    }
    return [...m.values()].map((g) => ({ ...g, ret: Object.fromEntries(H.map((h) => [h, g[`c${h}`] ? g.w[h] / g[`c${h}`] : null])) }));
  }, [rowsAtLevel, level]);
  const igs = useMemo(() => {
    if (level !== "sector") return [];
    const m = new Map();
    for (const r of rowsAtLevel) {
      const k = r.sec.industryGroup; if (!m.has(k)) m.set(k, { name: k, n: 0, cap: 0, w: {} });
      const g = m.get(k); g.n++; const c = r.sec.capUsdNow || 0; g.cap += c;
      for (const h of H) { const v = r.flat[`retUsd${h}`]; if (v != null && c) { g.w[h] = (g.w[h] || 0) + v * c; g[`c${h}`] = (g[`c${h}`] || 0) + c; } }
    }
    return [...m.values()].map((g) => ({ ...g, ret: Object.fromEntries(H.map((h) => [h, g[`c${h}`] ? g.w[h] / g[`c${h}`] : null])) }));
  }, [rowsAtLevel, level]);

  const crumbs = [["Global", {}]];
  if (q.region) crumbs.push([q.region, { region: q.region }]);
  if (q.country) crumbs.push([q.country, { region: q.region, country: q.country }]);
  if (q.cap) crumbs.push([`${q.cap} Cap`, { region: q.region, country: q.country, cap: q.cap }]);
  if (q.sector) crumbs.push([q.sector, { region: q.region, country: q.country, cap: q.cap, sector: q.sector }]);
  if (q.ig) crumbs.push([q.ig, { ...q, sub: undefined }]);
  if (q.sub) crumbs.push([q.sub, { ...q }]);

  const pRet = (h) => changeOver(data?.parent, HBARS[h]);
  const childRows = children.map((c, i) => {
    const s = data?.ser[i], pair = data?.pairs[i];
    const ret = Object.fromEntries(H.map((h) => [h, changeOver(s, HBARS[h])]));
    const wch = data?.ww?.children.find((x) => x.key === (c.wwKey || c.name));
    const tr = wch ? wwTrend(wch.weights) : null;
    const ewcw = s && pair ? (fam === "CW" ? changeOver(pair, 63) - changeOver(s, 63) : changeOver(s, 63) - changeOver(pair, 63)) : null;
    return { id: c.scope, ...c, ret, n: s?.n?.at(-1), weight: tr?.last, wtrend: tr?.trend, ewcw, regime: d.regimes[`CW|${ccy}|${c.scope}`]?.label };
  });
  const show = (r, h) => (rel ? (r.ret[h] != null && pRet(h) != null ? r.ret[h] - pRet(h) : null) : r.ret[h]);

  const cols = [
    { key: "name", label: "Name", value: (r) => r.name, render: (r) => (r.go ? <a href={href("explorer", { ...q, ...r.go, group: undefined })}>{r.name}</a> : r.name) },
    ...H.map((h) => ({ key: h, label: rel ? `${h} vs parent` : h, num: true, value: (r) => show(r, h), render: (r) => <Pct v={show(r, h)} /> })),
    { key: "n", label: "Constituents", num: true, value: (r) => r.n },
    { key: "w", label: "CW weight %", num: true, value: (r) => r.weight, render: (r) => (r.weight != null ? r.weight.toFixed(2) : "—"), title: "Weight Watcher: weight in the parent CW index" },
    { key: "wt", label: "Weight trend", value: (r) => r.wtrend, render: (r) => (r.wtrend ? <Badge kind={TREND_BADGE[r.wtrend]}>{WW_TREND_LABEL[r.wtrend]}</Badge> : "—") },
    { key: "ewcw", label: "EW - CW 3M (pts)", num: true, value: (r) => r.ewcw, render: (r) => <Pct v={r.ewcw} />, title: "Equal-weight minus cap-weight return: positive = broad participation" },
    { key: "reg", label: "Regime", value: (r) => r.regime },
    { key: "idx", label: "", value: () => null, export: false, render: (r) => <a href={href("indices", { key: `${fam}|${ccy}|${r.scope}` })} className="small">index</a> },
  ];

  const groupOpts = level === "global" ? ["region", "classification", "country", "sector", "cap"] : level === "region" ? ["country", "sector"] : level === "country" ? ["cap", "sector"] : null;
  return (
    <div className="stack">
      <PageHead title="Top-down explorer" sub="Global → region → country → cap segment → sector → industry group → stock. Click any row to drill down; use the breadcrumbs (or a stock's page) to go back up.">
        <Seg value={fam} options={["CW", "EW"]} onChange={(v) => d.setSetting("family", v)} title="Index family" />
        {q.country && <Seg value={d.settings.ccy} options={[{ value: "LCL", label: "Local" }, { value: "USD", label: "USD" }]} onChange={(v) => d.setSetting("ccy", v)} />}
        <Seg value={rel ? "rel" : "abs"} options={[{ value: "abs", label: "Absolute" }, { value: "rel", label: "Relative to parent" }]} onChange={(v) => d.setSetting("relative", v === "rel")} />
      </PageHead>
      <div className="crumbs">{crumbs.map(([l, p], i) => <span key={i} className="row" style={{ gap: 6 }}>{i > 0 && <span className="sep">›</span>}{i < crumbs.length - 1 ? <a onClick={() => navigate("explorer", p)}>{l}</a> : <b>{l}</b>}</span>)}</div>
      {groupOpts && <div className="row"><span className="small muted">Children:</span><Seg value={groupBy} options={groupOpts.map((g) => ({ value: g, label: g === "cap" ? "cap segment" : g }))} onChange={(v) => set({ group: v })} /></div>}
      {loading ? <Loading /> : (
        <>
          {data?.parent && <div className="card tight">
            <div className="small muted" style={{ padding: "0 4px 4px" }}>{d.indexByKey.get(parentKey)?.name} — {H.map((h) => `${h} ${pRet(h) != null ? pRet(h).toFixed(1) : "—"}%`).join(" · ")}</div>
            <TvChart height={200} series={[{ id: "p", type: "area", data: lineData(data.parent.dates, data.parent.level), options: { lineColor: "#14a44d", topColor: "rgba(20,164,77,.25)", bottomColor: "rgba(20,164,77,0)", lineWidth: 2 } }]} />
          </div>}
          {children.length > 0 && <DataTable columns={cols} rows={childRows} pageSize={60} exportName={`explorer_${level}`} onRowClick={(r) => r.go && navigate("explorer", { ...q, ...r.go, group: undefined })} />}
          {level === "sector" && igs.length > 0 && (
            <div className="card"><h3>Industry groups (cap-weighted from constituents, USD)</h3>
              <DataTable columns={[{ key: "name", label: "Industry group", value: (g) => g.name, render: (g) => <a href={href("explorer", { ...q, ig: g.name })}>{g.name}</a> }, { key: "n", label: "Stocks", num: true, value: (g) => g.n },
                ...H.map((h) => ({ key: h, label: h, num: true, value: (g) => g.ret[h], render: (g) => <Pct v={g.ret[h]} /> }))]} rows={igs.map((g) => ({ ...g, id: g.name }))} exportName="industry_groups" pageSize={30} />
            </div>)}
          {subs.length > 0 && !q.sub && (
            <div className="card"><h3>Sub-industries ({subs.length})</h3>
              <DataTable columns={[{ key: "name", label: "Sub-industry", value: (g) => g.name, render: (g) => <a href={href("explorer", { ...q, sub: g.name })}>{g.name}</a> }, { key: "n", label: "Stocks", num: true, value: (g) => g.n },
                ...H.map((h) => ({ key: h, label: h, num: true, value: (g) => g.ret[h], render: (g) => <Pct v={g.ret[h]} /> }))]} rows={subs.map((g) => ({ ...g, id: g.name }))} exportName="sub_industries" pageSize={30} />
            </div>)}
          {(level === "sector" || level === "ig" || level === "cap" || level === "country") && (
            <div className="card"><h3>Stocks at this level ({rowsAtLevel.length})</h3>
              <DataTable columns={[...idColumns(["country", "sector", "industryGroup", "subIndustry", "cap", "capUsd"]), fieldColumn(`ret${d.settings.horizon}`), fieldColumn(`rscChg_country_${d.settings.horizon === "1W" ? "1M" : d.settings.horizon === "YTD" ? "3M" : d.settings.horizon}`), fieldColumn("mmaW"), fieldColumn("wwTrend"), fieldColumn("score")]}
                rows={rowsAtLevel} initialSort={{ key: "capUsd", dir: "desc" }} exportName="stocks" pageSize={40} />
            </div>)}
        </>
      )}
    </div>
  );
}
