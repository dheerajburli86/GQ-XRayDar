// The calculation pipeline. ONE implementation, two hosts:
//   - cli/run.mjs runs it in Node against the heatmap Supabase database and
//     writes the results to the tas_* tables;
//   - the demo runs it in a browser Web Worker against a synthetic universe.
// Both produce the same structures through the same `sink` interface, so every
// screen in the app reads identical shapes whichever data source is connected.
//
// Order:
//   pass 1  per country: indices (CW/EW x local/USD) + rebalance memberships
//   finish  regional / classification / global indices (USD), Weight Watcher
//   pass 2  per country: per-stock signals, events, breadth, data health
//   post    breadth series, rotation, regimes, EWCW, backtest summary

import { METHODOLOGY, methodologyHash } from "./methodology.js";
import { quarterEndIndices, lowerBound, addDays } from "./calendar.js";
import { buildFxTable, fxProvenance } from "./fx.js";
import { toSecurity, isAnalysableRow } from "./classification.js";
import { countryMeta, CAP_UNRELIABLE_COUNTRIES } from "./geography.js";
import { IndexBuilder, indexKey, compactSeries } from "./indexEngine.js";
import { computeWeightWatcher, wwTrend } from "./weightWatcher.js";
import { analyzeSecurity, detectEvents, withForwardReturns } from "./signals.js";
import { Breadth } from "./breadth.js";
import { rotation, regime, ewcw } from "./analytics.js";
import { fundamentalMetrics, fundamentalPercentiles } from "./fundamentals.js";
import { scoreSetup } from "./scoring.js";
import { buildFlat } from "./screenRow.js";
import { securityIssues, applyCorporateActions, removeBadPrints, shareBreaks, cutAtTickerReuse } from "./quality.js";
import { BacktestAccumulator } from "./backtest.js";
import { GroupAccumulator, checkpointReturns, rateGlocom, groupMoves } from "./glocom.js";
import { UNCLASSIFIED } from "./classification.js";
import { turnoverUsd } from "./turnover.js";

/**
 * source: see docs/ARCHITECTURE.md ("Source interface")
 * sink:   receives results as they are produced (all methods optional, may be async)
 */
export async function runPipeline(source, sink, { methodology = METHODOLOGY, onProgress = () => {}, runId = null } = {}) {
  const m = methodology;
  const started = new Date().toISOString();
  const run = { runId: runId || `run_${started.replace(/[-:.TZ]/g, "").slice(0, 14)}`, started, mode: source.mode, methodologyVersion: m.version, methodologyHash: methodologyHash(m), status: "running", stats: {} };
  await sink.begin?.(run, m);
  const progress = (phase, done, total, note) => onProgress({ phase, done, total, note });

  // ---- calendar, securities, FX -------------------------------------------------
  progress("load", 0, 1, "calendar and security master");
  const dates = await source.calendar(m.startDate);
  const T = dates.length;
  if (T < 300) throw new Error(`calendar too short (${T} dates)`);
  const dIdx = new Map(dates.map((d, i) => [d, i]));
  const rawRows = await source.securities();
  const indiaMap = source.indiaMap ? await source.indiaMap() : null;
  const secs = rawRows.filter(isAnalysableRow).map((r) => toSecurity(r, indiaMap));
  const isStock = (sec) => sec.assetClass === "Stock";
  const byCountry = new Map();
  for (const s of secs) {
    if (!s.country) continue;
    if (!byCountry.has(s.country)) byCountry.set(s.country, []);
    byCountry.get(s.country).push(s);
  }
  const { history: fxHist, latest: fxLatest } = await source.fxHistory();
  const fx = buildFxTable(dates, fxHist, fxLatest);
  const corp = source.corporateActions ? await source.corporateActions() : new Map();
  const shareCounts = source.shareCounts ? await source.shareCounts() : new Map();
  const reb = quarterEndIndices(dates);
  run.stats.dates = { from: dates[0], to: dates[T - 1], sessions: T, rebalances: reb.length };
  run.stats.securities = secs.length;
  run.stats.countries = byCountry.size;
  const countries = [...byCountry.keys()].sort();
  const geo = Object.fromEntries(countries.map((c) => [c, countryMeta(c)]));
  const countryCcy = (c, list) => geo[c].currency || mostCommon(list.map((s) => s.currencyMajor));

  // ---- helpers: load + align one country --------------------------------------
  async function loadCountry(country) {
    const list = byCountry.get(country);
    const bars = await source.countryBars(list.map((s) => s.id), country);
    const out = [];
    for (const sec of list) {
      let b = bars.get(sec.id);
      if (!b || !b.time.length) continue;
      const ca = corp.get?.(sec.id);
      if (ca?.length) b = applyCorporateActions(b, ca).bars;
      // bad prints out first (they would also look like share-count breaks), then the date from
      // which latest-shares x past-price caps are usable at all (engine/quality.js)
      const bad = removeBadPrints(b);
      b = bad.bars;
      const reuse = cutAtTickerReuse(b);
      b = reuse.bars;
      if (!b.time.length) continue;
      // a x3 step that holds is a share event only when the reported share count also moved x2+
      // (a real crash keeps its shares: Upstart May 2022); a x10 step is one regardless
      const brk = shareBreaks(b);
      const sc = shareCounts.get(sec.id);
      const scMoved = sc?.length >= 2 && Math.max(...sc.map((x) => x.shares)) >= 2 * Math.min(...sc.map((x) => x.shares));
      const qual = brk.breaks.filter((x) => x.ratio >= 10 || x.ratio <= 0.1 || scMoved);
      const capFromDate = qual.length ? qual[qual.length - 1].date : null;
      // drop bars before the calendar window minus a year of warm-up is kept by the source
      const close = new Float64Array(T).fill(NaN), traded = new Uint8Array(T), barAt = new Int32Array(T).fill(-1);
      let first = -1, last = -1, j = 0;
      for (let t = 0; t < T; t++) {
        while (j < b.time.length && b.time[j] <= dates[t]) j++;
        if (j === 0) continue; // before first bar
        const k = j - 1;
        if (first < 0) first = t;
        close[t] = b.close[k]; barAt[t] = k;
        if (b.time[k] === dates[t]) traded[t] = 1;
        last = t;
      }
      if (first < 0) continue;
      // A delisted security (or one whose feed stopped) leaves the index at its last
      // real bar. An active one whose last bar is only a few sessions old -- a
      // local holiday on the final calendar date -- stays in, carried at that close.
      const lastBarT = indexAtOrBeforeMap(dates, b.time[b.time.length - 1]);
      if (!sec.active || T - 1 - lastBarT > m.eligibility.maxStaleDays) last = Math.min(last, lastBarT);
      out.push({ sec, bars: b, first, last, close, traded, barAt, capFromDate, badPrints: bad.removed, tickerReuse: reuse.cut, shareBreaks: qual });
    }
    return out;
  }

  // ---- pass 1: indices ---------------------------------------------------------
  const builder = new IndexBuilder({ dates, rebalanceIdx: reb, fx, methodology: m });
  const retained = new Map(); // benchmark series kept for pass 2 / rotation: key -> {dates, level}
  const ewcwRows = [], regimeRows = {};
  const house = new Map(); // house indices to analyse as rows: key -> {meta, lite}
  const houseKey = (r) => ((r.family === "CW" && r.ccy === "USD") || (r.family === "EW" && r.country && CAP_UNRELIABLE_COUNTRIES.has(r.country) && r.ccy === "LCL"))
    && /^(G|R:[^|]+|M:[^|]+|C:[^|]+(\|S:[^|]+)?)$/.test(r.scopeKey || "");
  const keepKey = (k) => k.startsWith("CW|LCL|C:") || /^CW\|USD\|(G|R:|M:)/.test(k) || /^EW\|USD\|(G|R:|M:)$/.test(k) || /^EW\|LCL\|C:[^|]*$/.test(k)
    || (k.startsWith("EW|LCL|C:") && [...CAP_UNRELIABLE_COUNTRIES].some((c) => k.startsWith(`EW|LCL|C:${c}`)));
  async function drainSeries() {
    const recs = [...builder.series.values()];
    builder.series.clear();
    const byScope = new Map();
    for (const rec of recs) {
      const c = compactSeries(rec, dates);
      if (!c.dates.length) continue;
      const meta = { ...rec }; delete meta.values; delete meta.rets; delete meta.n; delete meta.nStale; delete meta.capSeries;
      meta.startDate = c.dates[0]; meta.lastDate = c.dates[c.dates.length - 1]; meta.lastLevel = c.level[c.level.length - 1];
      meta.nLast = c.n[c.n.length - 1];
      meta.capEstimated = true;
      await sink.indexSeries?.(meta, c);
      const lite = { dates: c.dates, level: c.level };
      if (keepKey(rec.key)) retained.set(rec.key, lite);
      if (houseKey(rec) && lite.dates.length >= 60) house.set(rec.key, { meta, lite });
      const pk = `${rec.ccy}|${rec.scopeKey}`;
      if (!byScope.has(pk)) byScope.set(pk, {});
      byScope.get(pk)[rec.family] = { meta, lite };
      const equalOnly = rec.family === "EW" && CAP_UNRELIABLE_COUNTRIES.has(rec.country); // no CW exists for it
      if ((rec.family === "CW" || equalOnly) && (!rec.cap) && (rec.ccy === "USD" || rec.scopeType === "C")) {
        const rg = regime(lite, m.regime);
        if (rg) regimeRows[rec.key] = { ...rg, name: meta.name };
      }
    }
    for (const [pk, pair] of byScope) {
      if (!pair.CW || !pair.EW) continue;
      const e = ewcw(pair.EW.lite, pair.CW.lite);
      if (e.summary) ewcwRows.push({ pairKey: pk, ccy: pair.CW.meta.ccy, scopeKey: pair.CW.meta.scopeKey, name: pair.CW.meta.name.replace(/ CW/, ""), level: pair.CW.meta.level, ...e.summary });
    }
  }

  let ci = 0;
  for (const country of countries) {
    progress("indices", ci++, countries.length, country);
    const stocks = await loadCountry(country);
    if (!stocks.length) continue;
    const equities = stocks.filter((x) => isStock(x.sec));
    if (equities.length) builder.addCountry(country, countryCcy(country, byCountry.get(country)), equities, geo[country].region, geo[country].classification);
    await drainSeries();
  }
  builder.finish();
  await drainSeries();
  await sink.memberships?.(builder.memberships);
  const guardIssues = builder.splitGuarded.map((g) => ({ id: g.id, symbol: null, country: null, severity: "error", rule: "index_split_guard",
    detail: `${g.date}: one-day price ratio x${g.ratio} looks like an unadjusted split; its return was set to zero in every index. Record the corporate action to adjust the stock's history.` }));
  run.stats.splitGuarded = guardIssues.length;
  run.stats.indexedSecurities = builder.stats.stocksIndexed.size;
  run.stats.excluded = builder.stats.excluded;

  // ---- Weight Watcher ------------------------------------------------------------
  progress("weight_watcher", 0, 1);
  const ww = computeWeightWatcher(builder.memberships, geo);
  const segOf = new Map();
  await sink.ww?.(ww);
  const stockWW = new Map();
  for (const grp of ww) {
    if (grp.childType !== "stock" || grp.parentType !== "countrySector") continue;
    for (const ch of grp.children) stockWW.set(ch.key, { parentKey: grp.parentKey, dates: grp.dates, weights: ch.weights, latestFlags: grp.latestFlags });
  }
  // cap segment each security holds in the CURRENT period (assigned at the last rebalance)
  const lastReb = new Map();
  for (const ms of builder.memberships) if (!ms.latest && (!lastReb.has(ms.country) || ms.date > lastReb.get(ms.country).date)) lastReb.set(ms.country, ms);
  for (const ms of lastReb.values()) for (const mem of ms.members) segOf.set(mem.id, mem.seg);
  builder.memberships.length = 0;
  for (const sec of secs) sec.capSegment = segOf.get(sec.id) || null;

  // latest cap segment per security from the last membership snapshot is re-derived in pass 2
  // ---- pass 2: per-stock signals, events, breadth, health ----------------------
  const breadth = new Breadth(T);
  const bt = new BacktestAccumulator();
  const allSnaps = [];
  const issuesAll = [];
  const lastDate = dates[T - 1];
  ci = 0;
  const fundAll = source.fundamentals ? true : false;
  const glocom = source.glocom ? await source.glocom() : new Map();
  const eti = source.eti ? await source.eti() : new Map();
  // GLOCOM / LOCOM: group rank history per market (local currency) and globally (USD)
  const gK = m.glocom.historySessions;
  const ckG = dates.slice(-gK);
  const accG = { industry: new GroupAccumulator(ckG), sector: new GroupAccumulator(ckG), country: new GroupAccumulator(ckG) };
  const glocomGroups = {};
  for (const country of countries) {
    progress("signals", ci++, countries.length, country);
    const stocks = await loadCountry(country);
    if (!stocks.length) continue;
    const ccy = countryCcy(country, byCountry.get(country));
    const fxCC = fx(ccy).rate;
    // a country without a reliable cap has no CW: its equal-weight index is its benchmark
    const bFam = CAP_UNRELIABLE_COUNTRIES.has(country) ? "EW" : "CW";
    const bCountry = toBench(retained.get(indexKey(bFam, "LCL", `C:${country}`)));
    const bRegion = toBench(retained.get(indexKey("CW", "USD", `R:${geo[country].region}`)));
    const bGlobal = toBench(retained.get(indexKey("CW", "USD", "G")));
    const funds = fundAll ? await source.fundamentals(stocks.map((s) => s.sec.id)) : new Map();

    // country session set (>= 80% of listed stocks traded) for missing-session checks
    const cnt = new Int32Array(T), listed = new Int32Array(T);
    for (const s of stocks) { if (!isStock(s.sec)) continue; for (let t = s.first; t <= s.last; t++) { listed[t]++; if (s.traded[t]) cnt[t]++; } }
    const sessions = []; let countryLatest = null;
    for (let t = 0; t < T; t++) if (listed[t] >= 3 && cnt[t] >= 0.8 * listed[t]) { sessions.push(dates[t]); }
    for (let t = T - 1; t >= 0; t--) if (cnt[t] > 0) { countryLatest = dates[t]; break; }
    const sessionsBetween = (a, b) => lowerBound(sessions, b) - lowerBound(sessions, a);
    const recentFrom = addDays(lastDate, -365);

    const snaps = [], events = new Map(), issues = [];
    const ckC = sessions.length >= 2 ? sessions.slice(-gK) : ckG;
    const accC = { industry: new GroupAccumulator(ckC), sector: new GroupAccumulator(ckC) };
    const latestRet = new Map();
    const secOfId = new Map(stocks.map((x) => [x.sec.id, x.sec]));
    for (const s of stocks) {
      const { sec } = s;
      const b = toPlain(s.bars); // sources may hand over typed arrays; analysis maps with nulls
      const fxo = fx(sec.currency).rate;
      const usd = new Array(b.time.length), cc = new Array(b.time.length);
      for (let k = 0; k < b.time.length; k++) {
        const t = indexAtOrBeforeMap(dates, b.time[k], dIdx);
        const rate = t >= 0 ? fxo[t] : fxo[0], rcc = t >= 0 ? fxCC[t] : fxCC[0];
        usd[k] = b.close[k] * rate; cc[k] = (b.close[k] * rate) / rcc;
      }
      const bSector = toBench(retained.get(indexKey(bFam, "LCL", `C:${country}|S:${sec.sector}`)));
      const an = analyzeSecurity(b, usd, cc, { country: bCountry, countrySector: bSector, region: bRegion, global: bGlobal }, { divisor: sec.currencyDivisor }, m);
      issues.push(...securityIssues(sec, b, { countryLatest, countrySessions: sessions, recentFrom, sessionsBetween }));
      if (s.badPrints?.length) issues.push({ id: sec.id, symbol: sec.symbol, country: sec.country, severity: "warn", rule: "bad_print_removed",
        detail: `${s.badPrints.length} bad print(s) ignored, e.g. ${s.badPrints.slice(0, 3).map((x) => `${x.date} ${x.close} (previous close ${x.prev})`).join(", ")}: the price jumped and came straight back` });
      if (s.tickerReuse) issues.push({ id: sec.id, symbol: sec.symbol, country: sec.country, severity: "warn", rule: "ticker_reuse_cut",
        detail: `${s.tickerReuse.bars} bar(s) before ${s.tickerReuse.date} dropped: after a gap the price moved from ${s.tickerReuse.prev} to ${s.tickerReuse.next}, which is a different company that used this ticker earlier. The older history of THIS company is not in the price store (it sits under its former ticker) and has to be loaded in the heatmap pipeline.` });
      if (s.shareBreaks?.length && isStock(sec)) issues.push({ id: sec.id, symbol: sec.symbol, country: sec.country, severity: "warn", rule: "share_count_break",
        detail: `Price stepped x${s.shareBreaks.map((x) => `${x.ratio} on ${x.date}`).join(", x")} and stayed there: likely a split, reverse split or restructuring. Market caps before ${s.capFromDate} cannot be estimated, so the stock joins CW / EW indices and Weight Watcher only from then.` });
      if (!an) continue;
      if (isStock(sec) && sec.industryGroup && sec.industryGroup !== UNCLASSIFIED) {
        const rc = checkpointReturns(b.time, cc, ckC), rg = checkpointReturns(b.time, usd, ckG);
        accC.industry.add(sec.industryGroup, rc); accC.sector.add(sec.sector, rc);
        accG.industry.add(sec.industryGroup, rg); accG.sector.add(sec.sector, rg); accG.country.add(country, rg);
        if (rc[rc.length - 1]) latestRet.set(sec.id, rc[rc.length - 1]);
      }
      const shares = estimateSharesFromRow(sec, b, fx, T);
      const capNow = shares ? shares * b.close[b.time.length - 1] * fxo[T - 1] : null;
      const f = funds.get(sec.id);
      const fm = f ? fundamentalMetrics(f, b.close[b.time.length - 1] / sec.currencyDivisor, fxToReported(fx, sec, f, T)) : null;
      const wws = stockWW.get(sec.id);
      const wwT = wws ? { ...wwTrend(wws.weights), parentKey: wws.parentKey } : null;
      const turn = turnoverUsd(usd.map((u) => u / (sec.currencyDivisor || 1)), b.volume);
      snaps.push({ id: sec.id, turnoverUsd: turn, snap: an.snapshot, f: fm, ww: wwT, glocom: glocom.get(sec.id) || null, eti: eti.get(sec.id) || null, capUsdNow: capNow ? Math.round(capNow) : null, sharesEst: shares });

      // events (+ WW turning points) with forward returns
      let ev = detectEvents(an, b, bCountry, cc, m);
      if (wws) {
        const wev = [];
        for (let q = 4; q < wws.weights.length; q++) {
          if (wws.latestFlags[q]) continue;
          const tr = wwTrend(wws.weights.slice(0, q + 1)).trend;
          if (tr === "turn_up_from_low") wev.push({ type: "ww_turn_up", tf: "Q", date: wws.dates[q] });
          if (tr === "turn_down_from_high") wev.push({ type: "ww_turn_down", tf: "Q", date: wws.dates[q] });
        }
        ev = ev.concat(withForwardReturns(wev, b, bCountry, cc, m));
      }
      ev.sort((x, y) => (x.date < y.date ? -1 : 1));
      events.set(sec.id, ev);
      const scopes = ["G", `R:${sec.region}`, `C:${country}`];
      if (isStock(sec)) for (const e of ev) bt.add(e, scopes);

      // breadth
      const W = an.tfs.W;
      const wb = new Int8Array(T).fill(-1);
      let k = -1;
      for (let t = 0; t < T; t++) {
        while (k + 1 < W.n && W.b.time[k + 1] < dates[t]) k++;
        if (k >= 0 && W.states[k]) wb[t] = W.states[k].bull ? 1 : 0;
      }
      if (isStock(sec)) breadth.add({ firstT: s.first, lastT: s.last, barAt: s.barAt, traded: s.traded, close: b.close, e20: an.dayEma.e20, e50: an.dayEma.e50, e200: an.dayEma.e200, hi52: an.dayEma.hi52, lo52: an.dayEma.lo52, weeklyBullAt: wb },
        ["G", `R:${sec.region}`, `M:${sec.classification}`, `C:${country}`],
        [`G|S:${sec.sector}`, `R:${sec.region}|S:${sec.sector}`, `C:${country}|S:${sec.sector}`]);
    }
    // RS rank within country (percentile of 3M RSC change vs the country index)
    const vals = snaps.filter((x) => isStock(secOfId.get(x.id))).map((x) => x.snap.rsc?.country?.D?.chg?.["3M"]).filter((v) => v != null).sort((a, b) => a - b);
    for (const x of snaps) {
      const v = x.snap.rsc?.country?.D?.chg?.["3M"];
      x.rsRank = v == null || !vals.length ? null : Math.round((lowerBoundNum(vals, v) / vals.length) * 100);
    }
    // participation (sector % above 50-DMA, latest date) and fundamental percentiles within the country
    const secOf = new Map(stocks.map((x) => [x.sec.id, x.sec]));
    const pct50 = (sector) => {
      const sc = breadth.scopes.get(`C:${country}|S:${sector}`);
      if (!sc) return null;
      for (let t = T - 1; t >= 0; t--) if (sc.f.n50[t] > 0) return Math.round((sc.f.a50[t] / sc.f.n50[t]) * 100);
      return null;
    };
    applyGlocom(country, snaps, secOfId, latestRet, accC, glocomGroups);
    const fpct = fundamentalPercentiles(snaps.map((x) => ({ id: x.id, f: x.f })));
    for (const x of snaps) {
      const sec = secOf.get(x.id);
      const ctx = { rsRank: x.rsRank, sectorPct50: pct50(sec.sector), fundPct: fpct.get(x.id) || null };
      x.score = scoreSetup({ snap: x.snap, f: x.f }, ctx, m.scoring.weights);
      x.flat = buildFlat({ sec: { ...sec, capUsdNow: x.capUsdNow }, snap: x.snap, f: x.f, ww: x.ww, glocom: x.glocom, eti: x.eti, score: x.score, rsRank: x.rsRank });
    }
    await sink.countryResults?.(country, { snapshots: snaps, events, issues });
    for (const x of snaps) allSnaps.push({ id: x.id, capUsdNow: x.capUsdNow, turnoverUsd: x.turnoverUsd ?? null });
    issuesAll.push(...issues.filter((x) => x.severity !== "info"));
    run.stats.issues = (run.stats.issues || 0) + issues.length;
  }

  // ---- house indices as rows (close-only bars; never inside CW / EW) -----------
  const houseSecs = [];
  {
    const snaps = [], events = new Map();
    const bG = toBench(retained.get(indexKey("CW", "USD", "G")));
    for (const [key, { meta, lite }] of house) {
      const b = { time: lite.dates, open: lite.level, high: lite.level, low: lite.level, close: lite.level, volume: null };
      const an = analyzeSecurity(b, lite.level, lite.level, { country: bG, countrySector: null, region: bG, global: bG }, { divisor: 1 }, m);
      if (!an) continue;
      const scope = meta.scopeKey || "G";
      const country = scope.startsWith("C:") ? scope.slice(2).split("|")[0] : null;
      const sec = { id: `h:${key}`, symbol: key.replace(/\|/g, " "), name: meta.name, universe: "house_indices", exchange: "GQ", isin: null, country: country || "Global",
        region: scope.startsWith("R:") ? scope.slice(2).split("|")[0] : country ? geo[country]?.region ?? null : null, classification: scope.startsWith("M:") ? scope.slice(2) : country ? geo[country]?.classification ?? null : null,
        geoAssigned: true, currency: meta.ccy === "LCL" ? "LCL" : "USD", currencyMajor: meta.ccy === "LCL" ? "LCL" : "USD", currencyDivisor: 1, countryCurrency: null,
        sector: scope.includes("|S:") ? scope.split("|S:")[1] : null, industryGroup: null, industry: null, classSource: "house_index", capLocal: null, capCurrency: null, capUsd: null, capSegment: null,
        assetClass: "Index", active: true };
      const x = { id: sec.id, snap: an.snapshot, f: null, ww: null, glocom: null, eti: null, capUsdNow: null, sharesEst: null, turnoverUsd: null };
      x.score = scoreSetup({ snap: x.snap, f: null }, { rsRank: null, sectorPct50: null, fundPct: null }, m.scoring.weights);
      x.flat = buildFlat({ sec, snap: x.snap, f: null, ww: null, glocom: null, eti: null, score: x.score, rsRank: null });
      snaps.push(x); houseSecs.push(sec); events.set(sec.id, []);
    }
    if (snaps.length) {
      await sink.countryResults?.("House indices", { snapshots: snaps, events, issues: [] });
      for (const x of snaps) allSnaps.push({ id: x.id, capUsdNow: null, turnoverUsd: null });
    }
    run.stats.houseIndexRows = snaps.length;
  }

  // ---- post: breadth, rotation, regimes, EWCW, backtest, FX --------------------
  progress("analytics", 0, 1);
  const breadthOut = breadth.output(dates, reb[0] ?? 0);
  await sink.breadth?.(breadthOut);
  const rot = {};
  const scopesForRotation = [["G", "USD"], ...[...new Set(countries.map((c) => geo[c].region))].map((r) => [`R:${r}`, "USD"]), ...countries.map((c) => [`C:${c}`, "LCL"])];
  for (const [sc, ccyK] of scopesForRotation) {
    const fam = CAP_UNRELIABLE_COUNTRIES.has(sc.slice(2)) && sc.startsWith("C:") ? "EW" : "CW";
    const base = retained.get(indexKey(fam, ccyK, sc));
    if (!base) continue;
    const sectors = [];
    for (const [k, v] of retained) {
      const prefix = `${fam}|${ccyK}|${sc}|S:`;
      if (k.startsWith(prefix) && !k.slice(prefix.length).includes("|")) sectors.push({ key: k, name: k.slice(prefix.length), series: v });
    }
    if (sectors.length >= 2) rot[sc] = rotation(sectors, base, m.rotation);
  }
  await sink.rotation?.(rot);
  for (const lv of ["industry", "sector", "country"]) glocomGroups[`G|${lv}`] = accG[lv].history();
  await sink.glocomGroups?.(glocomGroups);
  await sink.regimes?.(regimeRows);
  await sink.ewcw?.(ewcwRows);
  await sink.backtest?.(bt.rows());
  const fxRows = [...new Set(secs.map((s) => s.currencyMajor).concat(countries.map((c) => countryCcy(c, byCountry.get(c)))))].filter(Boolean).sort()
    .map((c) => ({ ...fxProvenance(fx(c), reb[0] ?? 0, T - 1), latest: fx(c).rate[T - 1], latestDate: lastDate }));
  await sink.fx?.(fxRows, { dates, fx });
  const geoIssues = countries.filter((c) => !geo[c].assigned).map((c) => ({ id: null, symbol: null, country: c, severity: "warn", rule: "unassigned_geography", detail: `${c}: no region/classification mapping` }));
  const fxIssues = fxRows.filter((r) => r.estimated || r.maxStale > m.fx.staleWarnDays).map((r) => ({ id: null, symbol: null, country: null, severity: r.estimated ? "warn" : "info", rule: r.estimated ? "fx_estimated" : "fx_stale", detail: `${r.currency}: ${r.estimated ? `no FX history (${r.source}); USD series use a constant rate` : `${r.staleDays} carried-forward fixings, longest ${r.maxStale} sessions`}` }));
  const symOf = new Map(secs.map((x) => [x.id, x]));
  for (const g of guardIssues) { const x = symOf.get(g.id); g.symbol = x?.symbol || null; g.country = x?.country || null; }
  await sink.globalIssues?.([...geoIssues, ...fxIssues, ...guardIssues]);
  await sink.securities?.(secs.concat(houseSecs), new Map(allSnaps.map((x) => [x.id, x])));

  run.finished = new Date().toISOString();
  run.status = "ok";
  await sink.finish?.(run);
  progress("done", 1, 1);
  return run;
}

function toPlain(b) {
  if (Array.isArray(b.close)) return b;
  return { time: Array.from(b.time), open: Array.from(b.open), high: Array.from(b.high), low: Array.from(b.low), close: Array.from(b.close), volume: b.volume ? Array.from(b.volume) : null };
}

function toBench(lite) { return lite ? { time: lite.dates, close: lite.level } : null; }

function indexAtOrBeforeMap(dates, d, map) {
  if (map) { const x = map.get(d); if (x != null) return x; }
  const i = lowerBound(dates, d);
  return i < dates.length && dates[i] === d ? i : i - 1;
}
// Stock GLOCOM (vs the market), LOCOM (vs its industry group) and its industry's
// GLOCOM rank and movement. The heatmap's own stock GLOCOM (glocom_latest) wins
// where it exists, so both products show the same label for a stock.
function applyGlocom(country, snaps, secOfId, latestRet, accC, out) {
  const hist = { industry: accC.industry.history(), sector: accC.sector.history() };
  out[`C:${country}|industry`] = hist.industry; out[`C:${country}|sector`] = hist.sector;
  const ids = [...latestRet.keys()];
  const market = new Map(rateGlocom(ids.map((id) => ({ key: id, ...latestRet.get(id) }))).map((x) => [x.key, x]));
  const byGroup = new Map();
  for (const id of ids) { const g = secOfId.get(id).industryGroup; if (!byGroup.has(g)) byGroup.set(g, []); byGroup.get(g).push(id); }
  const locom = new Map();
  for (const list of byGroup.values()) if (list.length >= 3) for (const x of rateGlocom(list.map((id) => ({ key: id, ...latestRet.get(id) })))) locom.set(x.key, x);
  const mv = (lv, back) => new Map(groupMoves(hist[lv], back).map((x) => [x.name, x]));
  const ind1 = mv("industry", 1), ind5 = mv("industry", 5), sec1 = mv("sector", 1);
  const pick = (x) => x && { code: x.code, label: x.label, pW: rd(x.pW), p6m: rd(x.p6m), p1y: rd(x.p1y), rank: x.rank };
  for (const s of snaps) {
    const sec = secOfId.get(s.id);
    const own = market.get(s.id);
    const base = s.glocom ? { ...s.glocom, source: "heatmap" } : own ? { ...pick(own), source: "engine" } : null;
    const i1 = ind1.get(sec.industryGroup), i5 = ind5.get(sec.industryGroup), s1 = sec1.get(sec.sector);
    const extra = {
      locom: pick(locom.get(s.id)) || null,
      industry: i1 ? { name: i1.name, code: i1.code, label: i1.label, rank: i1.rank, of: i1.of, jump1D: i1.jump, jump1W: i5?.jump ?? null, bandMove1D: i1.bandMove } : null,
      sector: s1 ? { name: s1.name, code: s1.code, label: s1.label, rank: s1.rank, of: s1.of, jump1D: s1.jump } : null,
    };
    s.glocom = base || extra.locom || extra.industry ? { ...(base || {}), ...extra } : null;
  }
}
const rd = (v) => (v == null ? null : Math.round(v * 1000) / 1000);

function lowerBoundNum(a, v) { let lo = 0, hi = a.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] < v) lo = mid + 1; else hi = mid; } return lo; }
function mostCommon(xs) { const m = new Map(); for (const x of xs) m.set(x, (m.get(x) || 0) + 1); return [...m].sort((a, b) => b[1] - a[1])[0]?.[0] || "USD"; }

function estimateSharesFromRow(sec, b, fx, T) {
  const px = b.close[b.close.length - 1];
  if (!(px > 0)) return null;
  const pxUsd = px * fx(sec.currency).rate[T - 1];
  let capUsd = null;
  if (sec.capLocal > 0 && sec.capCurrency) capUsd = sec.capLocal * fx(sec.capCurrency).rate[T - 1];
  else if (sec.capUsd > 0) capUsd = sec.capUsd;
  return capUsd > 0 && pxUsd > 0 ? capUsd / pxUsd : null;
}

function fxToReported(fx, sec, f, T) {
  const rep = f.reported_currency || f.income_statement_q?.[0]?.reportedCurrency || f.income_statement?.[0]?.reportedCurrency;
  if (!rep) return 1;
  if (rep === sec.currencyMajor) return 1;
  const a = fx(sec.currencyMajor).rate[T - 1], b = fx(rep).rate[T - 1];
  return a > 0 && b > 0 ? a / b : null;
}
