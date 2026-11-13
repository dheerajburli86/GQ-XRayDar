// Background tasks (feature 4.7): "review my watchlist every morning", "screen
// India for MMA squeezes each Monday". A task is a row in tas_task; the runner
// claims due rows with SKIP LOCKED so two replicas never run one task twice,
// reports progress on Telegram for linked users, and re-schedules recurring ones.
import { esc } from "./telegram.mjs";
import { findWatchlist } from "./userdata.mjs";
import { fmtPct } from "../../engine/format.js";

export const TASK_KINDS = {
  review_list: "Review a watchlist: which names are rising, with evidence",
  screen: "Run a screen (plain-English query or conditions)",
  summary: "Market summary for a scope (G, R:<region>, C:<country>)",
  compare: "Compare two instruments",
  analyze: "Full analysis of one instrument",
};

const DOWS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** Next run (UTC Date) for a schedule string in IST, after `from`. null = once. */
export function nextRun(schedule, from = new Date()) {
  if (!schedule) return null;
  const m = String(schedule).toLowerCase().trim().match(/^(daily|weekdays|weekly\s+(sun|mon|tue|wed|thu|fri|sat))\s+(\d{1,2}):(\d{2})$/);
  if (!m) throw new Error(`bad schedule "${schedule}": use "daily 08:30", "weekdays 09:15" or "weekly mon 08:00" (IST)`);
  const [, kind, dow, hh, mm] = m;
  if (+hh > 23 || +mm > 59) throw new Error("bad time");
  for (let add = 0; add <= 8; add++) {
    const ist = new Date(from.getTime() + 330 * 60_000);
    ist.setUTCDate(ist.getUTCDate() + add);
    ist.setUTCHours(+hh, +mm, 0, 0);
    const utc = new Date(ist.getTime() - 330 * 60_000);
    if (utc <= from) continue;
    const d = DOWS[ist.getUTCDay()];
    if (kind === "weekdays" && (d === "sat" || d === "sun")) continue;
    if (kind.startsWith("weekly") && d !== dow) continue;
    return utc;
  }
  return null;
}

export function createTasks({ pool, analysis, userdata, telegram, log = console.log }) {
  async function create(userId, { title, kind, params = {}, schedule = null, source = "web" }) {
    if (!TASK_KINDS[kind]) throw Object.assign(new Error(`unknown task kind ${kind}; one of ${Object.keys(TASK_KINDS).join(", ")}`), { status: 400 });
    const first = schedule ? nextRun(schedule) : new Date();
    const { rows } = await pool.query(`insert into tas_task (user_id, title, kind, params, schedule, source, next_run) values ($1,$2,$3,$4,$5,$6,$7) returning *`,
      [userId, title || TASK_KINDS[kind], kind, JSON.stringify(params), schedule, source, first]);
    return rows[0];
  }

  async function execute(task, progress) {
    const p = task.params || {};
    switch (task.kind) {
      case "review_list": {
        let ids = p.ids;
        if (!ids) { const wl = findWatchlist(await userdata.getDoc(task.user_id, "watchlists", {}), p.watchlist); if (!wl) throw new Error(`watchlist "${p.watchlist}" not found`); ids = wl.ids; p.watchlistName = wl.name; }
        await progress(30);
        return analysis.review(ids, p.question || null);
      }
      case "screen": return analysis.screen({ query: p.query, conditions: p.conditions, scope: p.scope || {}, limit: p.limit || 25 });
      case "summary": return analysis.market(p.scope || "G");
      case "compare": return analysis.compare(p.a, p.b);
      case "analyze": return analysis.stock(p.symbol || p.id);
      default: throw new Error("unknown kind");
    }
  }

  function render(task, r) {
    const h = `✅ <b>${esc(task.title)}</b>`;
    if (r.error) return `${h}\n${esc(r.error)}`;
    if (task.kind === "review_list") return `${h}${task.params.watchlistName ? ` (${esc(task.params.watchlistName)})` : ""} · data to ${esc(r.asOf)}\n<b>Rising (${r.rising.length}):</b> ${r.rising.slice(0, 25).map((x) => `${esc(x.symbol)} ${esc(fmtPct(x.ret1M))}`).join(", ") || "none"}\n<b>Not rising (${r.notRising.length}):</b> ${r.notRising.slice(0, 25).map((x) => esc(x.symbol)).join(", ") || "none"}\n<i>${esc(r.rule)}</i>`;
    if (task.kind === "screen") return `${h} · ${r.total} match${r.total === 1 ? "" : "es"} (data to ${esc(r.asOf)})\n${r.results.slice(0, 20).map((x) => `• ${esc(x.symbol)} — ${esc(x.name)} (${esc(x.country)})`).join("\n")}${r.link ? `\n<a href="${r.link}">Open in the screener</a>` : ""}`;
    if (task.kind === "summary") return `${h} · ${esc(r.scope)} to ${esc(r.asOf)}\nCW index 1W ${esc(fmtPct(r.cwIndex.chg1W))}, 1M ${esc(fmtPct(r.cwIndex.chg1M))}${r.breadth ? `\n${r.breadth.pctAbove50d}% above 50-day EMA; ${r.breadth.newHighs} new highs, ${r.breadth.newLows} new lows` : ""}${r.regime ? `\nRegime: ${esc(r.regime.label)}` : ""}`;
    if (task.kind === "analyze") return r.ambiguous ? `${h}\nSeveral matches: ${r.candidates.map((c) => esc(`${c.symbol} (${c.country})`)).join(", ")}` : `${h}\n${esc(r.instrument.symbol)} · ${esc(r.stage.label)} · weekly MMA ${esc(r.timeframes.weekly?.mma)} · 3M ${esc(fmtPct(r.returnsLocalPct?.["3M"]))}${r.links.page ? `\n<a href="${r.links.page}">Open</a>` : ""}`;
    return `${h}\n<pre>${esc(JSON.stringify(r, null, 1).slice(0, 3000))}</pre>`;
  }

  async function runOne(task) {
    const { rows: u } = await pool.query(`select telegram_chat_id from tas_user where id = $1`, [task.user_id]);
    const chat = u[0]?.telegram_chat_id && telegram.enabled ? u[0].telegram_chat_id : null;
    const progress = async (n) => { await pool.query(`update tas_task set progress = $2, updated_at = now() where id = $1`, [task.id, n]); };
    if (chat && !task.schedule) await telegram.send(chat, `⏳ Working on: <b>${esc(task.title)}</b>`).catch(() => {});
    try {
      const r = await execute(task, progress);
      const nr = task.schedule ? nextRun(task.schedule) : null;
      await pool.query(`update tas_task set status = $2, progress = 100, result = $3, error = null, last_run = now(), next_run = coalesce($4, next_run), updated_at = now() where id = $1`,
        [task.id, nr ? "pending" : "done", JSON.stringify(r), nr]);
      if (chat) await telegram.send(chat, render(task, r)).catch((e) => log(`[tasks] telegram: ${e.message}`));
      return r;
    } catch (e) {
      const nr = task.schedule ? nextRun(task.schedule) : null;
      await pool.query(`update tas_task set status = $2, error = $3, last_run = now(), next_run = coalesce($4, next_run), updated_at = now() where id = $1`, [task.id, nr ? "pending" : "failed", e.message, nr]);
      if (chat) await telegram.send(chat, `⚠️ <b>${esc(task.title)}</b> failed: ${esc(e.message)}`).catch(() => {});
      return { error: e.message };
    }
  }

  async function tick() {
    let ran = 0;
    for (;;) {
      const { rows } = await pool.query(
        `update tas_task set status = 'running', updated_at = now() where id = (
           select id from tas_task where status = 'pending' and next_run <= now() order by next_run limit 1 for update skip locked) returning *`);
      if (!rows.length) break;
      await runOne(rows[0]); ran++;
      if (ran >= 20) break;
    }
    // a task stuck in "running" for 30 min (process died) goes back to pending
    await pool.query(`update tas_task set status = 'pending' where status = 'running' and updated_at < now() - interval '30 minutes'`);
    return { ran };
  }

  async function list(userId) { const { rows } = await pool.query(`select * from tas_task where user_id = $1 order by created_at desc limit 200`, [userId]); return rows; }
  async function update(userId, id, patch) {
    const sets = [], vals = [id, userId];
    if (patch.status === "paused" || patch.status === "pending") { vals.push(patch.status); sets.push(`status = $${vals.length}`); }
    if ("schedule" in patch) { if (patch.schedule) nextRun(patch.schedule); vals.push(patch.schedule || null); sets.push(`schedule = $${vals.length}`); vals.push(patch.schedule ? nextRun(patch.schedule) : new Date()); sets.push(`next_run = $${vals.length}`); }
    if (patch.title) { vals.push(patch.title); sets.push(`title = $${vals.length}`); }
    if (patch.runNow) { sets.push(`status = 'pending'`, `next_run = now()`); }
    if (!sets.length) return null;
    const { rows } = await pool.query(`update tas_task set ${sets.join(", ")}, updated_at = now() where id = $1 and user_id = $2 returning *`, vals);
    return rows[0] || null;
  }
  async function remove(userId, id) { const r = await pool.query(`delete from tas_task where id = $1 and user_id = $2`, [id, userId]); return r.rowCount > 0; }

  return { create, tick, list, update, remove, runOne, render };
}
