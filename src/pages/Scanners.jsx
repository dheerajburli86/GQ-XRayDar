// Scanners (features 2.1-2.13). Each scanner is a set of conditions on the
// field registry, so the numbers are exactly the ones the screener, alerts and
// the GQ agent use. All cover India, US and global stocks, ETFs and indices and
// can be narrowed by market, type, size, sector or one of your watchlists.
import { useMemo, useState } from "react";
import { useData } from "../data/store.jsx";
import { PageHead, Seg, Select, Badge, Kpi, Pct } from "../components/ui.jsx";
import { DataTable } from "../components/DataTable.jsx";
import { ScopeFilter, applyScope, idColumns, fieldColumn } from "../components/pickers.jsx";
import { FIELD, testCondition } from "../../engine/fields.js";
import { CANDLE_PATTERNS } from "../../engine/candles.js";
import { WW_TREND_LABEL } from "../../engine/weightWatcher.js";
import { usePersistent } from "../lib/storage.js";
import { navigate } from "../lib/router.js";
import { ConditionRow } from "./Screener.jsx";

const C = (field, op = "is true", value) => ({ field, op, ...(value !== undefined ? { value } : {}) });

export const SCANNERS = [
  { id: "rsi", n: "2.1", label: "RSI", desc: "Stocks that rose too fast (RSI high: may cool off) or fell too fast (RSI low: may bounce), and divergences where price rises but the strength behind it fades.",
    modes: [
      { value: "ob", label: "Overbought (RSI ≥ 70)", conds: (tf) => [C(`rsi${tf}`, ">=", 70)], sort: (tf) => `rsi${tf}`, cols: (tf) => [`rsi${tf}`, `rsi2${tf}`, `mma${tf}`, "ret1M"] },
      { value: "os", label: "Oversold (RSI ≤ 30)", conds: (tf) => [C(`rsi${tf}`, "<=", 30)], sort: (tf) => `rsi${tf}`, asc: true, cols: (tf) => [`rsi${tf}`, `rsi2${tf}`, `mma${tf}`, "ret1M"] },
      { value: "bear", label: "Bearish divergence", conds: (tf) => [C(`rsiDivergence${tf}`, "is", "bearish")], sort: () => "ret3M", cols: (tf) => [`rsi${tf}`, `rsiDivergence${tf}`, "ret3M"] },
      { value: "bull", label: "Bullish divergence", conds: (tf) => [C(`rsiDivergence${tf}`, "is", "bullish")], sort: () => "ret3M", asc: true, cols: (tf) => [`rsi${tf}`, `rsiDivergence${tf}`, "ret3M"] },
    ], tf: true },
  { id: "macd", n: "2.2", label: "MACD", desc: "Momentum that has just turned: MACD crossing its signal line.",
    modes: [
      { value: "up", label: "Turned up", conds: (tf) => [C(`macdCross${tf}`, "is", "bull")], sort: () => "ret1M", cols: (tf) => [`macdCross${tf}`, `rsi${tf}`, `mma${tf}`, "ret1M"] },
      { value: "down", label: "Turned down", conds: (tf) => [C(`macdCross${tf}`, "is", "bear")], sort: () => "ret1M", asc: true, cols: (tf) => [`macdCross${tf}`, `rsi${tf}`, `mma${tf}`, "ret1M"] },
      { value: "above", label: "MACD above signal", conds: (tf) => [C(`macd${tf}`)], sort: () => "ret1M", cols: (tf) => [`macd${tf}`, `rsi${tf}`, "ret1M"] },
    ], tf: true },
  { id: "trend", n: "2.3", label: "Trend", desc: "Healthy uptrends and weak trends from the 50- and 200-day averages, and stocks that just crossed key averages.",
    modes: [
      { value: "healthy", label: "Healthy uptrend", conds: () => [C("above50"), C("above200"), C("trendUpD")], sort: () => "ret3M", cols: () => ["above50", "above200", "mmaW", "ret3M"] },
      { value: "weak", label: "Weak trend", conds: () => [C("above50", "is false"), C("above200", "is false")], sort: () => "ret3M", asc: true, cols: () => ["above50", "above200", "mmaW", "ret3M"] },
      { value: "golden", label: "Golden cross (3 days)", conds: () => [C("goldenCross", "is", "bull")], sort: () => "ret1M", cols: () => ["goldenCross", "above200", "ret1M"] },
      { value: "death", label: "Death cross (3 days)", conds: () => [C("goldenCross", "is", "bear")], sort: () => "ret1M", asc: true, cols: () => ["goldenCross", "above200", "ret1M"] },
      { value: "x50up", label: "Crossed above 50-day", conds: () => [C("priceCross50", "is", "bull")], sort: () => "ret1M", cols: () => ["priceCross50", "above200", "ret1M"] },
      { value: "x50dn", label: "Crossed below 50-day", conds: () => [C("priceCross50", "is", "bear")], sort: () => "ret1M", asc: true, cols: () => ["priceCross50", "above200", "ret1M"] },
    ] },
  { id: "mma", n: "2.4", label: "Squeeze & breakout (MMA)", desc: "Short- and long-term averages squeezed together (often before a big move), and those that just broke out of the squeeze.",
    modes: [
      { value: "sq", label: "In a squeeze", conds: (tf) => [C(`compression${tf}`)], sort: (tf) => `shortSpread${tf}`, asc: true, cols: (tf) => [`shortSpread${tf}`, `mma${tf}`, `consolidation${tf}`, "ret3M"] },
      { value: "bo", label: "Broke out after a squeeze", conds: (tf) => [C(`postConsBreak${tf}`)], sort: () => "ret1M", cols: (tf) => [`mma${tf}`, `breakout${tf}`, "volRatio", "ret1M"] },
      { value: "new", label: "Just turned bullish", conds: (tf) => [C(`mmaNewBull${tf}`)], sort: () => "ret1M", cols: (tf) => [`mma${tf}`, `rsi${tf}`, "ret1M"] },
      { value: "bull", label: "Bullish alignment", conds: (tf) => [C(`mmaBull${tf}`)], sort: () => "score", cols: (tf) => [`mma${tf}`, `rsi${tf}`, "ret3M", "score"] },
    ], tf: true },
  { id: "box", n: "2.14", label: "Consolidation breakout", desc: "The owner's multi-period pattern: the yellow averages (3-15) stop trending and run into or along the red ones (30-60), then fan out above them again. Read on the price chart (as on RSIMMA) and on relative strength against the country index (as on RSCMMA). Weekly, monthly and quarterly matter most for investing; the more of them agree, the stronger. Open a stock and use the Analyst screens to see the marked periods.",
    modes: [
      { value: "both", label: "Broke out: price and RSC", conds: (tf) => [C(`boxBreakout${tf}`), C(`rscBoxBreakout${tf}`)], sort: () => "boxBreakoutScreens", cols: (tf) => [`boxStartDate${tf}`, `boxBreakoutDate${tf}`, `boxTurn${tf}`, `rscBoxBreakoutDate${tf}`, "boxBreakoutScreens", "ret1M"] },
      { value: "price", label: "Broke out: price", conds: (tf) => [C(`boxBreakout${tf}`)], sort: () => "boxBreakoutScreens", cols: (tf) => [`boxStartDate${tf}`, `boxBreakoutDate${tf}`, `boxTurn${tf}`, `rscBoxState${tf}`, "boxBreakoutScreens", "ret1M"] },
      { value: "rsc", label: "Broke out: RSC", conds: (tf) => [C(`rscBoxBreakout${tf}`)], sort: () => "boxBreakoutScreens", cols: (tf) => [`rscBoxBreakoutDate${tf}`, `boxState${tf}`, "boxBreakoutScreens", "ret1M"] },
      { value: "multi", label: "2+ higher-timeframe screens broke out", conds: () => [C("boxBreakoutScreens", ">=", 2)], sort: () => "boxBreakoutScreens", cols: () => ["boxBreakoutScreens", "boxBreakoutDateW", "boxBreakoutDateM", "boxBreakoutDateQ", "ret3M"] },
      { value: "cons", label: "Consolidating now (price and RSC)", conds: (tf) => [C(`boxState${tf}`, "is", "consolidating"), C(`rscBoxState${tf}`, "is", "consolidating")], sort: () => "boxConsolidatingScreens", cols: (tf) => [`boxSince${tf}`, "boxConsolidatingScreens", "ret3M", "ret12M"] },
      { value: "down", label: "Broke down", conds: (tf) => [C(`boxBreakdown${tf}`)], sort: () => "ret1M", asc: true, cols: (tf) => [`boxSince${tf}`, `rscBoxState${tf}`, "ret1M"] },
    ], tf: "DWMQ" },
  { id: "hl52", n: "2.5", label: "52-week high / low", desc: "Stocks near their best or worst price of the past year.",
    modes: [
      { value: "hi", label: "At a 52-week high", conds: () => [C("atHigh52")], sort: () => "ret3M", cols: () => ["pctFromHigh52", "volRatio", "ret3M"] },
      { value: "near", label: "Within 5% of the high", conds: () => [C("nearHigh52")], sort: () => "pctFromHigh52", cols: () => ["pctFromHigh52", "volRatio", "ret3M"] },
      { value: "lo", label: "At a 52-week low", conds: () => [C("atLow52")], sort: () => "ret3M", asc: true, cols: () => ["pctFromLow52", "volRatio", "ret3M"] },
      { value: "nearlo", label: "Within 5% of the low", conds: () => [C("pctFromLow52", "<=", 5)], sort: () => "pctFromLow52", asc: true, cols: () => ["pctFromLow52", "above200", "ret3M"] },
    ] },
  { id: "ath", n: "2.6", label: "All-time high / low", desc: "Stocks at their highest or lowest price ever (in the stored history).",
    modes: [
      { value: "ath", label: "All-time high", conds: () => [C("athBreak")], sort: () => "ret3M", cols: () => ["pctFromAth", "volRatio", "ret3M"] },
      { value: "near", label: "Within 5% of all-time high", conds: () => [C("pctFromAth", ">=", -5)], sort: () => "pctFromAth", cols: () => ["pctFromAth", "ret3M"] },
      { value: "atl", label: "All-time low", conds: () => [C("atlBreak")], sort: () => "ret3M", asc: true, cols: () => ["pctFromAth", "ret3M"] },
    ] },
  { id: "candle", n: "2.7", label: "Candle patterns", desc: "Well-known candle shapes traders read as a possible turn up (bullish) or down (bearish). A pattern counts only in its context, e.g. a hammer after a fall.",
    modes: [
      { value: "bull", label: "Bullish patterns", conds: (tf) => [C(`candleBull${tf}`)], sort: () => "ret1M", asc: true, cols: (tf) => [`candles${tf}`, `rsi${tf}`, "ret1M"] },
      { value: "bear", label: "Bearish patterns", conds: (tf) => [C(`candleBear${tf}`)], sort: () => "ret1M", cols: (tf) => [`candles${tf}`, `rsi${tf}`, "ret1M"] },
      ...Object.entries(CANDLE_PATTERNS).filter(([, p]) => p.dir !== 0).map(([k, p]) => ({ value: k, label: p.label, conds: (tf) => [{ ...C(`candles${tf}`, "contains", p.label), fn: (r) => String(FIELD[`candles${tf}`].get(r) || "").split(", ").includes(k) }], sort: () => "ret1M", cols: (tf) => [`candles${tf}`, `rsi${tf}`, "ret1M"] })),
    ], tf: "DW" },
  { id: "360", n: "2.8", label: "360 view", desc: "One row per stock: returns, sector, trend, momentum, high/low status and whether it is gaining or losing weight in its sector over 3 months (Weight Watcher).",
    modes: [{ value: "all", label: "Everything in scope", conds: () => [], sort: () => "score", cols: () => ["ret1W", "ret1M", "ret3M", "ret12M", "mmaD", "mmaW", "rsiD", "rsiW", "pctFromHigh52", "atHigh52", "atLow52", "rscChg_country_3M", "wwTrend", "wwChange4", "stage", "score"] }] },
  { id: "custom", n: "2.9", label: "Build your own", desc: "Combine any conditions, e.g. beaten down (daily RSI under 35), still above its 200-day average, near its yearly low.", custom: true },
  { id: "volume", n: "2.10", label: "Volume", desc: "Stocks suddenly trading far more than usual.",
    modes: [
      { value: "spike", label: "2x+ normal volume", conds: () => [C("unusualVolume")], sort: () => "volRatio", cols: () => ["volRatio", "ret1D", "ret1W", "tradedValueUsd"] },
      { value: "bo", label: "Breakout on volume", conds: () => [C("breakoutVolume")], sort: () => "volRatio", cols: () => ["volRatio", "ret1W", "pctFromHigh52"] },
      { value: "acc", label: "Accumulation", conds: () => [C("accumulation")], sort: () => "volRatio", cols: () => ["volRatio", "ret1M", "rscChg_country_3M"] },
      { value: "dist", label: "Distribution", conds: () => [C("distribution")], sort: () => "volRatio", cols: () => ["volRatio", "ret1M", "rscChg_country_3M"] },
    ] },
  { id: "movers", n: "2.11", label: "Gainers, losers, breadth", desc: "Top gainers and losers, and how many stocks are rising versus falling.", movers: true },
  { id: "sectors", n: "2.12", label: "Sector ranking", desc: "Which sectors are strong or weak now: median return, share of stocks in a bullish weekly trend, and relative strength.", sectors: true },
  { id: "rs", n: "2.13", label: "Strength vs the market", desc: "Stocks doing better than their market index: relative strength (RSC) against the country index.",
    modes: [
      { value: "rising", label: "RSC rising (weekly)", conds: () => [C("rscRising_country_W")], sort: () => "rscChg_country_3M", cols: () => ["rscChg_country_1M", "rscChg_country_3M", "rscChg_country_12M", "mmaW"] },
      { value: "turn", label: "RSC just turned up", conds: () => [C("rscTurnUp_country_W")], sort: () => "rscChg_country_3M", cols: () => ["rscChg_country_3M", "mmaW", "ret3M"] },
      { value: "high", label: "RSC at a 52-week high", conds: () => [C("rscHigh_country_W")], sort: () => "rscChg_country_12M", cols: () => ["rscChg_country_3M", "rscChg_country_12M", "ret12M"] },
      { value: "top", label: "Top relative-strength rank", conds: () => [C("rsRank", ">=", 90)], sort: () => "rsRank", cols: () => ["rsRank", "rscChg_country_3M", "ret12M"] },
    ] },
];

const MARKETS = [{ value: "all", label: "All markets" }, { value: "India", label: "India" }, { value: "US", label: "US" }, { value: "Global", label: "Global" }];
const inMarket = (sec, m) => m === "all" || (m === "India" ? sec.country === "India" : m === "US" ? sec.country === "United States" : sec.country !== "India" && sec.country !== "United States");

export default function Scanners({ route }) {
  const d = useData();
  const [state, setState] = usePersistent("scanners", { id: "rsi", mode: {}, tf: "D", market: "all", scope: { assetClass: "Stock" }, wl: null, custom: [C("rsiD", "<", 35), C("above200"), C("pctFromLow52", "<=", 10)] });
  const s = { ...state, ...(route.args[0] ? { id: route.args[0] } : {}) };
  const set = (p) => setState({ ...s, ...p });
  const [wls] = usePersistent("watchlists", {});
  const sc = SCANNERS.find((x) => x.id === s.id) || SCANNERS[0];

  const universe = useMemo(() => {
    let rows = applyScope(d.rows, s.scope || {}).filter((r) => inMarket(r.sec, s.market));
    if (s.wl && wls[s.wl]) { const ids = new Set(wls[s.wl].ids); rows = rows.filter((r) => ids.has(r.id)); }
    return rows;
  }, [d.rows, s.scope, s.market, s.wl, wls]);

  const tfs = sc.tf === "DW" ? ["D", "W"] : sc.tf === "DWMQ" ? ["D", "W", "M", "Q"] : sc.tf ? ["D", "W", "M"] : null;
  const tf = tfs && tfs.includes(s.tf) ? s.tf : "D";
  const mode = sc.modes ? sc.modes.find((m) => m.value === s.mode?.[sc.id]) || sc.modes[0] : null;

  return (
    <div className="stack">
      <PageHead title="Scanners" sub="Each scanner checks every stock, ETF and index in scope against the latest stored data and lists the matches. Click a row to open its chart.">
        <Seg value={s.market} options={MARKETS} onChange={(market) => set({ market })} />
      </PageHead>
      <div className="scanner-tabs">
        {SCANNERS.map((x) => <button key={x.id} className={x.id === sc.id ? "on" : ""} onClick={() => navigate(`scanners/${x.id}`)}><span className="small muted">{x.n}</span> {x.label}</button>)}
      </div>
      <div className="card tight">
        <div className="small muted" style={{ marginBottom: 6 }}>{sc.desc}</div>
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          {tfs && <Seg value={tf} options={tfs.map((t) => ({ value: t, label: { D: "Daily", W: "Weekly", M: "Monthly", Q: "Quarterly" }[t] }))} onChange={(t) => set({ tf: t })} />}
          {sc.modes && sc.modes.length > 1 && <Select value={mode.value} options={sc.modes.map((m) => ({ value: m.value, label: m.label }))} onChange={(v) => set({ mode: { ...(s.mode || {}), [sc.id]: v } })} />}
          <ScopeFilter scope={s.scope || {}} onChange={(scope) => set({ scope })} show={["sector", "cap", "asset"]} />
          <Select label="Watchlist" value={s.wl} options={Object.entries(wls).map(([k, v]) => ({ value: k, label: v.name }))} onChange={(wl) => set({ wl })} allowEmpty="Any" />
          <span className="small muted">{universe.length.toLocaleString()} in scope · data to {d.info.asOf}</span>
        </div>
      </div>
      {sc.movers ? <Movers rows={universe} /> : sc.sectors ? <SectorRank rows={universe} /> : sc.custom ? <Custom rows={universe} conds={s.custom || []} onChange={(custom) => set({ custom })} />
        : <Results rows={universe} conds={mode.conds(tf)} sort={mode.sort(tf)} asc={mode.asc} cols={mode.cols(tf)} name={`${sc.label}_${mode.label}_${tf}`} />}
    </div>
  );
}

function Results({ rows, conds, sort, asc, cols, name }) {
  const hits = useMemo(() => rows.filter((r) => conds.every((c) => (c.fn ? c.fn(r) : testCondition(r, c)))), [rows, conds]);
  const columns = [...idColumns(["country", "sector", "assetClass"]), ...cols.filter((k) => FIELD[k]).map((k) => fieldColumn(k)), fieldColumn("score")];
  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 6 }}><b>{hits.length.toLocaleString()} match{hits.length === 1 ? "" : "es"}</b>{conds.map((c, i) => <Badge key={i}>{FIELD[c.field]?.label || c.field} {c.op}{c.value != null ? ` ${c.value}` : ""}</Badge>)}</div>
      <DataTable rows={hits} columns={columns} initialSort={{ key: FIELD[sort] ? sort : "score", dir: asc ? "asc" : "desc" }} exportName={name.replace(/[^\w]+/g, "_")} onRowClick={(r) => navigate(`chart/${r.id}`)} />
    </div>
  );
}

function Custom({ rows, conds, onChange }) {
  return (
    <div className="stack">
      <div className="card tight stack" style={{ gap: 6 }}>
        {conds.map((c, i) => <ConditionRow key={i} c={c} onChange={(nc) => onChange(conds.map((x, k) => (k === i ? nc : x)))} onRemove={() => onChange(conds.filter((_, k) => k !== i))} />)}
        <div className="row"><button className="btn sm" onClick={() => onChange([...conds, C("mmaBullW")])}>+ Condition</button><span className="small muted">All conditions must hold. Saved automatically; use the Screener for saved named screens.</span></div>
      </div>
      <Results rows={rows} conds={conds} sort="score" cols={[...new Set(conds.map((c) => c.field))]} name="custom_scan" />
    </div>
  );
}

function Movers({ rows }) {
  const [h, setH] = useState("1D");
  const key = `ret${h}`;
  const valid = rows.filter((r) => FIELD[key].get(r) != null);
  const up = valid.filter((r) => FIELD[key].get(r) > 0).length, down = valid.filter((r) => FIELD[key].get(r) < 0).length;
  const sorted = [...valid].sort((a, b) => FIELD[key].get(b) - FIELD[key].get(a));
  const cols = [...idColumns(["country", "sector"]), fieldColumn(key), fieldColumn("volRatio"), fieldColumn("mmaW")];
  return (
    <div className="stack">
      <div className="row"><Seg value={h} options={["1D", "1W", "1M", "3M", "12M", "YTD"]} onChange={setH} /></div>
      <div className="grid" style={{ gridTemplateColumns: "repeat(4, minmax(0,1fr))" }}>
        <Kpi label={`Rising (${h})`} value={up.toLocaleString()} cls="pos" />
        <Kpi label={`Falling (${h})`} value={down.toLocaleString()} cls="neg" />
        <Kpi label="Advance / decline ratio" value={down ? (up / down).toFixed(2) : "—"} />
        <Kpi label="Share rising" value={valid.length ? `${Math.round((up / valid.length) * 100)}%` : "—"} />
      </div>
      <div className="grid" style={{ gridTemplateColumns: "repeat(2, minmax(0,1fr))" }}>
        <div className="card"><h3>Top gainers</h3><DataTable rows={sorted.slice(0, 50)} columns={cols} pageSize={25} exportName={`gainers_${h}`} onRowClick={(r) => navigate(`chart/${r.id}`)} /></div>
        <div className="card"><h3>Top losers</h3><DataTable rows={sorted.slice(-50).reverse()} columns={cols} pageSize={25} exportName={`losers_${h}`} onRowClick={(r) => navigate(`chart/${r.id}`)} /></div>
      </div>
    </div>
  );
}

function SectorRank({ rows }) {
  const [by, setBy] = useState("sector");
  const [h, setH] = useState("3M");
  const stats = useMemo(() => {
    const g = new Map();
    for (const r of rows) {
      const k = by === "sector" ? r.sec.sector : r.sec.industryGroup;
      if (!k || (r.sec.assetClass || "Stock") !== "Stock") continue;
      if (!g.has(k)) g.set(k, []);
      g.get(k).push(r);
    }
    const med = (a) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
    return [...g.entries()].map(([name, rs]) => ({
      id: name, name, n: rs.length,
      ret: med(rs.map((r) => r.flat[`ret${h}`])), ret1M: med(rs.map((r) => r.flat.ret1M)),
      bull: Math.round((rs.filter((r) => r.flat.mmaBullW).length / rs.length) * 100),
      above50: Math.round((rs.filter((r) => r.flat.above50).length / rs.length) * 100),
      rsc: med(rs.map((r) => r.flat.rscChg_country_3M)),
      wwUp: rs.filter((r) => ["rising", "turn_up_from_low"].includes(r.flat.wwTrend)).length,
    })).filter((x) => x.n >= 3);
  }, [rows, by, h]);
  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 8 }}><Seg value={by} options={[{ value: "sector", label: "Sectors" }, { value: "ig", label: "Industry groups" }]} onChange={setBy} /><Seg value={h} options={["1W", "1M", "3M", "6M", "12M"]} onChange={setH} /><span className="small muted">Medians across the stocks in scope; sectors with fewer than 3 stocks are left out.</span></div>
      <DataTable rows={stats} initialSort={{ key: "ret", dir: "desc" }} exportName={`sector_ranking_${h}`} columns={[
        { key: "name", label: by === "sector" ? "Sector" : "Industry group", value: (x) => x.name },
        { key: "n", label: "Stocks", value: (x) => x.n, num: true },
        { key: "ret", label: `Median ${h}`, value: (x) => x.ret, num: true, render: (x) => <Pct v={x.ret} /> },
        { key: "ret1M", label: "Median 1M", value: (x) => x.ret1M, num: true, render: (x) => <Pct v={x.ret1M} /> },
        { key: "bull", label: "% bullish weekly MMA", value: (x) => x.bull, num: true, render: (x) => `${x.bull}%` },
        { key: "above50", label: "% above 50-day", value: (x) => x.above50, num: true, render: (x) => `${x.above50}%` },
        { key: "rsc", label: "Median RSC vs country 3M", value: (x) => x.rsc, num: true, render: (x) => <Pct v={x.rsc} /> },
        { key: "ww", label: "Gaining weight", value: (x) => x.wwUp, num: true },
      ]} />
      <div className="small muted" style={{ marginTop: 6 }}>For sector indices and rotation quadrants see <a href="#/rotation">Sector rotation</a>. Weight Watcher labels: {Object.values(WW_TREND_LABEL).join(", ")}.</div>
    </div>
  );
}

