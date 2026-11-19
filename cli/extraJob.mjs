// Builds tas_extra_series: chart-only instruments the heatmap does not carry
// (engine/reference/extraInstruments.js). FMP indices / yields / commodity futures are fetched
// incrementally into tas_xasset_bars (full history on first sight); currency pairs are built
// from tas_fx. Writes only tas_extra_series and tas_xasset_bars.
import { EXTRA_FMP, currencyPairs, crossRate } from "../engine/reference/extraInstruments.js";

export async function runExtra(pool, { fmpKey = process.env.FMP_API_KEY, log = console.log, fetchImpl = fetch } = {}) {
  let written = 0, missing = [];
  if (fmpKey) {
    for (const a of EXTRA_FMP) {
      try {
        await refresh(pool, a.symbol, fmpKey, fetchImpl);
        const { rows } = await pool.query(`select date::text d, close from tas_xasset_bars where symbol = $1 and close > 0 order by date`, [a.symbol]);
        if (rows.length < 20) { missing.push(a.symbol); continue; }
        await upsert(pool, { ...a, currency: a.category === "Rate" ? "%" : "USD", source: "FMP end-of-day", dates: rows.map((r) => r.d), close: rows.map((r) => +r.close) });
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

async function refresh(pool, symbol, key, fetchImpl) {
  const { rows } = await pool.query(`select max(date)::text d from tas_xasset_bars where symbol = $1`, [symbol]);
  const start = rows[0]?.d || "1990-01-01";
  const r = await fetchImpl(`https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=${encodeURIComponent(symbol)}&from=${start}&apikey=${key}`, { signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`FMP HTTP ${r.status}`);
  const j = await r.json();
  const data = (Array.isArray(j) ? j : j?.historical || []).map((x) => ({ symbol, date: String(x.date).slice(0, 10), close: +(x.adjClose ?? x.close) })).filter((x) => x.close > 0 && /^\d{4}-\d\d-\d\d$/.test(x.date));
  for (let i = 0; i < data.length; i += 4000) {
    await pool.query(`insert into tas_xasset_bars (symbol, date, close) select symbol, date, close from json_populate_recordset(null::tas_xasset_bars, $1::json)
      on conflict (symbol, date) do update set close = excluded.close`, [JSON.stringify(data.slice(i, i + 4000))]);
  }
}
