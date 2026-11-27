// Copies the price series of each GLOCOM / LOCOM portfolio universe (engine/gpUniverses.js) into tas_gp_series.
// Reads the heatmap's instruments + price_history; writes only tas_gp_series. Single-bar bad prints are removed
// (engine/quality.js) so one wrong print cannot decide a category.
import { GP_UNIVERSES, GP_KEYS, GP_FROM } from "../engine/gpUniverses.js";
import { removeBadPrints } from "../engine/quality.js";

async function bars(pool, id) {
  const { rows } = await pool.query(`select date::text d, close from price_history where instrument_id = $1 and date >= $2 and close > 0 order by date`, [id, GP_FROM]);
  const clean = removeBadPrints({ time: rows.map((r) => r.d), close: rows.map((r) => +r.close) }).bars;
  return { dates: clean.time, close: clean.close };
}

export async function runGp(pool, { log = console.log } = {}) {
  let written = 0;
  for (const uk of GP_KEYS) {
    const u = GP_UNIVERSES[uk];
    try {
      let ins;
      if (u.members.symbols) {
        ({ rows: ins } = await pool.query(`select id::text, symbol, name, currency from instruments where universe = $1 and symbol = any($2) and is_active order by symbol`, [u.members.universe, u.members.symbols]));
      } else {
        ({ rows: ins } = await pool.query(`select id::text, symbol, name, currency from instruments where universe = $1 and sector = $2 and is_active order by name`, [u.members.universe, u.members.sector]));
      }
      const { rows: b } = await pool.query(`select id::text, symbol, name, currency from instruments where universe = $1 and symbol = $2 order by is_active desc nulls last limit 1`, [u.benchmark.heat, u.benchmark.symbol]);
      const list = [...ins.map((r) => ({ ...r, bench: false })), ...b.map((r) => ({ ...r, bench: true, name: u.benchmark.label }))];
      const out = [];
      for (const r of list) {
        const s = await bars(pool, r.id);
        if (s.dates.length < 60) { log(`[gp] ${uk} ${r.symbol}: only ${s.dates.length} bars, skipped`); continue; }
        out.push({ key: r.symbol, label: r.name, bench: r.bench, ...s });
      }
      if (out.filter((x) => !x.bench).length < 5) { log(`[gp] ${uk}: ${out.length} usable series, not written`); continue; }
      const keep = out.map((x) => x.key);
      for (const x of out) {
        await pool.query(`insert into tas_gp_series (universe, key, label, is_bench, source, currency, dates, close, updated_at) values ($1,$2,$3,$4,$5,$6,$7::date[],$8,now())
          on conflict (universe, key) do update set label = excluded.label, is_bench = excluded.is_bench, source = excluded.source, currency = excluded.currency, dates = excluded.dates, close = excluded.close, updated_at = now()`,
          [uk, x.key, x.label, x.bench, `heatmap price_history (${u.members.universe})`, u.currency, x.dates, x.close]);
        written++;
      }
      await pool.query(`delete from tas_gp_series where universe = $1 and not (key = any($2))`, [uk, keep]);
      log(`[gp] ${uk}: ${out.length} series`);
    } catch (e) { log(`[gp] ${uk}: ${e.message}`); }
  }
  return { written };
}
