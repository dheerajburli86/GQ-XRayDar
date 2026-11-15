#!/usr/bin/env node
// Cross-asset series -> tas_xasset.   DATABASE_URL=... [FMP_API_KEY=...] node cli/xasset.mjs
import pg from "pg";
import { runXasset } from "./xassetJob.mjs";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is required"); process.exit(2); }
pg.types.setTypeParser(1082, (v) => v);
const pool = new pg.Pool({ connectionString: url, ssl: url.includes("localhost") ? false : { rejectUnauthorized: false }, max: 2 });
try { await runXasset(pool); } catch (e) { console.error("xasset failed:", e.message); process.exitCode = 1; } finally { await pool.end(); }
