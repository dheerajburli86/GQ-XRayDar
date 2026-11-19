// Multi-level heatmap. Group tiles (region / country / sector / cap segment) are
// coloured from their CW or EW INDEX, not from an average of tiles; stock tiles
// from each stock's own stored metrics. Size by market cap, index weight or equal.
import { useMemo } from "react";
import { useData } from "../data/store.jsx";
import { useAsync } from "../lib/useAsync.js";
import { navigate } from "../lib/router.js";
import { PageHead, Seg, Select, Loading } from "../components/ui.jsx";
import { Treemap, divergingColor, categoricalColor } from "../components/Treemap.jsx";
import { applyScope } from "../components/pickers.jsx";
import { changeOver, HBARS } from "../lib/indexMath.js";
import { fmtPct, fmtMoney, fmtNum } from "../lib/format.js";
import { CAPS } from "../../engine/indexEngine.js";
import { glocomBand } from "../../engine/glocom.js";

const COLOR_BY = [
  { value: "ret", label: "Absolute return" }, { value: "rsc", label: "RSC vs country" }, { value: "rsi", label: "RSI (weekly)" },
  { value: "mma", label: "MMA state (weekly)" }, { value: "ww", label: "WW weight change" }, { value: "ewcw", label: "EW vs CW" },
  { value: "fund", label: "Revenue growth" }, { value: "glocom", label: "GLOCOM" }, { value: "score", label: "AI score" },
];
const MMA_COL = { bull: "#15803d", above: "#4d7c0f", mixed: "#4b5563", below: "#b45309", bear: "#b91c1c" };
const GLOCOM_COL = (code) => glocomBand(code).bg;
const GLOCOM_FG = (bg) => [1, 2, 3, 4, 5].map(glocomBand).find((b) => b.bg === bg)?.fg;

export default function Heatmap({ route }) {
  const d = useData();
  const q = route.query;
  const s = d.settings;
  const level = q.level || (q.sector || q.ig ? "stocks" : q.country ? "sectors" : q.region ? "countries" : "regions");
  const colorBy = q.color || "ret";
  const sizeBy = q.size || "cap";
  const h = s.horizon === "YTD" ? "3M" : s.horizon;
  const ccy = q.country && s.ccy === "LCL" ? "LCL" : "USD";
  const set = (p) => navigate("heatmap", { ...q, ...p });

  const groups = useMemo(() => {
    if (level === "stocks") return [];
    if (level === "regions") return d.regions.map((r) => ({ name: r, scope: `R:${r}`, drill: { region: r, level: "countries" } }));
    if (level === "classes") return d.classifications.map((c) => ({ name: c, scope: `M:${c}`, drill: null }));
    if (level === "caps") return CAPS.map((c) => ({ name: `${c} Cap`, scope: q.country ? `C:${q.country}|K:${c}` : `G|K:${c}`, drill: { cap: c, level: "stocks" } }));
    if (level === "countries") return d.countries.filter((c) => !q.region || d.secs.some((x) => x.country === c && x.region === q.region)).map((c) => ({ name: c, scope: `C:${c}`, drill: { country: c, level: "sectors" } }));
    // sectors
    const base = q.country ? `C:${q.country}` : q.region ? `R:${q.region}` : "G";
    return d.sectors.map((x) => ({ name: x, scope: `${base}|S:${x}`, drill: { sector: x, level: "stocks" } }));
  }, [level, d, q.region, q.country]);
  const parentScope = level === "stocks" ? (q.country ? `C:${q.country}` : q.region ? `R:${q.region}` : "G") : level === "countries" && q.region ? `R:${q.region}` : level === "sectors" && q.country ? `C:${q.country}` : level === "sectors" && q.region ? `R:${q.region}` : "G";

  const { data, loading } = useAsync(async () => {
    const fam = s.family;
    const ser = await Promise.all(groups.map((g) => d.api.indexSeries(`${fam}|${level === "countries" ? "USD" : ccy}|${g.scope}`)));
    const other = colorBy === "ewcw" ? await Promise.all(groups.map((g) => d.api.indexSeries(`${fam === "CW" ? "EW" : "CW"}|${level === "countries" ? "USD" : ccy}|${g.scope}`))) : [];
    const parent = await d.api.indexSeries(`${fam}|${level === "countries" ? "USD" : ccy}|${parentScope}`);
    const cap = await Promise.all(groups.map((g) => d.api.indexSeries(`CW|USD|${g.scope}`)));
    return { ser, other, parent, cap };
  }, [groups.map((g) => g.scope).join(), s.family, ccy, colorBy, parentScope]);

  const stockRows = useMemo(() => {
    if (level !== "stocks") return [];
    let rows = applyScope(d.rows.filter((r) => (r.sec.assetClass || "Stock") === "Stock"), { region: q.region, country: q.country, sector: q.sector, cap: q.cap || (s.capFilter !== "All" ? s.capFilter : null), industryGroup: q.ig });
    if (!q.country && !q.region && !q.sector) rows = [...rows].sort((a, b) => (b.sec.capUsdNow || 0) - (a.sec.capUsdNow || 0)).slice(0, 600);
    return rows;
  }, [level, d.rows, q.region, q.country, q.sector, q.cap, q.ig, s.capFilter]);

  const items = useMemo(() => {
    if (level === "stocks") {
      const tot = stockRows.reduce((a, r) => a + (r.sec.capUsdNow || 0), 0);
      const parentRet = data?.parent ? changeOver(data.parent, HBARS[h]) : null;
      return stockRows.map((r) => {
        const f = r.flat, cap = r.sec.capUsdNow || 0;
        const ret = (ccy === "USD" ? f[`retUsd${h}`] : f[`ret${h}`]);
        const val = s.relative && ret != null && parentRet != null ? ret - parentRet : ret;
        let color, sub;
        switch (colorBy) {
          case "rsc": color = divergingColor(f[`rscChg_country_${h === "1W" ? "1M" : h}`], 10); sub = fmtPct(f[`rscChg_country_${h === "1W" ? "1M" : h}`]); break;
          case "rsi": color = divergingColor(f.rsiW != null ? f.rsiW - 50 : null, 25); sub = `RSI ${fmtNum(f.rsiW, 0)}`; break;
          case "mma": color = categoricalColor(f.mmaW, MMA_COL); sub = f.mmaW; break;
          case "ww": color = divergingColor(f.wwChange4, 20); sub = f.wwChange4 != null ? fmtPct(f.wwChange4) : "—"; break;
          case "fund": color = divergingColor(f.revenueGrowthYoY, 25); sub = fmtPct(f.revenueGrowthYoY); break;
          case "glocom": color = GLOCOM_COL(f.glocomCode); sub = f.glocom || "—"; break;
          case "score": color = divergingColor(f.score != null ? f.score - 50 : null, 30); sub = `score ${f.score ?? "—"}`; break;
          case "ewcw": color = divergingColor(val, h === "1W" ? 4 : 12); sub = fmtPct(val); break;
          default: color = divergingColor(val, h === "1W" ? 4 : h === "1M" ? 8 : 15); sub = fmtPct(val);
        }
        return {
          key: r.id, label: r.sec.symbol, title: `${r.sec.symbol} · ${r.sec.name}`, size: sizeBy === "equal" ? 1 : Math.max(cap, 1), color, sub, fg: colorBy === "glocom" ? GLOCOM_FG(color) : undefined,
          onClick: () => navigate(`stock/${r.id}`),
          tip: [["Price", `${fmtNum(f.close)} ${r.sec.currency}`], ["Market cap", cap ? fmtMoney(cap) : "not published"], ["Weight in view", tot ? `${((cap / tot) * 100).toFixed(2)}%` : "—"],
            [`Return ${h} (${ccy === "USD" ? "USD" : "local"})`, fmtPct(ret)], [`RSC vs country ${h === "1W" ? "1M" : h}`, fmtPct(f[`rscChg_country_${h === "1W" ? "1M" : h}`])],
            ["RSI (W)", fmtNum(f.rsiW, 1)], ["MMA (W)", f.mmaW || "—"], ["Sector", r.sec.sector], ["Cap segment", r.sec.capSegment || "—"]],
        };
      });
    }
    if (!data) return [];
    const parentRet = changeOver(data.parent, HBARS[h]);
    const capTot = data.cap.reduce((a, c) => a + (c?.cap?.at(-1) || 0), 0);
    return groups.map((g, i) => {
      const se = data.ser[i];
      if (!se) return null;
      const ret = changeOver(se, HBARS[h]);
      const val = s.relative && ret != null && parentRet != null ? ret - parentRet : ret;
      const capNow = data.cap[i]?.cap?.at(-1) || 0;
      let color = divergingColor(val, h === "1W" ? 4 : h === "1M" ? 8 : 15), sub = fmtPct(val);
      if (colorBy === "ewcw" && data.other[i]) { const o = changeOver(data.other[i], HBARS[h]); const x = s.family === "CW" ? o - ret : ret - o; color = divergingColor(x, 6); sub = `EW-CW ${fmtPct(x)}`; }
      if (colorBy === "mma" || colorBy === "rsi" || colorBy === "rsc" || colorBy === "score" || colorBy === "fund" || colorBy === "ww" || colorBy === "glocom") {
        // aggregate the stock metric cap-weighted over the group's constituents
        const rs = d.rows.filter((r) => matchScope(r, g.scope));
        const key = { rsc: `rscChg_country_${h === "1W" ? "1M" : h}`, rsi: "rsiW", score: "score", fund: "revenueGrowthYoY", ww: "wwChange4", glocom: "glocomCode" }[colorBy];
        if (colorBy === "mma") { const b = rs.filter((r) => r.flat.mmaW === "bull").length; const pct = rs.length ? (b / rs.length) * 100 : null; color = divergingColor(pct != null ? pct - 30 : null, 30); sub = `${pct?.toFixed(0) ?? "—"}% bullish MMA`; }
        else if (colorBy === "glocom" && g.scope.startsWith("C:") && g.scope.includes("|S:")) { const v = rs.find((r) => r.flat.sectorGlocomCode != null)?.flat; color = GLOCOM_COL(v?.sectorGlocomCode); sub = v?.sectorGlocom || "—"; }
        else { let a = 0, w = 0; for (const r of rs) { const v = r.flat[key]; const c = r.sec.capUsdNow || 0; if (v != null && c) { a += v * c; w += c; } } const v = w ? a / w : null; color = colorBy === "glocom" ? GLOCOM_COL(v != null ? Math.round(v) : null) : divergingColor(colorBy === "rsi" || colorBy === "score" ? (v != null ? v - 50 : null) : v, colorBy === "rsi" ? 20 : 15); sub = v != null ? `${fmtNum(v, 1)}` : "—"; }
      }
      return {
        key: g.scope, label: g.name, size: sizeBy === "equal" ? 1 : Math.max(capNow, 1), color, sub, fg: colorBy === "glocom" ? GLOCOM_FG(color) : undefined,
        onClick: g.drill ? () => navigate("heatmap", { ...q, ...g.drill }) : undefined,
        tip: [[`${s.family} return ${h}`, fmtPct(ret)], ["vs parent", fmtPct(ret != null && parentRet != null ? ret - parentRet : null)], ["Market cap (USD)", fmtMoney(capNow)],
          ["Index weight", capTot ? `${((capNow / capTot) * 100).toFixed(2)}%` : "—"], ["Constituents", se.n?.at(-1) ?? "—"]],
      };
    }).filter(Boolean);
  }, [level, stockRows, data, groups, colorBy, sizeBy, h, ccy, s.relative, s.family, d.rows, q]);

  return (
    <div className="stack">
      <PageHead title="Heatmap" sub={`Tile size = ${sizeBy === "cap" ? "market cap" : sizeBy === "weight" ? "index weight" : "equal"}; colour = ${COLOR_BY.find((c) => c.value === colorBy)?.label}. Click a tile to drill down.`}>
        <Seg value={level} options={[{ value: "regions", label: "Regions" }, { value: "classes", label: "DM/EM" }, { value: "countries", label: "Countries" }, { value: "sectors", label: "Sectors" }, { value: "caps", label: "Caps" }, { value: "stocks", label: "Stocks" }]} onChange={(v) => set({ level: v })} />
      </PageHead>
      <div className="row">
        <Seg value={s.family} options={["CW", "EW"]} onChange={(v) => d.setSetting("family", v)} />
        <Seg value={s.ccy} options={[{ value: "LCL", label: "Local" }, { value: "USD", label: "USD" }]} onChange={(v) => d.setSetting("ccy", v)} />
        <Seg value={s.relative ? "rel" : "abs"} options={[{ value: "abs", label: "Absolute" }, { value: "rel", label: "Relative" }]} onChange={(v) => d.setSetting("relative", v === "rel")} />
        <Seg value={s.horizon} options={["1W", "1M", "3M", "6M", "12M"]} onChange={(v) => d.setSetting("horizon", v)} />
        <Seg value={s.capFilter} options={["All", ...CAPS]} onChange={(v) => d.setSetting("capFilter", v)} title="Cap segment (stock level)" />
        <Select label="Colour" value={colorBy} options={COLOR_BY} onChange={(v) => set({ color: v })} />
        <Select label="Size" value={sizeBy} options={[{ value: "cap", label: "Market cap" }, { value: "weight", label: "Index weight" }, { value: "equal", label: "Equal" }]} onChange={(v) => set({ size: v })} />
        {(q.region || q.country || q.sector) && <button className="btn sm" onClick={() => navigate("heatmap", { level: "regions", color: q.color, size: q.size })}>↑ Back to global</button>}
        <span className="small muted">{[q.region, q.country, q.sector, q.cap].filter(Boolean).join(" › ")}</span>
      </div>
      {loading && level !== "stocks" ? <Loading /> : <Treemap items={items} height={Math.max(420, Math.min(760, window.innerHeight - 230))} />}
      {level === "stocks" && !q.country && !q.region && !q.sector && <div className="small muted">Showing the 600 largest stocks; pick a region, country or sector to see all of its constituents.</div>}
    </div>
  );
}

function matchScope(r, scope) {
  for (const p of scope.split("|")) {
    const [t, v] = p.split(/:(.*)/s);
    if (t === "G") continue;
    if (t === "R" && r.sec.region !== v) return false;
    if (t === "M" && r.sec.classification !== v) return false;
    if (t === "C" && r.sec.country !== v) return false;
    if (t === "S" && r.sec.sector !== v) return false;
    if (t === "K" && r.sec.capSegment !== v) return false;
  }
  return true;
}
