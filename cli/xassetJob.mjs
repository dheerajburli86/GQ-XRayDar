// Builds tas_xasset: one USD series per cross-asset benchmark (engine/crossAsset.js).
// Reads the heatmap's price_history and this app's tas_index_values; fetches the
// fixed-income funds the heatmap does not carry from FMP into tas_xasset_bars
// (incremental). Writes only tas_xasset and tas_xasset_bars.
import { XASSETS } from "../engine/crossAsset.js";

const YEARS = 6;

export async function runXasset(pool, { fmpKey = process.env.FMP_API_KEY, log = console.log, fetchImpl = fetch } = {}) {
  const from = new Date(Date.now() - YEARS * 365.25 * 86400000).toISOString().slice(0, 10);
  const out = [];
  for (const a of XASSETS) {
    try {
      let dates = [], close = [], source = "", currency = "USD";
      if (a.index) {
        const { rows } = await pool.query(`select dates::text[] d, level from tas_index_values where index_key = $1 and year >= $2 order by year`, [a.index, +from.slice(0, 4)]);
        for (const r of rows) for (let i = 0; i < r.d.length; i++) if (r.d[i] >= from && r.level[i] > 0) { dates.push(r.d[i]); close.push(+r.level[i]); }
        source = `house index ${a.index}`;
      } else if (a.symbol) {
        const { rows: ins } = await pool.query(`select id::text, currency from instruments where symbol = $1 and universe = $2 order by is_active desc nulls last limit 1`, [a.symbol, a.universe]);
        if (!ins.length) { log(`[xasset] ${a.key}: ${a.symbol} not in ${a.universe}`); continue; }
        const { rows } = await pool.query(`select date::text d, close from price_history where instrument_id = $1 and date >= $2 and close > 0 order by date`, [ins[0].id, from]);
        dates = rows.map((r) => r.d); close = rows.map((r) => +r.close); currency = ins[0].currency || "USD";
        source = `heatmap price_history (${a.universe})`;
      } else if (a.fmp) {
        if (fmpKey) await refreshFmp(pool, a.fmp, from, fmpKey, fetchImpl, log);
        const { rows } = await pool.query(`select date::text d, close from tas_xasset_bars where symbol = $1 and date >= $2 order by date`, [a.fmp, from]);
        dates = rows.map((r) => r.d); close = rows.map((r) => +r.close);
        source = "FMP end-of-day (not carried by the heatmap)";
      }
      if (dates.length < 20) { log(`[xasset] ${a.key}: only ${dates.length} bars, skipped`); continue; }
      out.push({ key: a.key, label: a.label, asset_class: a.cls, source, currency, dates, close });
    } catch (e) { log(`[xasset] ${a.key}: ${e.message}`); }
  }
  for (const r of out) {
    await pool.query(`insert into tas_xasset (key, label, asset_class, source, currency, dates, close, updated_at) values ($1,$2,$3,$4,$5,$6::date[],$7,now())
      on conflict (key) do update set label = excluded.label, asset_class = excluded.asset_class, source = excluded.source, currency = excluded.currency, dates = excluded.dates, close = excluded.close, updated_at = now()`,
      [r.key, r.label, r.asset_class, r.source, r.currency, r.dates, r.close]);
  }
  log(`[xasset] wrote ${out.length} of ${XASSETS.length} cross-asset series`);
  return { written: out.length, total: XASSETS.length };
}

async function refreshFmp(pool, symbol, from, key, fetchImpl, log) {
  const { rows } = await pool.query(`select max(date)::text d from tas_xasset_bars where symbol = $1`, [symbol]);
  const start = rows[0]?.d || from;
  const r = await fetchImpl(`https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=${symbol}&from=${start}&apikey=${key}`);
  if (!r.ok) { log(`[xasset] FMP ${symbol}: HTTP ${r.status}`); return; }
  const j = await r.json();
  const data = (Array.isArray(j) ? j : j?.historical || []).map((x) => ({ symbol, date: String(x.date).slice(0, 10), close: +(x.adjClose ?? x.close) })).filter((x) => x.close > 0);
  if (!data.length) return;
  await pool.query(`insert into tas_xasset_bars (symbol, date, close) select symbol, date, close from json_populate_recordset(null::tas_xasset_bars, $1::json)
    on conflict (symbol, date) do update set close = excluded.close`, [JSON.stringify(data)]);
}
