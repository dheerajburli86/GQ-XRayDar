// Read side over the tas_* tables (computed by the engine) and the heatmap's
// price_history. Everything is cached per calculation run: a new successful run
// is picked up within REFRESH_MS and the caches start over.
import { decodeFlat, SCREEN_KEYS } from "../../engine/screenRow.js";
import { decodeEvents } from "../../engine/eventCodec.js";
import { applyCorporateActions, removeBadPrints } from "../../engine/quality.js";

const REFRESH_MS = 5 * 60_000;

export function createData(pool, log = console.log) {
  let state = null, checkedAt = 0, loading = null;
  const lru = new Map();
  const remember = (k, v) => { lru.set(k, v); if (lru.size > 3000) lru.delete(lru.keys().next().value); return v; };

  async function latestRun() {
    const { rows } = await pool.query(`select run_id, started, finished, stats, methodology, methodology_version, methodology_hash from tas_calc_run where status = 'ok' order by started desc limit 1`);
    return rows[0] || null;
  }

  async function load() {
    const run = await latestRun();
    if (!run) throw Object.assign(new Error("No successful calculation run yet: run the engine first (npm run engine)."), { status: 503 });
    if (state && state.run.run_id === run.run_id) return state;
    const t0 = Date.now();
    const [secs, snaps, regimes] = await Promise.all([
      pool.query(`select * from tas_security`), pool.query(`select id, flat, rs_rank from tas_snapshot`), pool.query(`select index_key, data from tas_regime`),
    ]);
    const keys = run.stats?.screenKeys || SCREEN_KEYS;
    const sec = secs.rows.filter((r) => r.asset_class !== "Crypto").map((r) => ({
      id: r.id, symbol: r.symbol, name: r.name, universe: r.universe, exchange: r.exchange, country: r.country, region: r.region, classification: r.classification,
      currency: r.currency, currencyMajor: r.currency_major, currencyDivisor: r.currency_divisor, countryCurrency: r.country_currency, sector: r.sector,
      industryGroup: r.industry_group, industry: r.industry, subIndustry: r.sub_industry ?? null, capSegment: r.cap_segment, capUsdNow: r.cap_usd_now, turnoverUsd: r.turnover_usd ?? null, active: r.active,
      assetClass: r.asset_class || "Stock",
    }));
    const secById = new Map(sec.map((x) => [x.id, x]));
    const rows = [];
    for (const s of snaps.rows) { const x = secById.get(s.id); if (x && s.flat) rows.push({ id: s.id, sec: x, flat: decodeFlat(s.flat, keys), rsRank: s.rs_rank }); }
    lru.clear();
    state = {
      run, secs: sec, secById, rows, rowById: new Map(rows.map((r) => [r.id, r])),
      regimes: Object.fromEntries(regimes.rows.map((r) => [r.index_key, r.data])),
      countries: [...new Set(sec.map((x) => x.country).filter(Boolean))].sort(),
      regions: [...new Set(sec.map((x) => x.region).filter(Boolean))].sort(),
      sectors: [...new Set(sec.map((x) => x.sector).filter(Boolean))].sort(),
      info: { asOf: run.stats?.dates?.to, methodology: run.methodology, runId: run.run_id },
    };
    log(`[data] loaded run ${run.run_id}: ${sec.length} securities, ${rows.length} screen rows in ${Date.now() - t0} ms`);
    return state;
  }

  async function get() {
    if (state && Date.now() - checkedAt < REFRESH_MS) return state;
    // a refresh that fails (database blip) keeps serving the last good run instead of failing every request
    if (!loading) loading = load().catch((e) => { if (state) { log(`[data] refresh failed, serving run ${state.run.run_id}: ${e.message}`); return state; } throw e; })
      .finally(() => { loading = null; checkedAt = state ? Date.now() : 0; });
    return loading;
  }

  const api = {
    async snapshot(id) {
      const k = `snap:${id}`; if (lru.has(k)) return lru.get(k);
      const { rows } = await pool.query(`select id, snap, f, ww, glocom, rs_rank, score from tas_snapshot where id = $1`, [id]);
      const r = rows[0];
      return remember(k, r ? { id: r.id, snap: r.snap, f: r.f, ww: r.ww, glocom: r.glocom, rsRank: r.rs_rank, score: r.score } : null);
    },
    async events(id) { const { rows } = await pool.query(`select events from tas_events where id = $1`, [id]); return decodeEvents(rows[0]?.events); },
    async eventsMany(ids) { const { rows } = await pool.query(`select id, events from tas_events where id = any($1)`, [ids]); return Object.fromEntries(rows.map((r) => [r.id, decodeEvents(r.events)])); },
    async etiRows() { const { rows } = await pool.query(`select company_id, characteristic, framework, isin, nse_symbol, bse_code, company_name, instrument_id::text, as_of::text, meets, value, note, method_version, synced_at from tas_eti_characteristic`).catch(() => ({ rows: [] })); return rows; },
    async etiFor(id) { const { rows } = await pool.query(`select company_id, characteristic, company_name, nse_symbol, isin, instrument_id::text, as_of::text, meets, value, note, method_version from tas_eti_characteristic where instrument_id = $1`, [id]).catch(() => ({ rows: [] })); return rows; },
    async etiChanges(limit = 300) { const { rows } = await pool.query(`select id, company_id, instrument_id::text, characteristic, from_meets, to_meets, as_of::text, at from tas_eti_change order by at desc limit $1`, [limit]).catch(() => ({ rows: [] })); return rows; },
    async glocomScopes() { const { rows } = await pool.query(`select scope_key from tas_glocom_group`).catch(() => ({ rows: [] })); return rows.map((r) => r.scope_key); },
    async glocomGroups(scope) { const { rows } = await pool.query(`select data from tas_glocom_group where scope_key = $1`, [scope]).catch(() => ({ rows: [] })); return rows[0]?.data || null; },
    async rotation(scope) { const { rows } = await pool.query(`select sectors from tas_rotation where scope_key = $1`, [scope]); return rows[0]?.sectors || null; },
    async breadth(scope) { const { rows } = await pool.query(`select data from tas_breadth where scope_key = $1`, [scope]); return rows[0]?.data || null; },
    async ewcw() { const { rows } = await pool.query(`select * from tas_ewcw`); return rows.map((r) => ({ pairKey: r.pair_key, scopeKey: r.scope_key, ccy: r.ccy, name: r.name, level: r.level, asOf: r.as_of, ratio: r.ratio, chg: r.chg, aboveTrend: r.above_trend, label: r.label })); },
    async backtestSummary() { const { rows } = await pool.query(`select * from tas_backtest`); return rows.map((r) => ({ type: r.type, scope: r.scope, horizon: r.horizon, n: r.n, mean: r.mean, median: r.median, hitRate: r.hit_rate, excessMean: r.excess_mean, excessHitRate: r.excess_hit_rate, mfe: r.mfe, mae: r.mae })); },
    async indexSeries(key) {
      const k = `idx:${key}`; if (lru.has(k)) return lru.get(k);
      const { rows } = await pool.query(`select dates::text[] d, level, n, n_stale from tas_index_values where index_key = $1 order by year`, [key]);
      if (!rows.length) return remember(k, null);
      const out = { key, dates: [], level: [], n: [], nStale: [] };
      for (const r of rows) { out.dates.push(...r.d); out.level.push(...r.level); out.n.push(...r.n); out.nStale.push(...r.n_stale); }
      return remember(k, out);
    },
    async bars(id) {
      const k = `bars:${id}`; if (lru.has(k)) return lru.get(k);
      const m = await api.barsMany([id]);
      return remember(k, m.get(id) || null);
    },
    /** Daily bars for many instruments (split-adjusted). */
    async barsMany(ids, fromDate = "1990-01-01") {
      const out = new Map();
      if (!ids.length) return out;
      for (let i = 0; i < ids.length; i += 200) {
        const { rows } = await pool.query({
          text: `select instrument_id::text, date::text, open, high, low, close, volume from price_history
                  where instrument_id = any($1::uuid[]) and date >= $2 and close > 0 order by instrument_id, date`,
          values: [ids.slice(i, i + 200), fromDate], rowMode: "array",
        });
        let cur = null, curId = null;
        for (const r of rows) {
          if (r[0] !== curId) { if (cur) out.set(curId, cur); curId = r[0]; cur = { time: [], open: [], high: [], low: [], close: [], volume: [] }; }
          const c = +r[5];
          cur.time.push(r[1]); cur.close.push(c); cur.open.push(r[2] != null ? +r[2] : c); cur.high.push(r[3] != null ? +r[3] : c); cur.low.push(r[4] != null ? +r[4] : c); cur.volume.push(r[6] != null ? +r[6] : 0);
        }
        if (cur) out.set(curId, cur);
      }
      const { rows: ca } = await pool.query(`select instrument_id, ex_date::text ex, factor from tas_corporate_action where instrument_id = any($1)`, [ids]).catch(() => ({ rows: [] }));
      const acts = new Map();
      for (const r of ca) { if (!acts.has(r.instrument_id)) acts.set(r.instrument_id, []); acts.get(r.instrument_id).push({ exDate: r.ex, factor: +r.factor }); }
      for (const [id, a] of acts) if (out.has(id)) out.set(id, applyCorporateActions(out.get(id), a).bars);
      for (const [id, b] of out) { const r = removeBadPrints(b); if (r.removed.length) out.set(id, { ...r.bars, badPrints: r.removed }); }
      return out;
    },
  };

  /** The data facade the engine assistant / task runner expect. */
  async function facade() {
    const s = await get();
    return { ...s, api };
  }

  /** Symbol, ISIN-less name or id -> candidates (exact symbol first). */
  async function resolve(q, limit = 8) {
    const s = await get();
    const t = String(q || "").trim();
    if (!t) return [];
    if (s.secById.has(t)) return [s.secById.get(t)];
    const up = t.toUpperCase();
    const bare = up.replace(/^(NSE|BSE|NYSE|NASDAQ|TSE|LSE)[:\s]+/, "").replace(/\.(NS|BO)$/, "");
    const exact = s.secs.filter((x) => x.symbol.toUpperCase() === bare || x.symbol.toUpperCase().replace(/\.(NS|BO)$/, "") === bare);
    if (exact.length) return exact.sort((a, b) => (b.capUsdNow || 0) - (a.capUsdNow || 0)).slice(0, limit);
    const low = t.toLowerCase();
    return s.secs.filter((x) => (x.name || "").toLowerCase().includes(low)).sort((a, b) => (b.capUsdNow || 0) - (a.capUsdNow || 0)).slice(0, limit);
  }

  return { get, facade, resolve, api, peek: () => state };
}
