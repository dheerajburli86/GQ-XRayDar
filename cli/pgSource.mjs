// Pipeline Source over the heatmap dashboard's Supabase Postgres (READ ONLY).
//
// Tables read: instruments, price_history, fundamentals, glocom_latest, fx_rates
// (heatmap-owned) and tas_fx_history, tas_corporate_action (this app's own).
// Nothing in this file writes.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addDays } from "../engine/calendar.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export const STOCK_UNIVERSES = ["us_stocks", "global", "india_stocks"];
// Analysed (charts, screens, alerts) but never part of index construction or breadth.
export const FUND_UNIVERSES = ["us_etfs", "india_etfs", "global_etfs", "us_indices", "india_indices", "global_indices", "commodities", "crypto_etfs"];
// Inactive rows are kept (delisted companies matter for survivorship-free
// history) EXCEPT in India, where is_active=false is also how the heatmap mutes
// ETFs, bonds and fund codes that sit in the stock universe.
export const INCLUDE_INACTIVE = new Set(["us_stocks", "global"]);

export function pgSource(pool, { warmupDays = 400, minCalendarCount = 50, log = console.log } = {}) {
  const intern = new Map();
  const iv = (s) => { let x = intern.get(s); if (x === undefined) { x = s; intern.set(s, x); } return x; };
  let startDate = null;

  return {
    mode: "supabase",
    async calendar(start) {
      startDate = start;
      const { rows } = await pool.query(
        `select date::text d, count(*)::int n from price_history where date >= $1 group by date having count(*) >= $2 order by date`,
        [start, minCalendarCount]);
      log(`calendar: ${rows.length} sessions from ${rows[0]?.d} to ${rows.at(-1)?.d}`);
      return rows.map((r) => iv(r.d));
    },
    async securities() {
      const { rows } = await pool.query(
        `select id::text, symbol, name, universe, type, sector, industry, country, region, currency, exchange, isin,
                is_active, market_cap_local, market_cap_currency, market_cap_usd, market_cap_inr, etf_category
           from instruments where universe = any($1)`, [[...STOCK_UNIVERSES, ...FUND_UNIVERSES]]);
      // Funds and indices: active only (an inactive ETF row is a muted or closed product).
      const kept = rows.filter((r) => r.is_active !== false || (INCLUDE_INACTIVE.has(r.universe)));
      log(`securities: ${kept.length} rows (${rows.length - kept.length} inactive India rows skipped)`);
      return kept;
    },
    async indiaMap() {
      return JSON.parse(fs.readFileSync(path.join(here, "../engine/reference/india_industry_map.json"), "utf8"));
    },
    /** Bars for many instruments, read in chunks, returned as column arrays. */
    async countryBars(ids) {
      const out = new Map();
      const from = addDays(startDate, -warmupDays);
      for (let i = 0; i < ids.length; i += 150) {
        const chunk = ids.slice(i, i + 150);
        const { rows } = await pool.query({
          text: `select instrument_id::text, date::text, open, high, low, close, volume from price_history
                  where instrument_id = any($1::uuid[]) and date >= $2 and close is not null and close > 0
                  order by instrument_id, date`,
          values: [chunk, from], rowMode: "array",
        });
        let cur = null, curId = null;
        const flush = () => { if (cur) out.set(curId, finish(cur)); };
        for (const r of rows) {
          if (r[0] !== curId) { flush(); curId = r[0]; cur = { time: [], open: [], high: [], low: [], close: [], volume: [] }; }
          const c = +r[5];
          cur.time.push(iv(r[1])); cur.close.push(c);
          cur.open.push(r[2] != null ? +r[2] : c); cur.high.push(r[3] != null ? +r[3] : c); cur.low.push(r[4] != null ? +r[4] : c);
          cur.volume.push(r[6] != null ? +r[6] : 0);
        }
        flush();
      }
      return out;
    },
    async fxHistory() {
      const latest = {};
      const fr = await pool.query(`select currency, usd_per_unit::float8 v from fx_rates where usd_per_unit > 0`);
      for (const r of fr.rows) latest[String(r.currency).toUpperCase()] = r.v;
      const history = {};
      let hasTable = true;
      try {
        const { rows } = await pool.query(`select currency, date::text d, usd_per_unit v, source from tas_fx_history order by currency, date`);
        for (const r of rows) {
          const h = (history[r.currency] ||= { dates: [], usd: [], source: r.source });
          h.dates.push(r.d); h.usd.push(+r.v);
        }
      } catch (e) { hasTable = false; log(`tas_fx_history not readable (${e.message}); USD series will use constant latest rates (ESTIMATED)`); }
      log(`fx: ${Object.keys(history).length} currencies with history${hasTable ? "" : " (table missing)"}, ${Object.keys(latest).length} latest rates`);
      return { history, latest };
    },
    async fundamentals(ids) {
      const out = new Map();
      for (let i = 0; i < ids.length; i += 200) {
        const { rows } = await pool.query(
          `select instrument_id::text id, income_statement, income_statement_q, balance_sheet, balance_sheet_q, cash_flow, cash_flow_q, reported_currency
             from fundamentals where instrument_id = any($1::uuid[])`, [ids.slice(i, i + 200)]);
        for (const r of rows) out.set(r.id, r);
      }
      return out;
    },
    /** Reported share counts (weighted average, annual and quarterly) per instrument: id -> [{date, shares}]. */
    async shareCounts() {
      const m = new Map();
      try {
        const { rows } = await pool.query(`
          select instrument_id::text id, x->>'date' d, (x->>'weightedAverageShsOut')::float8 sh
            from fundamentals f,
                 lateral jsonb_array_elements(coalesce(case when jsonb_typeof(f.income_statement) = 'array' then f.income_statement end, '[]'::jsonb)
                   || coalesce(case when jsonb_typeof(f.income_statement_q) = 'array' then f.income_statement_q end, '[]'::jsonb)) x
           where (x->>'weightedAverageShsOut') ~ '^[0-9.eE+]+$'`);
        for (const r of rows) { if (!(r.sh > 0) || !r.d) continue; if (!m.has(r.id)) m.set(r.id, []); m.get(r.id).push({ date: r.d, shares: r.sh }); }
      } catch (e) { log(`share counts not readable: ${e.message}`); }
      return m;
    },
    async corporateActions() {
      const m = new Map();
      try {
        const { rows } = await pool.query(`select instrument_id, ex_date::text ex, factor, type, source from tas_corporate_action`);
        for (const r of rows) { if (!m.has(r.instrument_id)) m.set(r.instrument_id, []); m.get(r.instrument_id).push({ exDate: r.ex, factor: +r.factor, type: r.type, source: r.source }); }
      } catch { /* table not created yet: no adjustments */ }
      return m;
    },
    async eti() {
      const m = new Map();
      try {
        const { rows } = await pool.query(`select instrument_id::text id, characteristic, meets from tas_eti_characteristic where instrument_id is not null`);
        for (const r of rows) { if (!m.has(r.id)) m.set(r.id, {}); m.get(r.id)[r.characteristic] = r.meets === true ? "yes" : r.meets === false ? "no" : "unknown"; }
      } catch (e) { log(`tas_eti_characteristic not readable: ${e.message}`); }
      return m;
    },
    async glocom() {
      const m = new Map();
      try {
        const { rows } = await pool.query(`select instrument_id::text id, glocom_code, glocom_label, sort_score, pctile_1m, pctile_3m, pctile_6m, pctile_1y, as_of from glocom_latest`);
        for (const r of rows) m.set(r.id, { code: r.glocom_code, label: r.glocom_label, sortScore: r.sort_score != null ? +r.sort_score : null, pctile: { "1M": num(r.pctile_1m), "3M": num(r.pctile_3m), "6M": num(r.pctile_6m), "1Y": num(r.pctile_1y) }, asOf: r.as_of });
      } catch (e) { log(`glocom_latest not readable: ${e.message}`); }
      return m;
    },
  };
}

const num = (v) => (v == null ? null : +v);
function finish(c) {
  return { time: c.time, open: Float64Array.from(c.open), high: Float64Array.from(c.high), low: Float64Array.from(c.low), close: Float64Array.from(c.close), volume: Float64Array.from(c.volume) };
}
