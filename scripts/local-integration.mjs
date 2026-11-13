#!/usr/bin/env node
// Local end-to-end check of the batch engine against a throw-away Postgres:
// loads the synthetic demo universe into stand-in heatmap tables, applies the
// tas_* migration, then runs cli/run.mjs exactly as production would.
//   DATABASE_URL=postgres://postgres@localhost:5433/postgres node scripts/local-integration.mjs
import pg from "pg";
import fs from "node:fs";
import crypto from "node:crypto";
import { generateDemo } from "../engine/demo/generator.js";

const url = process.env.DATABASE_URL;
if (!url || !/localhost|127\.0\.0\.1/.test(url)) { console.error("refusing: DATABASE_URL must point at a LOCAL database"); process.exit(2); }
const pool = new pg.Pool({ connectionString: url });
const uuid = (s) => { const h = crypto.createHash("md5").update(s).digest("hex"); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`; };
await pool.query(fs.readFileSync(new URL("./heatmap_schema_stub.sql", import.meta.url), "utf8"));
await pool.query(fs.readFileSync(new URL("../supabase/migrations/20261113000000_tas_schema.sql", import.meta.url), "utf8"));
await pool.query("truncate instruments, price_history, fundamentals, fx_rates, glocom_latest, tas_fx_history, tas_corporate_action");
const d = generateDemo();
const uni = (r) => {
  const c = r.country;
  if (r.universe === "demo_etfs") return c === "United States" ? "us_etfs" : c === "India" ? "india_etfs" : "global_etfs";
  if (r.universe === "demo_indices") return c === "United States" ? "us_indices" : c === "India" ? "india_indices" : "global_indices";
  return c === "United States" ? "us_stocks" : c === "India" ? "india_stocks" : "global";
};
const rows = d.rows.map((r) => { const u = uni(r); return { ...r, id: uuid(r.id), universe: u, type: u === "us_stocks" ? "CS" : u.endsWith("_etfs") ? "ETF" : u.endsWith("_indices") ? "index" : "stock" }; });
await pool.query(`insert into instruments select * from json_populate_recordset(null::instruments, $1::json)`, [JSON.stringify(rows)]);
for (const r of d.rows) {
  const b = d.bars.get(r.id);
  const recs = b.time.map((t, i) => ({ instrument_id: uuid(r.id), date: t, open: b.open[i], high: b.high[i], low: b.low[i], close: b.close[i], volume: b.volume[i] }));
  await pool.query(`insert into price_history select * from json_populate_recordset(null::price_history, $1::json)`, [JSON.stringify(recs)]);
  const f = d.fundamentals.get(r.id);
  if (f) await pool.query(`insert into fundamentals values ($1,$2,$3,$4,$5,$6,$7,$8)`, [uuid(r.id), JSON.stringify(f.income_statement), JSON.stringify(f.income_statement_q), JSON.stringify(f.balance_sheet), JSON.stringify(f.balance_sheet_q), JSON.stringify(f.cash_flow), JSON.stringify(f.cash_flow_q), f.reported_currency]);
}
for (const [c, h] of Object.entries(d.fxHistory)) {
  await pool.query(`insert into fx_rates values ($1,$2)`, [c, h.usd.at(-1)]);
  const recs = h.dates.map((t, i) => ({ currency: c, date: t, usd_per_unit: h.usd[i], provider_pair: `${c}USD`, inverted: false, source: "demo" }));
  await pool.query(`insert into tas_fx_history (currency,date,usd_per_unit,provider_pair,inverted,source) select currency,date,usd_per_unit,provider_pair,inverted,source from json_populate_recordset(null::tas_fx_history, $1::json)`, [JSON.stringify(recs)]);
}
for (const [id, acts] of d.corporateActions) for (const a of acts) await pool.query(`insert into tas_corporate_action (instrument_id, ex_date, factor, type, source) values ($1,$2,$3,$4,$5)`, [uuid(id), a.exDate, a.factor, a.type, "demo"]);
console.log(`loaded ${rows.length} instruments into the local stand-in`);
await pool.end();
