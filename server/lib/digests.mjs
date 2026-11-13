// Morning summary (daily, IST) and weekly summary, sent on Telegram to every
// linked user who has them switched on. tas_digest_log's primary key makes each
// (user, kind, period) send once, even across restarts or two replicas.
import { writeBrief } from "../../engine/briefs.js";
import { breadthDivergence } from "../../engine/breadth.js";
import { esc } from "./telegram.mjs";
import { fmtPct } from "../../engine/format.js";

const DOW = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** Wall-clock now in IST as {date, hhmm, dow}. */
export function istNow(d = new Date()) {
  const t = new Date(d.getTime() + 330 * 60_000);
  return { date: t.toISOString().slice(0, 10), hhmm: t.toISOString().slice(11, 16), dow: DOW[t.getUTCDay()] };
}
/** ISO week key for the IST date, e.g. 2026-W46. */
export function weekKey(date) {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day); // Thursday of this ISO week
  const y = d.getUTCFullYear();
  const w = Math.ceil(((d - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${String(w).padStart(2, "0")}`;
}

export function createDigests({ cfg, pool, data, analysis, telegram, log = console.log }) {
  async function briefText(period) {
    const st = await data.get();
    const api = data.api;
    const [gc, ge, br, rot, ewcw] = await Promise.all([api.indexSeries("CW|USD|G"), api.indexSeries("EW|USD|G"), api.breadth("G"), api.rotation("G"), api.ewcw()]);
    const regions = (await Promise.all(st.regions.map(async (r) => ({ name: r, series: await api.indexSeries(`CW|USD|R:${r}`) })))).filter((r) => r.series);
    const countries = (await Promise.all(st.countries.map(async (c) => ({ name: c, series: await api.indexSeries(`CW|USD|C:${c}`) })))).filter((c) => c.series);
    const bars = period === "daily" ? 1 : 5;
    const b = writeBrief({ period, asOf: st.info.asOf, sinceDate: br?.dates?.[Math.max(0, br.dates.length - 1 - bars)], global: { CW: gc, EW: ge }, regions, countries,
      breadth: { global: br }, rotation: rot || [], regimes: st.regimes, ewcwGlobal: ewcw.find((e) => e.pairKey === "USD|G"), rows: st.rows, divergence: gc && br ? breadthDivergence(gc, br, 5) : null });
    return b;
  }

  async function forUser(user, kind) {
    const period = kind === "weekly" ? "weekly" : "daily";
    const b = await briefText(period);
    const parts = [`${kind === "weekly" ? "📅" : "☀️"} <b>${esc(b.title)}</b> · data to ${esc(b.asOf)}`];
    for (const s of b.sections.slice(0, kind === "weekly" ? 6 : 3)) parts.push(`\n<b>${esc(s.title)}</b>\n${s.lines.slice(0, 4).map((l) => `• ${esc(l)}`).join("\n")}`);
    const wls = await pool.query(`select value from tas_user_doc where user_id = $1 and key = 'watchlists'`, [user.id]);
    const lists = wls.rows[0]?.value || {};
    for (const [, l] of Object.entries(lists).slice(0, 3)) {
      if (!l.ids?.length) continue;
      const r = await analysis.review(l.ids);
      const ret = (x) => fmtPct(kind === "weekly" ? x.ret1M : x.ret1M);
      parts.push(`\n<b>Watchlist: ${esc(l.name)}</b> (${l.ids.length})\nRising: ${r.rising.length ? r.rising.slice(0, 10).map((x) => `${esc(x.symbol)} ${esc(ret(x))}`).join(", ") : "none"}${r.notRising.length ? `\nNot rising: ${r.notRising.slice(0, 10).map((x) => esc(x.symbol)).join(", ")}` : ""}`);
    }
    const { rows: ev } = await pool.query(`select count(*)::int n from tas_alert_event where user_id = $1 and instrument_id <> '__seed__' and not (delivered ? 'seeded') and fired_at > now() - interval '${kind === "weekly" ? "7 days" : "1 day"}'`, [user.id]);
    if (ev[0].n) parts.push(`\n🔔 ${ev[0].n} alert${ev[0].n > 1 ? "s" : ""} fired in the last ${kind === "weekly" ? "week" : "day"}.`);
    if (cfg.appUrl) parts.push(`\n<a href="${cfg.appUrl}/#/briefs">Open full brief</a>`);
    parts.push(`<i>${esc(b.note)}</i>`);
    return parts.join("\n");
  }

  /** Called every minute: sends whatever is due. */
  async function tick(now = new Date()) {
    if (!telegram.enabled) return { skipped: "telegram not configured" };
    const t = istNow(now);
    const [wd, wt] = cfg.weeklySummaryTime.toLowerCase().split(/\s+/);
    const due = [];
    if (t.hhmm >= cfg.morningSummaryTime && ["mon", "tue", "wed", "thu", "fri"].includes(t.dow)) due.push({ kind: "morning", period: t.date });
    if (t.dow === wd && t.hhmm >= wt) due.push({ kind: "weekly", period: weekKey(t.date) });
    let sent = 0;
    for (const d of due) {
      const setting = d.kind === "morning" ? "morningSummary" : "weeklySummary";
      const { rows } = await pool.query(
        `select u.* from tas_user u where u.telegram_chat_id is not null and coalesce((u.settings->>$1)::boolean, true)
           and not exists (select 1 from tas_digest_log l where l.user_id = u.id and l.kind = $2 and l.period_key = $3)`, [setting, d.kind, d.period]);
      for (const u of rows) {
        // claim first so a crash mid-send can never produce a duplicate
        const claim = await pool.query(`insert into tas_digest_log (user_id, kind, period_key) values ($1, $2, $3) on conflict do nothing returning 1`, [u.id, d.kind, d.period]);
        if (!claim.rowCount) continue;
        try { await telegram.send(u.telegram_chat_id, await forUser(u, d.kind)); sent++; }
        catch (e) { log(`[digest] ${d.kind} for ${u.email}: ${e.message}`); }
      }
    }
    return { sent };
  }

  return { tick, forUser, briefText };
}
