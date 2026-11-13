#!/usr/bin/env node
// Historical FX loader -> tas_fx_history (requirement 22).
//
// The heatmap's fx_rates table holds only TODAY's rate per currency, which is
// not enough to convert a ten-year local index into USD: that needs the rate on
// every date. This script fetches daily history from FMP for every currency the
// stock universe trades in and stores it as USD per ONE unit, recording the
// pair the provider actually quoted and whether it was inverted.
//
//   DATABASE_URL=... FMP_API_KEY=... node cli/fx-backfill.mjs [--from 2014-01-01]
//
// Safe to re-run: rows upsert on (currency, date). Run it before the engine,
// then daily (it only asks for dates after the newest stored one per currency).

import pg from "pg";

const url = process.env.DATABASE_URL, key = process.env.FMP_API_KEY;
if (!url || !key) { console.error("DATABASE_URL and FMP_API_KEY are required"); process.exit(2); }
const args = process.argv.slice(2);
const from = args.includes("--from") ? args[args.indexOf("--from") + 1] : "2014-01-01";
pg.types.setTypeParser(1082, (v) => v);
const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 2 });

const MINOR = { GBX: "GBP", GBP_PENCE: "GBP", ZAC: "ZAR", ILA: "ILS" };

async function fetchPair(pair, start) {
  const u = `https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=${pair}&from=${start}&apikey=${key}`;
  const r = await fetch(u);
  if (!r.ok) return [];
  const j = await r.json();
  const rows = Array.isArray(j) ? j : j?.historical || [];
  return rows.map((x) => ({ date: String(x.date).slice(0, 10), v: +(x.close ?? x.price ?? x.adjClose) })).filter((x) => x.v > 0);
}

const { rows: cur } = await pool.query(
  `select distinct upper(currency) c from instruments where universe in ('us_stocks','global','india_stocks') and currency is not null`);
const currencies = [...new Set(cur.map((r) => MINOR[r.c] || r.c))].filter((c) => c && c !== "USD").sort();
const { rows: lastRows } = await pool.query(`select currency, max(date)::text d from tas_fx_history group by currency`);
const lastOf = Object.fromEntries(lastRows.map((r) => [r.currency, r.d]));

for (const c of currencies) {
  const start = lastOf[c] || from;
  let pair = `${c}USD`, inverted = false;
  let data = await fetchPair(pair, start);
  if (!data.length) { pair = `USD${c}`; inverted = true; data = await fetchPair(pair, start); }
  if (!data.length) { console.log(`${c}: no history from FMP (${c}USD / USD${c}) - engine will fall back to a constant latest rate, flagged ESTIMATED`); continue; }
  const rows = data.map((x) => ({ currency: c, date: x.date, usd_per_unit: inverted ? 1 / x.v : x.v, provider_pair: pair, inverted, source: "fmp" }));
  for (let i = 0; i < rows.length; i += 1000) {
    await pool.query(
      `insert into tas_fx_history (currency, date, usd_per_unit, provider_pair, inverted, source)
       select currency, date, usd_per_unit, provider_pair, inverted, source from json_populate_recordset(null::tas_fx_history, $1::json)
       on conflict (currency, date) do update set usd_per_unit = excluded.usd_per_unit, provider_pair = excluded.provider_pair,
         inverted = excluded.inverted, source = excluded.source, fetched_at = now()`,
      [JSON.stringify(rows.slice(i, i + 1000))]);
  }
  console.log(`${c}: ${rows.length} fixings via ${pair}${inverted ? " (inverted)" : ""}`);
  await new Promise((r) => setTimeout(r, 250)); // stay well inside the FMP rate limit
}
await pool.end();
