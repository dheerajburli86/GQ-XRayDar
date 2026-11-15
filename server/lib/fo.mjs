// F&O end-of-day collector: downloads the exchange's public files, parses them,
// computes each underlying's summary and stores tas_fo_* rows.
//
// Runs inside the TA server (always on): a few minutes after boot and then every
// FO_POLL_MINUTES. Each pass loads at most FO_MAX_PER_TICK missing sessions, oldest
// first, so a first deploy backfills FO_BACKFILL_SESSIONS over a few passes.
// It never writes a heatmap-owned table.
import { parseFoBhavcopy, parseParticipantOi, parseSecBan, parseCombineOi, nseUrls } from "../../engine/deriv/nse.js";
import { summarizeDay, withHistory } from "../../engine/deriv/summary.js";
import { encodeDay } from "../../engine/deriv/codec.js";
import { unzipEntries } from "./zip.mjs";

// Bump when the summary logic changes: stored sessions from an older version are re-processed.
export const FO_VERSION = 2;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const istNow = () => new Date(Date.now() + 5.5 * 3600_000);
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => iso(new Date(Date.parse(s) + n * 86400_000));
const weekday = (s) => { const w = new Date(Date.parse(s)).getUTCDay(); return w !== 0 && w !== 6; };

export function foConfig(e = process.env) {
  return {
    enabled: (e.FO_ENABLED || "true").toLowerCase() !== "false",
    backfill: Math.max(5, +e.FO_BACKFILL_SESSIONS || 120),
    keepChains: Math.max(5, +e.FO_CHAIN_KEEP_SESSIONS || 60),
    maxPerTick: Math.max(1, +e.FO_MAX_PER_TICK || 25),
    pollMinutes: Math.max(5, +e.FO_POLL_MINUTES || 20),
    readyIst: e.FO_READY_IST || "19:30", // the day's files are normally out by then
    // NSE's archive does not answer cloud data-centre IPs; the Supabase edge function
    // nse-fo-fetch (supabase/functions) fetches the same public files from India.
    proxyUrl: e.NSE_PROXY_URL || (e.SUPABASE_URL ? `${e.SUPABASE_URL.replace(/\/$/, "")}/functions/v1/nse-fo-fetch` : ""),
    proxyKey: e.SUPABASE_ANON_KEY || "",
  };
}

export function createFo({ pool, log = console.log, fetchImpl = fetch, cfg = foConfig() }) {
  let cookie = "", cookieAt = 0, running = false, last = null;

  async function nseCookie(force = false) {
    if (!force && cookie && Date.now() - cookieAt < 20 * 60_000) return cookie;
    try {
      const r = await fetchImpl("https://www.nseindia.com/", { signal: AbortSignal.timeout(30_000), headers: { "User-Agent": UA, Accept: "text/html", "Accept-Language": "en-US,en;q=0.9" } });
      const set = typeof r.headers.getSetCookie === "function" ? r.headers.getSetCookie() : [r.headers.get("set-cookie")].filter(Boolean);
      cookie = set.map((c) => c.split(";")[0]).join("; ");
      cookieAt = Date.now();
    } catch (e) { log(`[fo] cookie fetch failed: ${e.message}`); }
    return cookie;
  }

  async function get(url) {
    if (cfg.proxyUrl) {
      const path = new URL(url).pathname;
      for (let attempt = 0; attempt < 2; attempt++) {
        let r;
        try { r = await fetchImpl(`${cfg.proxyUrl}?path=${encodeURIComponent(path)}`, { signal: AbortSignal.timeout(90_000), headers: cfg.proxyKey ? { Authorization: `Bearer ${cfg.proxyKey}`, apikey: cfg.proxyKey } : {} }); }
        catch (e) { if (attempt === 1) throw new Error(`${path.split("/").pop()} via proxy: ${e.message} (${e.cause?.code || e.name})`); continue; }
        if (r.status === 404) return null;
        if (r.ok) return Buffer.from(await r.arrayBuffer());
        if (attempt === 1) throw new Error(`${path.split("/").pop()} via proxy: HTTP ${r.status} ${(await r.text()).slice(0, 120)}`);
      }
      return null;
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const ck = await nseCookie(attempt > 0);
      let r;
      try { r = await fetchImpl(url, { signal: AbortSignal.timeout(60_000), headers: { "User-Agent": UA, Accept: "*/*", Referer: "https://www.nseindia.com/", ...(ck ? { Cookie: ck } : {}) } }); }
      catch (e) { const why = e.cause?.code || e.cause?.message || e.name; if (attempt === 1) throw new Error(`${url.split("/").pop()}: ${e.message} (${why})`); continue; }
      if (r.status === 404) return null;
      if (r.ok) return Buffer.from(await r.arrayBuffer());
      if (attempt === 1) throw new Error(`${url.split("/").pop()}: HTTP ${r.status}`);
    }
    return null;
  }
  const text = (buf, zipped) => (buf ? (zipped ? unzipEntries(buf)[0]?.data.toString("utf8") : buf.toString("utf8")) : null);

  /** Sessions to try: weekdays in the backfill window that are not stored as ok (or a recent 'none' worth retrying). */
  async function pending() {
    const now = istNow(), today = iso(now), hm = now.toISOString().slice(11, 16);
    const dates = [];
    for (let d = today; dates.length < cfg.backfill; d = addDays(d, -1)) if (weekday(d)) dates.push(d);
    const { rows } = await pool.query(`select date::text d, status, attempts, (files->>'v')::int v from tas_fo_day where date >= $1`, [dates[dates.length - 1]]);
    const have = new Map(rows.map((r) => [r.d, r]));
    return dates.filter((d) => {
      if (d === today && hm < cfg.readyIst) return false;
      const h = have.get(d);
      if (!h) return true;
      if (h.status === "ok") return (h.v || 1) < FO_VERSION;
      if (h.status === "error") return h.attempts < 8;     // transport / parse failures are retried
      return d >= addDays(today, -4) && h.attempts < 8;     // "not published" is retried only while recent
    }).sort();
  }

  async function history(und, before) {
    const { rows } = await pool.query(`select s from tas_fo_stats where und = $1 and date < $2 order by date desc limit 260`, [und, before]);
    return rows.map((r) => r.s).reverse();
  }

  async function loadDate(date) {
    const u = nseUrls(date);
    const files = { v: FO_VERSION };
    const bhav = text(await get(u.bhav), true);
    if (!bhav) { await mark(date, "none", null, 0, 0, { bhav: "not published" }); return { date, status: "none" }; }
    const parsed = parseFoBhavcopy(bhav);
    files.bhav = { rows: parsed.rows, units: parsed.units };
    // Market-wide files are optional: a failure is recorded, never fatal.
    const market = { participants: null, ban: null, mwpl: null };
    // The ban file is named for the trade date it applies to: the session's own, or the next weekday's.
    let nextDay = addDays(date, 1); while (!weekday(nextDay)) nextDay = addDays(nextDay, 1);
    const banUrls = [u.secban, nseUrls(nextDay).secban];
    for (const [k, urls, zipped, fn] of [["participants", [u.participant], false, parseParticipantOi], ["ban", banUrls, false, parseSecBan], ["mwpl", [u.combineoi], true, parseCombineOi]]) {
      try {
        let t = null;
        for (const url of urls) { t = text(await get(url), zipped); if (t) break; }
        market[k] = t ? fn(t) : null; files[k] = t ? "ok" : "not published";
      } catch (e) { files[k] = `error: ${e.message.slice(0, 300)}`; }
    }
    const client = await pool.connect();
    try {
      let n = 0;
      const chainRows = [], statRows = [];
      for (const day of parsed.days.values()) {
        if (!(day.spot > 0) || !day.options.length && !day.futures.length) continue;
        const hist = await history(day.underlying, date);
        if (hist.length) day.spotPrev = hist[hist.length - 1].spot;
        let s;
        try { s = withHistory(summarizeDay(day), hist); } catch (e) { log(`[fo] ${date} ${day.underlying}: summary failed: ${e.message}`); continue; }
        chainRows.push({ date, und: day.underlying, kind: day.kind, spot: day.spot, lot: day.lot, data: encodeDay(day) });
        statRows.push({ date, und: day.underlying, kind: day.kind, s });
        n++;
      }
      await client.query("begin");
      for (let i = 0; i < chainRows.length; i += 25) {
        await client.query(`insert into tas_fo_chain (date, und, kind, spot, lot, data) select date, und, kind, spot, lot, data from json_populate_recordset(null::tas_fo_chain, $1::json)
          on conflict (date, und) do update set kind = excluded.kind, spot = excluded.spot, lot = excluded.lot, data = excluded.data`, [JSON.stringify(chainRows.slice(i, i + 25))]);
      }
      for (let i = 0; i < statRows.length; i += 200) {
        await client.query(`insert into tas_fo_stats (date, und, kind, s) select date, und, kind, s from json_populate_recordset(null::tas_fo_stats, $1::json)
          on conflict (date, und) do update set kind = excluded.kind, s = excluded.s`, [JSON.stringify(statRows.slice(i, i + 200))]);
      }
      await client.query(`insert into tas_fo_market (date, participants, ban, mwpl) values ($1, $2, $3, $4)
        on conflict (date) do update set participants = coalesce(excluded.participants, tas_fo_market.participants), ban = coalesce(excluded.ban, tas_fo_market.ban), mwpl = coalesce(excluded.mwpl, tas_fo_market.mwpl)`,
        [date, market.participants ? JSON.stringify(market.participants) : null, market.ban, market.mwpl ? JSON.stringify(market.mwpl) : null]);
      await client.query("commit");
      await mark(date, "ok", parsed.units, parsed.rows, n, files);
      return { date, status: "ok", underlyings: n, files };
    } catch (e) { await client.query("rollback").catch(() => {}); throw e; } finally { client.release(); }
  }

  async function mark(date, status, units, rows, unds, files) {
    await pool.query(`insert into tas_fo_day (date, status, units, rows, underlyings, files, attempts, fetched_at) values ($1,$2,$3,$4,$5,$6,1,now())
      on conflict (date) do update set status = excluded.status, units = excluded.units, rows = excluded.rows, underlyings = excluded.underlyings, files = excluded.files,
        attempts = tas_fo_day.attempts + 1, fetched_at = now()`, [date, status, units, rows, unds, JSON.stringify(files)]);
  }

  async function prune() {
    await pool.query(`delete from tas_fo_chain where date < (select min(date) from (select distinct date from tas_fo_chain order by date desc limit $1) x)`, [cfg.keepChains]);
  }

  async function tick() {
    if (!cfg.enabled || running) return last;
    running = true;
    const t0 = Date.now(), done = [];
    try {
      const todo = (await pending()).slice(0, cfg.maxPerTick);
      let streak = 0;
      for (const d of todo) {
        if (streak >= 2) { log("[fo] two failures in a row: stopping this pass (the exchange may be refusing this server)"); break; }
        try { const r = await loadDate(d); done.push(r); streak = 0; log(`[fo] ${d}: ${r.status}${r.underlyings ? ` (${r.underlyings} underlyings; ${Object.entries(r.files).filter(([k]) => k !== "v").map(([k, v]) => `${k} ${typeof v === "string" ? v : "ok"}`).join(", ")})` : ""}`); }
        catch (e) { streak++; done.push({ date: d, status: "error", error: e.message }); log(`[fo] ${d}: ERROR ${e.message}`); await mark(d, "error", null, 0, 0, { error: e.message.slice(0, 500) }).catch(() => {}); }
        await new Promise((r) => setTimeout(r, 1500));
      }
      if (done.some((x) => x.status === "ok")) await prune();
      last = { at: new Date().toISOString(), ms: Date.now() - t0, done };
      return last;
    } finally { running = false; }
  }

  return { tick, status: () => ({ enabled: cfg.enabled, running, last, cfg }), loadDate };
}
