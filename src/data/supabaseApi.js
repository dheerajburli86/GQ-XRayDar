// Data API over Supabase (anon key, read only). Market data comes from the
// heatmap dashboard's tables; computed analytics from this app's tas_* tables,
// which the batch engine (cli/run.mjs) fills.
import { createClient } from "@supabase/supabase-js";
import { applyCorporateActions } from "../../engine/quality.js";
import { decodeEvents } from "../../engine/eventCodec.js";
import { SCREEN_KEYS } from "../../engine/screenRow.js";

const PAGE = Number(import.meta.env.VITE_PAGE_ROWS) || 1000;

export function createSupabaseApi(url, key) {
  const sb = createClient(url, key, { auth: { persistSession: false } });

  // Pages are fetched in parallel (PostgREST caps a response at PAGE rows, so a 29k-row table is 29 requests).
  // The first page also returns the row count; the rest go out PAR at a time and are joined in order.
  const PAR = 8;
  async function all(table, select, build = (q) => q, order = null) {
    const page = async (from, count) => {
      let q = sb.from(table).select(select, count ? { count: "exact" } : undefined).range(from, from + PAGE - 1);
      if (order) q = q.order(order, { ascending: true });
      q = build(q);
      const { data, error, count: n } = await q;
      if (error) throw new Error(`${table}: ${error.message}`);
      return { data, n };
    };
    const first = await page(0, true);
    if (first.data.length < PAGE) return first.data;
    const pages = Math.ceil((first.n ?? first.data.length) / PAGE);
    const parts = new Array(pages); parts[0] = first.data;
    let next = 1;
    const worker = async () => { while (next < pages) { const i = next++; parts[i] = (await page(i * PAGE)).data; } };
    await Promise.all(Array.from({ length: Math.min(PAR, pages - 1) }, worker));
    // a table that grew while loading: keep going serially until a short page
    let out = parts.flat();
    if (parts[pages - 1].length === PAGE) for (let from = pages * PAGE; ; from += PAGE) { const { data } = await page(from); out = out.concat(data); if (data.length < PAGE) break; }
    return out;
  }
  const one = async (q) => { const { data, error } = await q; if (error) throw new Error(error.message); return data; };

  let secCache = null, infoCache = null;
  const secMap = async () => { if (!secCache) { const s = await api.securities(); secCache = new Map(s.map((x) => [x.id, x])); } return secCache; };

  const api = {
    async clearCache() { secCache = null; infoCache = null; },
    async info() {
      if (infoCache) return infoCache;
      const runs = await one(sb.from("tas_calc_run").select("run_id,started,finished,mode,methodology_version,methodology_hash,methodology,status,stats,error").order("started", { ascending: false }).limit(20));
      const okRun = runs.find((r) => r.status === "ok");
      if (!okRun) throw new Error("No successful calculation run yet. Run the engine (npm run engine) against the database first.");
      const toRun = (r) => ({ runId: r.run_id, started: r.started, finished: r.finished, mode: r.mode, methodologyVersion: r.methodology_version, methodologyHash: r.methodology_hash, status: r.status, stats: r.stats, error: r.error });
      infoCache = { mode: "supabase", run: toRun(okRun), runs: runs.map(toRun), methodology: okRun.methodology, asOf: okRun.stats?.dates?.to, screenKeys: okRun.stats?.screenKeys || SCREEN_KEYS };
      return infoCache;
    },
    async securities() {
      const rows = await all("tas_security", "*", undefined, "id");
      return rows.map((r) => ({
        id: r.id, symbol: r.symbol, name: r.name, universe: r.universe, exchange: r.exchange, isin: r.isin, country: r.country, region: r.region,
        classification: r.classification, geoAssigned: r.geo_assigned, currency: r.currency, currencyMajor: r.currency_major, currencyDivisor: r.currency_divisor,
        countryCurrency: r.country_currency, sector: r.sector, industryGroup: r.industry_group, industry: r.industry, classSource: r.class_source,
        capLocal: r.cap_local, capCurrency: r.cap_currency, capUsd: r.cap_usd, capUsdNow: r.cap_usd_now, capSegment: r.cap_segment, assetClass: r.asset_class || "Stock", active: r.active,
      }));
    },
    async screenRows() { return (await all("tas_snapshot", "id,flat,rs_rank", undefined, "id")).map((r) => ({ id: r.id, flat: r.flat, rsRank: r.rs_rank })); },
    async snapshot(id) {
      const r = await one(sb.from("tas_snapshot").select("id,snap,f,ww,glocom,rs_rank,score").eq("id", id).maybeSingle());
      return r ? { id: r.id, snap: r.snap, f: r.f, ww: r.ww, glocom: r.glocom, rsRank: r.rs_rank, score: r.score } : null;
    },
    async indexList() {
      const rows = await all("tas_index", "*", undefined, "index_key");
      return rows.map((r) => ({ key: r.index_key, family: r.family, ccy: r.ccy, currencyCode: r.currency_code, scopeKey: r.scope_key, name: r.name, level: r.level,
        scopeType: r.scope_type, scopeValue: r.scope_value, sector: r.sector, cap: r.cap, country: r.country, region: r.region, classification: r.classification,
        startDate: r.start_date, lastDate: r.last_date, lastLevel: r.last_level, nLast: r.n_last, capEstimated: r.cap_estimated }));
    },
    async indexSeries(key) {
      const rows = await one(sb.from("tas_index_values").select("year,dates,level,n,n_stale,cap_usd").eq("index_key", key).order("year"));
      if (!rows.length) return null;
      const out = { key, dates: [], level: [], n: [], nStale: [], cap: rows[0].cap_usd ? [] : null };
      for (const r of rows) { out.dates.push(...r.dates); out.level.push(...r.level); out.n.push(...r.n); out.nStale.push(...r.n_stale); if (out.cap) out.cap.push(...(r.cap_usd || [])); }
      return out;
    },
    async bars(id) {
      const rows = await all("price_history", "date,open,high,low,close,volume", (q) => q.eq("instrument_id", id).not("close", "is", null), "date");
      const b = { time: [], open: [], high: [], low: [], close: [], volume: [] };
      for (const r of rows) {
        const c = +r.close; if (!(c > 0)) continue;
        b.time.push(r.date); b.close.push(c); b.open.push(r.open != null ? +r.open : c); b.high.push(r.high != null ? +r.high : c); b.low.push(r.low != null ? +r.low : c); b.volume.push(r.volume != null ? +r.volume : 0);
      }
      const ca = await one(sb.from("tas_corporate_action").select("ex_date,factor,type,source").eq("instrument_id", id));
      const acts = ca.map((x) => ({ exDate: x.ex_date, factor: +x.factor, type: x.type, source: x.source }));
      const adj = acts.length ? applyCorporateActions(b, acts).bars : b;
      const sec = (await secMap()).get(id);
      return { ...adj, currency: sec?.currency, adjustments: acts };
    },
    async fxSummary() {
      const rows = await one(sb.from("tas_fx").select("currency,source,estimated,stale_days,max_stale,estimated_days,latest,latest_date"));
      return rows.map((r) => ({ currency: r.currency, source: r.source, estimated: r.estimated, staleDays: r.stale_days, maxStale: r.max_stale, estimatedDays: r.estimated_days, latest: r.latest, latestDate: r.latest_date }));
    },
    async fxSeries(ccy) { const r = await one(sb.from("tas_fx").select("dates,rate,stale").eq("currency", ccy).maybeSingle()); return r; },
    async wwGroups() { return (await all("tas_ww", "parent_key,parent_type,child_type")).map((r) => ({ parentKey: r.parent_key, parentType: r.parent_type, childType: r.child_type })); },
    async ww(parentKey, childType) {
      const r = await one(sb.from("tas_ww").select("*").eq("parent_key", parentKey).eq("child_type", childType).maybeSingle());
      return r ? { parentKey: r.parent_key, parentType: r.parent_type, childType: r.child_type, dates: r.dates, latestFlags: r.latest_flags, children: r.children } : null;
    },
    async membership(country, date) {
      let q = sb.from("tas_membership").select("*").eq("country", country).eq("is_latest", false).order("rebalance_date", { ascending: false }).limit(1);
      if (date) q = q.lte("rebalance_date", date);
      const r = (await one(q))[0];
      return r ? { country: r.country, date: r.rebalance_date, latest: r.is_latest, members: r.members } : null;
    },
    async membershipDates(country) { return (await one(sb.from("tas_membership").select("rebalance_date").eq("country", country).eq("is_latest", false).order("rebalance_date"))).map((r) => r.rebalance_date); },
    async breadthKeys() { return (await all("tas_breadth", "scope_key,light")).map((r) => ({ key: r.scope_key, light: r.light })); },
    async breadth(key) { const r = await one(sb.from("tas_breadth").select("data").eq("scope_key", key).maybeSingle()); return r?.data || null; },
    async rotationScopes() { return (await all("tas_rotation", "scope_key")).map((r) => r.scope_key); },
    async etiRows() { return all("tas_eti_characteristic", "company_id,characteristic,framework,isin,nse_symbol,bse_code,company_name,instrument_id,as_of,meets,value,note,method_version,synced_at", undefined, "company_id"); },
    async etiFor(instrumentId) { return one(sb.from("tas_eti_characteristic").select("company_id,characteristic,company_name,nse_symbol,isin,instrument_id,as_of,meets,value,note,method_version").eq("instrument_id", instrumentId)); },
    async etiChanges(limit = 300) { return one(sb.from("tas_eti_change").select("id,company_id,instrument_id,characteristic,from_meets,to_meets,as_of,at").order("at", { ascending: false }).limit(limit)); },
    async glocomScopes() { return (await all("tas_glocom_group", "scope_key")).map((r) => r.scope_key); },
    async glocomGroups(key) { const r = await one(sb.from("tas_glocom_group").select("data").eq("scope_key", key).maybeSingle()); return r?.data || null; },
    async rotation(key) { const r = await one(sb.from("tas_rotation").select("sectors").eq("scope_key", key).maybeSingle()); return r?.sectors || null; },
    async regimes() { const rows = await all("tas_regime", "index_key,data"); return Object.fromEntries(rows.map((r) => [r.index_key, r.data])); },
    async ewcw() {
      return (await all("tas_ewcw", "*")).map((r) => ({ pairKey: r.pair_key, scopeKey: r.scope_key, ccy: r.ccy, name: r.name, level: r.level, asOf: r.as_of, ratio: r.ratio, chg: r.chg, aboveTrend: r.above_trend, label: r.label }));
    },
    async events(id) { const r = await one(sb.from("tas_events").select("events").eq("id", id).maybeSingle()); return decodeEvents(r?.events); },
    async eventsMany(ids) {
      const o = {};
      for (let i = 0; i < ids.length; i += 100) {
        const rows = await one(sb.from("tas_events").select("id,events").in("id", ids.slice(i, i + 100)));
        for (const r of rows) o[r.id] = decodeEvents(r.events);
      }
      return o;
    },
    async backtestSummary() {
      return (await all("tas_backtest", "*")).map((r) => ({ type: r.type, scope: r.scope, horizon: r.horizon, n: r.n, mean: r.mean, median: r.median, hitRate: r.hit_rate, excessMean: r.excess_mean, excessHitRate: r.excess_hit_rate, mfe: r.mfe, mae: r.mae }));
    },
    async issues() {
      const info = await api.info();
      return (await all("tas_data_issue", "*", (q) => q.eq("run_id", info.run.runId), "id")).map((r) => ({ id: r.instrument_id, symbol: r.symbol, country: r.country, severity: r.severity, rule: r.rule, detail: r.detail }));
    },
    async revisions(key) {
      let q = sb.from("tas_index_revision").select("*").order("revised_at", { ascending: false }).limit(500);
      if (key) q = q.eq("index_key", key);
      return (await one(q)).map((r) => ({ indexKey: r.index_key, date: r.date, oldLevel: r.old_level, newLevel: r.new_level, runId: r.run_id, revisedAt: r.revised_at }));
    },
    async corporateActions() { return (await all("tas_corporate_action", "*")).map((r) => ({ instrumentId: r.instrument_id, exDate: r.ex_date, factor: +r.factor, type: r.type, source: r.source })); },
  };
  return api;
}
