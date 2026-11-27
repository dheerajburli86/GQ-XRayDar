// Builds the workbook index sets (engine/indexSets.js) into tas_extra_series (the chart series, symbol GQSET:<code>) and
// tas_index_set (what each set holds and what is missing). Run by runExtra after the USD index copies exist.
// Reads: tas_extra_series, price_history + instruments (ETFs), tas_index_series (house indices). Writes only tas_* tables.
import { buildIndexSets } from "../engine/indexSets.js";

export const METHOD = "Equal-weighted, daily-rebalanced composite of the members' daily returns (USD), base 100. A member joins on the day it has a return; the set starts when half its resolvable members do. Price returns only. Missing members are listed on the Index sets page, never filled in.";

export async function runIndexSets(pool, { log = console.log } = {}) {
  const num = (a) => (a || []).map(Number);
  const load = async (c) => {
    try {
      if (c.via === "x") {
        const { rows } = await pool.query(`select dates::text[] d, close c from tas_extra_series where symbol = $1`, [c.sym]);
        return rows[0] ? { dates: rows[0].d, close: num(rows[0].c), symbol: c.sym } : null;
      }
      if (c.via === "etf") {
        const { rows } = await pool.query(`select array_agg(p.date::text order by p.date) d, array_agg(p.close order by p.date) c from price_history p
          join instruments i on i.id = p.instrument_id where i.symbol = $1 and i.is_active and p.close > 0
          and i.universe in ('us_etfs','currency_etf','commodities') group by i.id order by count(*) desc limit 1`, [c.sym]);
        return rows[0] ? { dates: rows[0].d, close: num(rows[0].c), symbol: `etf:${c.sym}` } : null;
      }
      if (c.via === "house") {
        const { rows } = await pool.query(`select date::text d, level from tas_index_series($1)`, [c.sym]);
        return rows.length ? { dates: rows.map((r) => r.d), close: rows.map((r) => +r.level), symbol: `house:${c.sym}` } : null;
      }
    } catch (e) { log(`[sets] ${c.via}:${c.sym}: ${e.message}`); }
    return null;
  };
  const built = await buildIndexSets(load);
  let n = 0;
  for (const b of built) {
    const { def, series, members } = b;
    const resolved = members.filter((m) => m.status === "ok" || m.status === "proxy").length;
    const note = members.some((m) => m.status === "proxy") ? " Some members are stand-ins (shown as proxy)." : "";
    const meta = `${def.members.length} workbook members, ${resolved} resolved.`;
    await pool.query(`insert into tas_index_set (symbol, code, sheet, label, members, n_members, n_resolved, start_date, last_date, method, updated_at)
      values ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,now())
      on conflict (symbol) do update set code = excluded.code, sheet = excluded.sheet, label = excluded.label, members = excluded.members,
        n_members = excluded.n_members, n_resolved = excluded.n_resolved, start_date = excluded.start_date, last_date = excluded.last_date, method = excluded.method, updated_at = now()`,
    [def.symbol, def.code, def.sheet, def.label, JSON.stringify(members), def.members.length, resolved, series?.dates[0] || null, series?.dates.at(-1) || null, METHOD]);
    if (!series) { log(`[sets] ${def.code}: no data`); continue; }
    await pool.query(`insert into tas_extra_series (symbol, label, category, region, country, currency, source, dates, close, updated_at)
      values ($1,$2,'Index','Global',null,'USD',$3,$4::date[],$5,now())
      on conflict (symbol) do update set label = excluded.label, category = excluded.category, region = excluded.region, country = excluded.country,
        currency = excluded.currency, source = excluded.source, dates = excluded.dates, close = excluded.close, updated_at = now()`,
    [def.symbol, def.label, `GQ index set from the workbook "${def.sheet === "etf" ? "US ETF Indices" : "Exchange Major Indices"}": ${meta}${note} Equal-weighted, USD`, series.dates, series.close]);
    n++;
  }
  log(`[sets] wrote ${n} index sets`);
  return n;
}
