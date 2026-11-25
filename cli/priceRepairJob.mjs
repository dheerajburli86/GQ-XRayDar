// Finds stored bars that are impossible against the latest close (more than 50x away, either way, in the last
// ~2 years), asks FMP for the same dates and records one decision per bar in tas_price_repair (engine/quality.js
// decideRepairs): replace from the provider, drop, or confirmed (the provider agrees: a real move).
// Reads price_history / instruments / instrument_provider_symbols (heatmap); writes only tas_price_repair.
// India is skipped: its prices come from Kite and FMP's India coverage is partial.
import { decideRepairs } from "../engine/quality.js";

const LOOKBACK_DAYS = 800;
const RECHECK_DAYS = 7;

export async function runPriceRepair(pool, { fmpKey = process.env.FMP_API_KEY, log = console.log, fetchImpl = fetch, rps = 3, limit = 400 } = {}) {
  if (!fmpKey) return { skipped: "no FMP_API_KEY" };
  // never compete with the engine for price_history: both scan it, and one run of each at once hit the statement timeout (2026-11-25)
  const { rows: busy } = await pool.query(`select 1 from tas_calc_run where status = 'running' and started > now() - interval '8 hours' limit 1`).catch(() => ({ rows: [] }));
  if (busy.length) return { skipped: "engine run in progress" };
  // suspects: active non-India instruments with a bar far from their latest close, not checked in the last week.
  // Read in slices of instruments (index range scans) so no single statement runs long.
  const { rows: all } = await pool.query(`select r.instrument_id::text id, r.price_native::float8 lp from returns_latest r join instruments i on i.id = r.instrument_id
    where i.is_active and r.price_native > 0 and i.universe not like 'india%'`);
  const found = [];
  for (let k = 0; k < all.length && found.length < limit * 3; k += 300) {
    const part = all.slice(k, k + 300);
    const { rows } = await pool.query(`
      select p.instrument_id::text id, min(p.date)::text first_bad, max(p.date)::text last_bad, l.lp::float8 latest,
             json_agg(json_build_object('date', p.date::text, 'close', p.close::float8) order by p.date) bars
      from price_history p join unnest($1::uuid[], $2::float8[]) as l(id, lp) on l.id = p.instrument_id
      where p.date > current_date - ${LOOKBACK_DAYS} and p.close > 0 and (p.close < l.lp / 50 or p.close > l.lp * 50)
      group by p.instrument_id, l.lp`, [part.map((x) => x.id), part.map((x) => x.lp)]);
    found.push(...rows);
  }
  let sus = [];
  if (found.length) {
    const ids = found.map((x) => x.id);
    const { rows: meta } = await pool.query(`
      select i.id::text id, i.symbol, i.universe,
             coalesce(m.provider_symbol, case when i.universe like 'us_%' then i.symbol end) psym,
             exists (select 1 from tas_price_repair t where t.instrument_id = i.id::text and t.checked_at > now() - interval '${RECHECK_DAYS} days') rechecked
      from instruments i
      left join lateral (select provider_symbol from instrument_provider_symbols s where s.instrument_id::text = i.id::text and s.provider_symbol is not null
                         order by (s.status in ('SUCCESS','VERIFIED')) desc limit 1) m on true
      where i.id = any($1::uuid[])`, [ids]);
    const mm = new Map(meta.map((x) => [x.id, x]));
    sus = found.filter((f) => mm.has(f.id) && !mm.get(f.id).rechecked).map((f) => ({ ...f, ...mm.get(f.id) }))
      .sort((x, y) => y.bars.length - x.bars.length).slice(0, limit);
  }
  if (!sus.length) return { checked: 0 };
  let last = 0;
  const hist = async (sym, from, to) => {
    const wait = last + 1000 / rps - Date.now(); if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    const r = await fetchImpl(`https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=${encodeURIComponent(sym)}&from=${from}&to=${to}&apikey=${fmpKey}`, { signal: AbortSignal.timeout(30_000) });
    if (r.status === 429) { await new Promise((res) => setTimeout(res, 20_000)); return hist(sym, from, to); }
    if (!r.ok) return null;
    let j = await r.json().catch(() => null);
    if (Array.isArray(j) && j[0]?.historical) j = j[0].historical;
    if (j && !Array.isArray(j) && Array.isArray(j.historical)) j = j.historical;
    return Array.isArray(j) ? j : null;
  };
  const tally = { replace: 0, drop: 0, confirmed: 0, instruments: 0, noProvider: 0 };
  for (const s of sus) {
    let prov = new Map();
    if (s.psym) {
      try {
        const rows = await hist(s.psym, s.first_bad, s.last_bad);
        for (const x of rows || []) if (x?.date && +x.close > 0) prov.set(String(x.date).slice(0, 10), { open: +x.open || null, high: +x.high || null, low: +x.low || null, close: +x.close, volume: x.volume != null ? Math.round(+x.volume) : null });
      } catch (e) { log(`price-repair ${s.symbol}: ${e.message}`); prov = new Map(); }
    } else tally.noProvider++;
    const dec = decideRepairs(s.bars, prov, s.latest);
    for (const d of dec) {
      tally[d.action]++;
      await pool.query(`insert into tas_price_repair (instrument_id, date, action, stored_close, open, high, low, close, volume, provider, provider_symbol, reason, checked_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'FMP',$10,$11,now())
        on conflict (instrument_id, date) do update set action = excluded.action, stored_close = excluded.stored_close, open = excluded.open, high = excluded.high,
          low = excluded.low, close = excluded.close, volume = excluded.volume, provider_symbol = excluded.provider_symbol, reason = excluded.reason, checked_at = now()`,
      [s.id, d.date, d.action, d.storedClose, d.open ?? null, d.high ?? null, d.low ?? null, d.action === "replace" ? d.close : null, d.volume ?? null, s.psym || null, d.reason]);
    }
    tally.instruments++;
  }
  log(`price-repair: ${tally.instruments} instruments, ${tally.replace} replaced, ${tally.drop} dropped, ${tally.confirmed} confirmed real (${tally.noProvider} without a provider symbol)`);
  return tally;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  console.log(await runPriceRepair(pool));
  await pool.end();
}
