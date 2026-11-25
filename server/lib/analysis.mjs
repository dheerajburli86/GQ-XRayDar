// Analysis services shared by the HTTP API, the GQ agent tools, tasks and
// digests. Everything here reads stored calculations; nothing is predicted and
// nothing says buy, sell or hold.
import { parseCommand } from "../../engine/nl.js";
import { runScreen, FIELD, testCondition } from "../../engine/fields.js";
import { breadthDivergence } from "../../engine/breadth.js";
import { EVENT_LABEL } from "../../engine/signals.js";
import { WW_TREND_LABEL } from "../../engine/weightWatcher.js";
import { fmtPct, fmtMoney } from "../../engine/format.js";
import { describeChart } from "../../engine/chartRead.js";
import { canonicalCountry } from "../../engine/geography.js";

const r2 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
const TFN = { D: "daily", W: "weekly", M: "monthly", Q: "quarterly", Y: "yearly" };

export function createAnalysis(data, cfg) {
  const link = (path) => (cfg.appUrl ? `${cfg.appUrl}/#/${path}` : null);

  async function stock(ref) {
    const cands = await data.resolve(ref);
    if (!cands.length) return { error: `no instrument matches "${ref}"` };
    if (cands.length > 1 && !cands.every((c) => c.symbol === cands[0].symbol)) {
      const exact = cands.filter((c) => c.symbol.toUpperCase() === String(ref).toUpperCase());
      if (exact.length !== 1) return { ambiguous: true, candidates: cands.map((c) => ({ id: c.id, symbol: c.symbol, name: c.name, country: c.country, exchange: c.exchange, assetClass: c.assetClass })) };
      cands.splice(0, cands.length, exact[0]);
    }
    const sec = cands[0];
    const s = await data.api.snapshot(sec.id);
    if (!s) return { error: `${sec.symbol} has no stored analysis (too little history or not in the latest run)` };
    const sn = s.snap, tf = sn.tf;
    const ev = (await data.api.events(sec.id)).slice(-6).reverse();
    const out = {
      instrument: { id: sec.id, symbol: sec.symbol, name: sec.name, country: sec.country, region: sec.region, sector: sec.sector, industryGroup: sec.industryGroup, capSegment: sec.capSegment, assetClass: sec.assetClass, currency: sec.currency, marketCapUsdEstimated: sec.capUsdNow },
      asOf: sn.asOf, close: sn.close, closeUsd: sn.closeUsd,
      returnsLocalPct: sn.ret, returnsUsdPct: sn.retUsd,
      timeframes: Object.fromEntries(["D", "W", "M", "Q", "Y"].filter((k) => tf[k]).map((k) => [TFN[k], {
        mma: tf[k].mma, bullishWeeksOrBars: tf[k].bullBars, rsi: tf[k].rsi, rsiOfRsi: tf[k].rsi2, rsiDivergence: tf[k].rsiDivergence || null,
        macd: tf[k].macd, macdCross: tf[k].macdCross, mmaCompression: tf[k].compression, consolidation: tf[k].consolidation,
        breakoutLast5: tf[k].breakoutRecent, reversalUp: tf[k].reversalUp, reversalDown: tf[k].reversalDown, candlePatterns: tf[k].candles || [],
      }])),
      timeframeShift: sn.tfShift,
      relativeStrength: Object.fromEntries(Object.entries(sn.rsc || {}).map(([k, v]) => [k, { weekly: v.W ? { rising: v.W.rising, falling: v.W.falling, upwardInflection: v.W.turnUp, at52wHigh: v.W.atHigh, divergence: v.W.divergence || null } : null, changePct: v.D?.chg || null }])),
      levels: { high52: sn.day.high52, low52: sn.day.low52, pctFromHigh52: sn.day.pctFromHigh52, allTimeHigh: sn.day.ath, pctFromAth: sn.day.pctFromAth, above50dEma: sn.day.above50, above200dEma: sn.day.above200 },
      volume: { vs50dAvg: sn.day.volRatio, upDownVolume: sn.day.udRatio, accumulation: sn.day.accumulation, distribution: sn.day.distribution, priceVolumeDivergence: sn.day.pvDivergence, avgTradedValue20dUsd: sn.day.tradedValue20Usd },
      stage: { label: sn.stage.label, evidence: sn.stage.evidence },
      indicatorAgreement: { reading: sn.agreement, bullish: sn.bullSignals, bearish: sn.bearSignals },
      weightWatcher: s.ww ? { weightPctInSector: s.ww.last, trend: WW_TREND_LABEL[s.ww.trend] || s.ww.trend, change4QuartersPct: s.ww.change4 != null ? r2(s.ww.change4 * 100) : null } : null,
      fundamentals: s.f ? { basis: s.f.basis, asOf: s.f.asOf, revenueGrowthYoY: s.f.revenueGrowthYoY, epsGrowthYoY: s.f.epsGrowthYoY, operatingMargin: s.f.operatingMargin, roe: s.f.roe, pe: s.f.pe, improving: s.f.improving, deteriorating: s.f.deteriorating } : null,
      glocom: s.glocom ? { label: s.glocom.label, code: s.glocom.code } : null,
      score: s.score ? { total: s.score.total, components: Object.fromEntries(Object.entries(s.score.components).map(([k, c]) => [k, c.score])), conflicts: s.score.conflicts } : null,
      recentSignals: ev.map((e) => ({ date: e.date, signal: EVENT_LABEL[e.type] || e.type, after1M: e.fwd?.["1M"] ?? null })),
      links: { chart: link(`chart/${sec.id}`), page: link(`stock/${sec.id}`) },
      note: "Descriptive analysis of stored data. Not a recommendation.",
    };
    return out;
  }

  /** Plain-text read of the chart a user is looking at (feature 4.4). */
  async function chartRead(id, { tfs = ["D", "W"], mode = null } = {}) {
    const st = await data.get();
    const sec = st.secById.get(id);
    if (!sec) return { error: "unknown instrument" };
    const [s, b] = await Promise.all([data.api.snapshot(id), data.api.bars(id)]);
    if (!s || !b) return { error: "no data for this instrument" };
    const out = describeChart({ sec, snap: s.snap, bars: b, tfs, mode });
    return { instrument: { id, symbol: sec.symbol, name: sec.name }, asOf: out.asOf, text: out.text, note: out.note, link: link(`chart/${id}`) };
  }

  /** A link that opens one chart exactly as asked: Chart lab or an Analyst screen, period(s), comparison. */
  const SCREENS = ["RSIMMA", "RSIACC", "RSCMMA", "RSCACC"];
  async function pickOne(ref, country) {
    const t = String(ref || "").trim();
    if (/^i:./.test(t) || /^(CW|EW)\|/.test(t)) return { key: t.startsWith("i:") ? t : `i:${t}`, label: t.replace(/^i:/, "") };
    let c = await data.resolve(t, 20);
    if (country) { const want = String(canonicalCountry(country) || country).toLowerCase(); const f = c.filter((x) => String(x.country || "").toLowerCase() === want); if (f.length) c = f; }
    if (!c.length) return { error: `no instrument matches "${ref}"` };
    const exact = c.filter((x) => x.symbol.toUpperCase() === t.toUpperCase());
    const list = exact.length ? exact : c;
    if (list.length > 1 && !(exact.length === 1)) {
      const syms = new Set(list.map((x) => `${x.symbol}|${x.country}`));
      if (syms.size > 1) return { ambiguous: true, candidates: list.slice(0, 8).map((x) => ({ symbol: x.symbol, name: x.name, country: x.country, assetClass: x.assetClass })) };
    }
    const s = list[0];
    return { key: `s:${s.id}`, id: s.id, label: `${s.symbol} · ${s.name}`, country: s.country };
  }
  async function chartLink({ ref, screen = null, tf = null, tf2 = null, bench = null, country = null } = {}) {
    if (!cfg.appUrl) return { error: "APP_URL is not set on the TA server" };
    const a = await pickOne(ref, country);
    if (a.error || a.ambiguous) return a;
    const sc = screen ? String(screen).toUpperCase().replace(/[^A-Z]/g, "") : null;
    const okTf = (x) => (x && /^[0-9]*[DWMQHNY]$/i.test(String(x).trim()) ? String(x).trim().toUpperCase() : null);
    if (sc && SCREENS.includes(sc)) {
      const q = new URLSearchParams();
      if (okTf(tf)) q.set("l", okTf(tf));
      if (okTf(tf2)) q.set("r", okTf(tf2));
      let benchLabel = null;
      if (bench && sc.startsWith("RSC")) {
        const b = await pickOne(bench, null);
        if (b.error || b.ambiguous) return { benchmark: b };
        q.set("bench", b.key.startsWith("i:") ? `idx:${b.key.slice(2)}` : b.id);
        benchLabel = b.label;
      }
      const qs = q.toString();
      return { url: link(`screens/${sc}/${encodeURIComponent(a.key)}${qs ? `?${qs}` : ""}`), instrument: a.label, screen: sc, periods: [okTf(tf) || "saved left period", okTf(tf2) || "saved right period"], comparison: benchLabel || (sc.startsWith("RSC") ? "default (BSE 500 for India, S&P 500 for the US)" : null) };
    }
    if (sc && sc !== "CHART" && sc !== "CHARTLAB" && sc !== "STOCK") return { error: `screen must be one of chart, stock, ${SCREENS.join(", ")}` };
    if (!a.id) return { url: link(`screens/RSIMMA/${encodeURIComponent(a.key)}`), instrument: a.label, note: "house indices open on the RSIMMA screen" };
    if (sc === "STOCK") return { url: link(`stock/${encodeURIComponent(a.id)}`), instrument: a.label };
    return { url: link(`chart/${encodeURIComponent(a.id)}${okTf(tf) ? `?tf=${okTf(tf)}` : ""}`), instrument: a.label, period: okTf(tf) || "D" };
  }

  async function compare(a, b) {
    const [x, y] = await Promise.all([stock(a), stock(b)]);
    if (x.error || x.ambiguous) return { left: x };
    if (y.error || y.ambiguous) return { right: y };
    const pick = (s) => ({ symbol: s.instrument.symbol, name: s.instrument.name, sector: s.instrument.sector, country: s.instrument.country, returns: s.returnsLocalPct, weeklyMma: s.timeframes.weekly?.mma, dailyMma: s.timeframes.daily?.mma, weeklyRsi: s.timeframes.weekly?.rsi, rscVsCountry3M: s.relativeStrength.country?.changePct?.["3M"] ?? null, stage: s.stage.label, pctFrom52wHigh: s.levels.pctFromHigh52, score: s.score?.total ?? null, fundamentals: s.fundamentals });
    return { asOf: x.asOf, left: pick(x), right: pick(y), note: "Side-by-side stored metrics; not a recommendation." };
  }

  async function screen({ query, conditions, scope = {}, sort, limit = 25, columns = [] }) {
    const st = await data.get();
    let conds = conditions || [], sc = scope, so = sort, lim = limit, understood = [];
    if (query) { const c = parseCommand(query, { securities: st.secs, countries: st.countries }); conds = [...conds, ...c.conditions]; sc = { ...c.scope, ...scope }; so = sort || c.sort; lim = c.limit || limit; understood = c.understood; }
    for (const c of conds) if (!FIELD[c.field]) return { error: `unknown field ${c.field}; look keys up with /api/fields` };
    // scope words as people (and models) write them: "US", "usa", "india", "it" sector in any case
    const pick = (v, list) => { if (v == null || v === "") return v; const x = String(v).trim().toLowerCase(); return list.find((o) => String(o).toLowerCase() === x) ?? v; };
    conds = conds.map((c) => (c.field === "country" && c.value && ["is", "is not"].includes(c.op) ? { ...c, value: pick(canonicalCountry(c.value) || c.value, st.countries) }
      : ["sector", "region"].includes(c.field) && c.value && ["is", "is not"].includes(c.op) ? { ...c, value: pick(c.value, c.field === "sector" ? st.sectors : st.regions) } : c));
    if (sc.country) sc = { ...sc, country: pick(canonicalCountry(sc.country) || sc.country, st.countries) };
    if (sc.region) sc = { ...sc, region: pick(sc.region, st.regions) };
    if (sc.sector) sc = { ...sc, sector: pick(sc.sector, st.sectors) };
    let rows = runScreen(st.rows, { conditions: conds, scope: { country: sc.country, region: sc.region, classification: sc.classification, sector: sc.sector, industryGroup: sc.industryGroup, cap: sc.cap, assetClass: sc.assetClass } });
    const sf = so?.field || "score";
    rows = [...rows].sort((p, q) => { const u = FIELD[sf]?.get(p), v = FIELD[sf]?.get(q); if (u == null) return 1; if (v == null) return -1; return so?.dir === "asc" ? u - v : v - u; });
    return {
      asOf: st.info.asOf, understood, conditions: conds, scope: sc, total: rows.length, sortedBy: sf,
      ...(rows.length ? {} : { hint: `nothing matched; countries are written like ${st.countries.slice(0, 6).join(", ")}; sectors: ${st.sectors.join(", ")}` }),
      results: rows.slice(0, Math.min(lim || 25, 100)).map((r) => ({ id: r.id, chart: link(`chart/${r.id}`), symbol: r.sec.symbol, name: r.sec.name, country: r.sec.country, sector: r.sec.sector, [sf]: FIELD[sf]?.get(r) ?? null, ret3M: r.flat.ret3M, weeklyMma: r.flat.mmaW, score: r.flat.score, stage: r.flat.stage,
        ...Object.fromEntries((Array.isArray(columns) ? columns : []).slice(0, 20).filter((k) => FIELD[k]).map((k) => [k, FIELD[k].get(r) ?? null])),
        ...Object.fromEntries(conds.filter((c) => c.field && FIELD[c.field]).map((c) => [c.field, FIELD[c.field].get(r) ?? null])) })),
      link: query ? link(`screener?q=${encodeURIComponent(query)}`) : null,
    };
  }

  async function market(scope = "G") {
    const ccy = scope.startsWith("C:") ? "LCL" : "USD";
    const [cw, ew, br, rot] = await Promise.all([data.api.indexSeries(`CW|${ccy}|${scope}`), data.api.indexSeries(`EW|${ccy}|${scope}`), data.api.breadth(scope), data.api.rotation(scope)]);
    if (!cw) return { error: `no index for scope ${scope}; use G, R:<region> or C:<country>` };
    const chg = (s, k) => { const n = s.level.length - 1; return n - k >= 0 ? r2((s.level[n] / s.level[n - k] - 1) * 100) : null; };
    const st = await data.get();
    const n = br ? br.dates.length - 1 : -1;
    return {
      scope, asOf: cw.dates.at(-1),
      cwIndex: { level: r2(cw.level.at(-1)), chg1D: chg(cw, 1), chg1W: chg(cw, 5), chg1M: chg(cw, 21), chg3M: chg(cw, 63), chg12M: chg(cw, 252) },
      ewIndex: ew ? { chg1M: chg(ew, 21), chg3M: chg(ew, 63) } : null,
      breadth: n >= 0 ? { advancers: br.adv[n], decliners: br.dec[n], pctAbove50d: br.pct50[n], pctAbove200d: br.pct200[n], newHighs: br.newHigh[n], newLows: br.newLow[n], pctBullishWeeklyMma: br.pctBullMma[n] } : null,
      divergence: br ? breadthDivergence(cw, br) : null,
      regime: st.regimes[`CW|${ccy}|${scope}`] ? { label: st.regimes[`CW|${ccy}|${scope}`].label, efficiency: st.regimes[`CW|${ccy}|${scope}`].er, volPercentile: st.regimes[`CW|${ccy}|${scope}`].volPctile } : null,
      rotation: rot ? Object.fromEntries(["Leading", "Improving", "Weakening", "Lagging"].map((q) => [q, rot.filter((x) => x.quadrant === q).map((x) => x.name)])) : null,
      link: link(`breadth?scope=${encodeURIComponent(scope)}`),
    };
  }

  /** Watchlist / symbol list review: which are rising, with the evidence. */
  async function review(ids, question = null) {
    const st = await data.get();
    const rows = ids.map((id) => st.rowById.get(id)).filter(Boolean);
    const isRising = (r) => testCondition(r, { field: "mmaBullW", op: "is true" }) || (r.flat.trendUpW && r.flat.above50);
    const items = rows.map((r) => ({ id: r.id, symbol: r.sec.symbol, name: r.sec.name, rising: !!isRising(r), weeklyMma: r.flat.mmaW, dailyMma: r.flat.mmaD, ret1M: r.flat.ret1M, ret3M: r.flat.ret3M, rscCountry3M: r.flat.rscChg_country_3M, stage: r.flat.stage, score: r.flat.score }));
    return { asOf: st.info.asOf, question, rising: items.filter((x) => x.rising), notRising: items.filter((x) => !x.rising), missing: ids.length - rows.length, rule: "Rising = weekly MMA in bullish alignment, or price in a weekly uptrend and above its 50-day EMA" };
  }

  return { stock, chartRead, chartLink, compare, screen, market, review, fmtPct, fmtMoney };
}
