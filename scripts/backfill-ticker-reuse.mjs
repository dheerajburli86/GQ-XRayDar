#!/usr/bin/env node
// Loads the history a renamed company is missing (META: Facebook 2012-2022) into the HEATMAP's price_history.
//
//   !! price_history is owned by the heatmap dashboard. The XRayDar app and engine never write it (CLAUDE.md).
//   !! Run this ONLY from the heatmap's side, with the heatmap database URL, as a deliberate one-off.
//
// For each US stock whose stored bars show a ticker-reuse break (a 7+ day gap with a permanent x5 level change, see
// engine/quality.js cutAtTickerReuse) it fetches that ticker's full history from FMP, checks that it JOINS the stored
// series (scripts/lib/tickerReusePlan.mjs) and, when it does, replaces the bars before the break (they belong to the
// previous holder of the ticker) with FMP's. Dry run by default: prints the plan and writes nothing.
//
//   DATABASE_URL=<heatmap db> FMP_API_KEY=... node scripts/backfill-ticker-reuse.mjs --symbols META,APP
//   ... --detect                 every active us_stocks symbol (slow: scans the price table)
//   ... --apply                  write (one transaction per instrument)
// Afterwards recompute the returns on the heatmap side (python -m pipeline.recompute_returns) and let the next engine run pick it up.
import pg from "pg";
import { planBackfill } from "./lib/tickerReusePlan.mjs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const val = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const url = process.env.DATABASE_URL, key = process.env.FMP_API_KEY;
if (!url || !key) { console.error("DATABASE_URL (heatmap) and FMP_API_KEY are required"); process.exit(2); }
const apply = flag("apply");
const pool = new pg.Pool({ connectionString: url, max: 2 });

async function fmpHistory(symbol) {
  const r = await fetch(`https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=${encodeURIComponent(symbol)}&from=1990-01-01&apikey=${key}`, { signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`FMP ${symbol}: HTTP ${r.status}`);
  const j = await r.json();
  return Array.isArray(j) ? j : j?.historical || [];
}

async function symbols() {
  if (val("symbols")) return val("symbols").split(",").map((s) => s.trim()).filter(Boolean);
  if (!flag("detect")) { console.error("give --symbols A,B or --detect"); process.exit(2); }
  const { rows } = await pool.query(`select symbol from instruments where universe = 'us_stocks' and is_active order by symbol`);
  return rows.map((r) => r.symbol);
}

let done = 0, skipped = 0, wrote = 0;
for (const symbol of await symbols()) {
  const { rows: inst } = await pool.query(`select id from instruments where universe = 'us_stocks' and is_active and symbol = $1`, [symbol]);
  if (inst.length !== 1) { console.log(`${symbol}: ${inst.length} matching instruments, skipped`); continue; }
  const id = inst[0].id;
  const { rows } = await pool.query(`select date::text d, open, high, low, close, volume from price_history where instrument_id = $1 and close is not null order by date`, [id]);
  const bars = { time: rows.map((r) => r.d), open: rows.map((r) => +r.open), high: rows.map((r) => +r.high), low: rows.map((r) => +r.low), close: rows.map((r) => +r.close), volume: rows.map((r) => +r.volume || 0) };
  // cheap pre-check before spending an FMP call
  const { cutAtTickerReuse } = await import("../engine/quality.js");
  if (!cutAtTickerReuse(bars).cut) continue;
  done++;
  let plan;
  try { plan = planBackfill(bars, await fmpHistory(symbol)); } catch (e) { console.log(`${symbol}: ${e.message}`); skipped++; continue; }
  if (plan.skip) { console.log(`${symbol}: SKIP ${plan.skip}`); skipped++; continue; }
  console.log(`${symbol}: ${apply ? "WRITE" : "would write"} ${plan.insert.length} bars ${plan.insert[0].date}..${plan.insert.at(-1).date}, replacing ${plan.storedBefore} stored bar(s) before ${plan.breakDate}`);
  if (!apply) continue;
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query(`delete from price_history where instrument_id = $1 and date < $2`, [id, plan.deleteBefore]);
    for (let i = 0; i < plan.insert.length; i += 500) {
      const part = plan.insert.slice(i, i + 500);
      await c.query(
        `insert into price_history (instrument_id, date, open, high, low, close, volume) select $1, d, o, h, l, c, v from unnest($2::date[], $3::numeric[], $4::numeric[], $5::numeric[], $6::numeric[], $7::bigint[]) as t(d, o, h, l, c, v) on conflict (instrument_id, date) do update set open = excluded.open, high = excluded.high, low = excluded.low, close = excluded.close, volume = excluded.volume`,
        [id, part.map((r) => r.date), part.map((r) => r.open), part.map((r) => r.high), part.map((r) => r.low), part.map((r) => r.close), part.map((r) => r.volume)]);
    }
    await c.query("commit"); wrote++;
  } catch (e) { await c.query("rollback").catch(() => {}); console.log(`${symbol}: FAILED, rolled back: ${e.message}`); } finally { c.release(); }
}
console.log(`\n${done} with a break, ${skipped} skipped, ${apply ? `${wrote} written` : "dry run: nothing written (add --apply)"}`);
await pool.end();
