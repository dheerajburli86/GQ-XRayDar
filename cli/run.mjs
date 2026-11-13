#!/usr/bin/env node
// Calculation engine, batch mode: reads the heatmap dashboard's Supabase
// database, computes every index / signal / analytic, writes tas_* tables.
//
//   DATABASE_URL=postgres://... npm run engine            # full run, writes
//   DATABASE_URL=postgres://... npm run engine:dry        # compute only, writes nothing
//   ... --countries "India,Japan"                         # restrict (testing only: higher indices then cover only these)
//   ... --start 2018-01-01                                # override methodology start date (recorded in the run)
//
// Exit code is non-zero on failure, and the run is marked failed in tas_calc_run.

import pg from "pg";
import { runPipeline } from "../engine/pipeline.js";
import { METHODOLOGY } from "../engine/methodology.js";
import { pgSource } from "./pgSource.mjs";
import { pgSink } from "./pgSink.mjs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Use the Supabase connection string (Session pooler) for the heatmap project.");
  process.exit(2);
}
pg.types.setTypeParser(1082, (v) => v); // date -> 'YYYY-MM-DD' string, never a timezone-shifted Date

const pool = new pg.Pool({ connectionString: url, max: 4, ssl: url.includes("localhost") ? false : { rejectUnauthorized: false }, statement_timeout: 600000 });
const dryRun = flag("--dry-run");
const methodology = { ...METHODOLOGY, ...(opt("--start") ? { startDate: opt("--start") } : {}) };
const only = opt("--countries") ? new Set(opt("--countries").split(",").map((s) => s.trim())) : null;

const source = pgSource(pool);
if (only) {
  const base = source.securities;
  source.securities = async () => (await base()).filter((r) => only.has(String(r.country || "").replace(/_/g, " ")) || (r.universe === "us_stocks" && only.has("United States")) || (r.universe === "india_stocks" && only.has("India")));
}
const sink = pgSink(pool, { dryRun });
const t0 = Date.now();
let last = "";
try {
  const run = await runPipeline(source, sink, {
    methodology,
    onProgress: ({ phase, done, total, note }) => {
      const line = `${phase} ${done}/${total}${note ? ` ${note}` : ""}`;
      if (line !== last) { console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${line}`); last = line; }
    },
  });
  console.log(`done in ${((Date.now() - t0) / 60000).toFixed(1)} min: ${JSON.stringify(run.stats)}`);
  await pool.end();
} catch (e) {
  console.error("ENGINE FAILED:", e);
  try { await sink.fail(e); } catch { /* best effort */ }
  await pool.end();
  process.exit(1);
}
