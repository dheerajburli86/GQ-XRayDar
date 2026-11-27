// Builds tas_extra_series: chart-only instruments the heatmap does not carry
// (engine/reference/extraInstruments.js). FMP indices / yields / commodity futures are fetched
// incrementally into tas_xasset_bars (full history on first sight); currency pairs are built
// from tas_fx. Writes only tas_extra_series and tas_xasset_bars.
import { runIndexSets } from "./indexSetsJob.mjs";
import { EXTRA_FMP, currencyPairs, crossRate, COUNTRY_CURRENCY } from "../engine/reference/extraInstruments.js";

export async function runExtra(pool, { fmpKey = process.env.FMP_API_KEY, log = console.log, fetchImpl = fetch } = {}) {
  let written = 0, missing = [];
  if (fmpKey) {
    for (const a of EXTRA_FMP) {
      try {
        await refresh(pool, a.symbol, fmpKey, fetchImpl);
        const { rows } = await pool.query(`select date::text d, close from tas_xasset_bars where symbol = $1 and close > 0 order by date`, [a.symbol]);
        if (rows.length < 20) { missing.push(a.symbol); continue; }
        await upsert(pool, { ...a, currency: a.category === "Rate" ? "%" : a.category === "Index" ? COUNTRY_CURRENCY[a.country] || "USD" : "USD", source: "FMP end-of-day", dates: rows.map((r) => r.d), close: rows.map((r) => +r.close) });
        written++;
      } catch (e) { log(`[extra] ${a.symbol}: ${e.message}`); missing.push(a.symbol); }
    }
  } else log("[extra] FMP_API_KEY not set: indices / yields / commodities skipped");
  // currency pairs from the FX table (only real fixings: carried-forward days are left out)
  const { rows: fx } = await pool.query(`select currency, dates::text[] d, rate, stale from tas_fx where currency <> 'USD'`).catch(() => ({ rows: [] }));
  const byCcy = new Map(fx.map((r) => [r.currency, r]));
  const at = (r) => { const m = new Map(); for (let i = 0; i < r.d.length; i++) if (!(r.stale?.[i]) && r.rate[i] > 0) m.set(r.d[i], +r.rate[i]); return m; };
  const cache = new Map();
  const series = (c) => { if (c === "USD") return null; if (!cache.has(c)) cache.set(c, byCcy.has(c) ? at(byCcy.get(c)) : new Map()); return cache.get(c); };
  for (const p of currencyPairs([...byCcy.keys(), "USD"])) {
    const b = series(p.base), q = series(p.quote);
    const dates = [...(b || q).keys()].filter((d) => (!b || b.has(d)) && (!q || q.has(d))).sort();
    const close = dates.map((d) => crossRate(b ? b.get(d) : 1, q ? q.get(d) : 1, p.per));
    if (dates.length < 20) continue;
    await upsert(pool, { ...p, source: "FX fixings (tas_fx, from FMP)", dates, close });
    written++;
  }
  written += await runUsd(pool, { byCcy, log });
  try { written += await runIndexSets(pool, { log }); } catch (e) { log(`[extra] index sets skipped: ${e.message}`); }
  log(`[extra] wrote ${written} chart series${missing.length ? `; FMP had no data for ${missing.join(", ")}` : ""}`);
  return { written, missing };
}

async function upsert(pool, r) {
  await pool.query(`insert into tas_extra_series (symbol, label, category, region, country, currency, source, dates, close, updated_at)
    values ($1,$2,$3,$4,$5,$6,$7,$8::date[],$9,now())
    on conflict (symbol) do update set label = excluded.label, category = excluded.category, region = excluded.region, country = excluded.country,
      currency = excluded.currency, source = excluded.source, dates = excluded.dates, close = excluded.close, updated_at = now()`,
  [r.symbol, r.label, r.category, r.region || null, r.country || null, r.currency || null, r.source, r.dates, r.close]);
}

// FMP answers at most ~5000 daily bars per request (about 20 years), so a first fetch walks back in windows
// (to = day before the oldest bar received) until FMP returns fewer than a full page: full history, not the last 20 years.
const PAGE = 4900;
async function fetchWindow(symbol, key, fetchImpl, from, to) {
  const r = await fetchImpl(`https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=${encodeURIComponent(symbol)}&from=${from}${to ? `&to=${to}` : ""}&apikey=${key}`, { signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`FMP HTTP ${r.status}`);
  const j = await r.json();
  return (Array.isArray(j) ? j : j?.historical || []).map((x) => ({ symbol, date: String(x.date).slice(0, 10), close: +(x.adjClose ?? x.close) })).filter((x) => x.close > 0 && /^\d{4}-\d\d-\d\d$/.test(x.date));
}
async function save(pool, data) {
  for (let i = 0; i < data.length; i += 4000) {
    await pool.query(`insert into tas_xasset_bars (symbol, date, close) select symbol, date, close from json_populate_recordset(null::tas_xasset_bars, $1::json)
      on conflict (symbol, date) do update set close = excluded.close`, [JSON.stringify(data.slice(i, i + 4000))]);
  }
}
export async function refresh(pool, symbol, key, fetchImpl) {
  const { rows } = await pool.query(`select max(date)::text d, min(date)::text m from tas_xasset_bars where symbol = $1`, [symbol]);
  const start = rows[0]?.d || "1990-01-01";
  let data = await fetchWindow(symbol, key, fetchImpl, start, null);
  await save(pool, data);
  // a full page means older bars may exist: keep walking back (at most 6 windows, ~100 years)
  for (let n = 0; n < 6 && data.length >= PAGE; n++) {
    const oldest = data.map((x) => x.date).sort()[0];
    const to = new Date(Date.parse(oldest + "T00:00:00Z") - 86_400_000).toISOString().slice(0, 10);
    if (to < start) break;
    data = await fetchWindow(symbol, key, fetchImpl, start, to);
    await save(pool, data);
  }
}

const CARRY_DAYS = 5;
/** USD version of an index level: close x USD-per-unit on the same day; a day without a fixing carries the last one (at most CARRY_DAYS back). */
export function toUsd(dates, close, fx) {
  const d = [], c = [];
  let last = null, lastAt = null;
  for (let i = 0; i < dates.length; i++) {
    const r = fx.get(dates[i]);
    if (r > 0) { last = r; lastAt = Date.parse(dates[i]); }
    else if (last == null || (Date.parse(dates[i]) - lastAt) / 864e5 > CARRY_DAYS) continue;
    if (!(close[i] > 0)) continue;
    d.push(dates[i]); c.push(close[i] * last);
  }
  return { dates: d, close: c };
}

/** Every held exchange-provided index quoted in local currency also gets a "(USD)" chart series: symbol USD:<symbol>. */
async function runUsd(pool, { byCcy, log }) {
  let n = 0;
  const fxOf = (ccy) => { const r = byCcy.get(ccy); const m = new Map(); if (r) for (let i = 0; i < r.d.length; i++) if (r.rate[i] > 0) m.set(r.d[i], +r.rate[i]); return m; };
  const srcs = [];
  try {
    const { rows } = await pool.query(`select i.symbol, i.name label, i.country, i.region, i.universe, array_agg(p.date::text order by p.date) d, array_agg(p.close order by p.date) c
      from instruments i join price_history p on p.instrument_id = i.id
      where i.is_active and i.universe in ('global_indices','india_indices') and p.close > 0 group by i.id`);
    for (const r of rows) srcs.push({ symbol: `${r.universe === "india_indices" ? "IN" : "GL"}:${r.symbol}`, label: r.label, country: r.universe === "india_indices" ? "India" : r.country, region: r.region, dates: r.d, close: r.c.map(Number) });
  } catch (e) { log(`[extra] USD heatmap indices skipped: ${e.message}`); }
  for (const a of EXTRA_FMP) {
    if (a.category !== "Index" || COUNTRY_CURRENCY[a.country] === "USD") continue;
    const { rows } = await pool.query(`select date::text d, close from tas_xasset_bars where symbol = $1 and close > 0 order by date`, [a.symbol]).catch(() => ({ rows: [] }));
    if (rows.length) srcs.push({ ...a, dates: rows.map((r) => r.d), close: rows.map((r) => +r.close) });
  }
  for (const s of srcs) {
    const ccy = COUNTRY_CURRENCY[s.country];
    if (!ccy || ccy === "USD") continue;
    const u = toUsd(s.dates, s.close, fxOf(ccy));
    if (u.dates.length < 20) continue;
    await upsert(pool, { symbol: `USD:${s.symbol}`, label: `${s.label} (USD)`, category: "Index", region: s.region, country: s.country, currency: "USD",
      source: `${s.symbol} x ${ccy}/USD (tas_fx); days without a fixing carry the last rate up to ${CARRY_DAYS} days (estimated)`, dates: u.dates, close: u.close });
    n++;
  }
  log(`[extra] wrote ${n} USD index series`);
  return n;
}
