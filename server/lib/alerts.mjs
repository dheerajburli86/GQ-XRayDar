// Alert engine. Two kinds of rule, both stored in each user's "alerts.rules"
// document so the web app, the agent and this engine share one list:
//
//   indicator  {kind:"indicator", rule, params, tf, target:{instrumentId|watchlistId}}
//              the 17 single-indicator rules; fires on an EDGE of its candle
//   template   {template:"rsc_mma"|...|"custom", conditions?, universe}
//              multi-condition screens on the stored snapshot
//
// A (user, rule, instrument, candle) fires once: the UNIQUE key on
// tas_alert_event is the de-duplication, and the event row is written BEFORE
// anything is sent, so a crash or a second replica can never double-send.
// A template rule's first evaluation is a silent seed: conditions that already
// hold when the rule is created are recorded, not announced.
import { evaluateRule, describeRule, RULES } from "../../engine/rules.js";
import { evaluateAlerts } from "../../engine/alerts.js";
import { esc } from "./telegram.mjs";

const TF = { D: "daily", W: "weekly", M: "monthly" };

export function createAlertEngine({ cfg, pool, data, telegram, push, log = console.log }) {
  async function users() {
    const { rows } = await pool.query(
      `select u.*, r.value as rules, w.value as watchlists
         from tas_user u join tas_user_doc r on r.user_id = u.id and r.key = 'alerts.rules'
         left join tas_user_doc w on w.user_id = u.id and w.key = 'watchlists'`);
    return rows;
  }

  async function record(userId, ruleId, instrumentId, barKey, payload, silent = false) {
    const { rows } = await pool.query(
      `insert into tas_alert_event (user_id, rule_id, instrument_id, bar_key, payload, delivered)
       values ($1, $2, $3, $4, $5, $6) on conflict (user_id, rule_id, instrument_id, bar_key) do nothing returning id`,
      [userId, ruleId, instrumentId || "", barKey, JSON.stringify(payload), JSON.stringify(silent ? { seeded: true } : {})]);
    return rows[0]?.id || null;
  }

  async function seeded(userId, ruleId) {
    const { rows } = await pool.query(`select 1 from tas_alert_event where user_id = $1 and rule_id = $2 and instrument_id = '__seed__' limit 1`, [userId, ruleId]);
    return rows.length > 0;
  }

  async function deliver(user, fired) {
    if (!fired.length) return;
    const lines = fired.slice(0, 25).map((f) => `• <b>${esc(f.symbol)}</b> ${esc(f.text)}${f.value != null ? ` <i>(${esc(f.value)})</i>` : ""}${f.asOf ? ` · ${esc(f.asOf)}` : ""}`);
    const more = fired.length > 25 ? `\n…and ${fired.length - 25} more in the app` : "";
    const html = `🔔 <b>${fired.length} new alert${fired.length > 1 ? "s" : ""}</b>\n${lines.join("\n")}${more}${cfg.appUrl ? `\n\n<a href="${cfg.appUrl}/#/alerts">Open alerts</a>` : ""}\n<i>Signals from stored data, not recommendations.</i>`;
    const status = {};
    if (user.telegram_chat_id && telegram.enabled) {
      try { await telegram.send(user.telegram_chat_id, html); status.telegram = new Date().toISOString(); } catch (e) { status.telegram = `error: ${e.message}`; log(`[alerts] telegram to ${user.email}: ${e.message}`); }
    }
    if (push.enabled) {
      try { const r = await push.notify(user.id, { title: `${fired.length} new alert${fired.length > 1 ? "s" : ""}`, body: fired.slice(0, 4).map((f) => `${f.symbol}: ${f.text}`).join("\n"), url: "/#/alerts" }); status.push = r.sent ? new Date().toISOString() : "no device"; }
      catch (e) { status.push = `error: ${e.message}`; }
    }
    await pool.query(`update tas_alert_event set delivered = delivered || $2::jsonb where id = any($1)`, [fired.map((f) => f.eventId), JSON.stringify(status)]);
  }

  async function tick() {
    const st = await data.get();
    const list = await users();
    const barCache = new Map();
    let total = 0;
    for (const u of list) {
      if (u.settings?.alertsPaused) continue;
      const rules = Array.isArray(u.rules) ? u.rules.filter((r) => r.enabled !== false) : [];
      const wls = u.watchlists || {};
      const fired = [];
      // ---- indicator rules (edge on the newest candle) ----
      const ind = rules.filter((r) => r.kind === "indicator" && RULES[r.rule]);
      const targets = new Map();
      for (const r of ind) {
        const ids = r.target?.instrumentId ? [r.target.instrumentId] : (wls[r.target?.watchlistId]?.ids || []);
        targets.set(r.id, ids.slice(0, cfg.alertMaxInstruments));
      }
      const need = [...new Set([...targets.values()].flat())].filter((id) => !barCache.has(id));
      if (need.length) { const m = await data.api.barsMany(need, "2010-01-01"); for (const id of need) barCache.set(id, m.get(id) || null); }
      for (const r of ind) {
        for (const id of targets.get(r.id)) {
          const b = barCache.get(id);
          if (!b) continue;
          const ev = evaluateRule(r.rule, r.params, b, r.tf || "D");
          if (!ev.ok || !ev.fired) continue;
          // stale-data guard: never announce a candle older than 7 days
          if ((Date.now() - Date.parse(ev.barTime)) / 86400000 > 7) continue;
          const sec = st.secById.get(id);
          const text = `${describeRule(r.rule, r.params)} (${TF[r.tf || "D"]})`;
          const eventId = await record(u.id, r.id, id, `${r.tf || "D"}:${ev.barKey}`, { rule: r.rule, params: r.params, tf: r.tf, text, value: ev.value, close: ev.close, barTime: ev.barTime });
          if (eventId) fired.push({ eventId, symbol: sec?.symbol || id, text, value: ev.value != null ? Math.round(ev.value * 100) / 100 : null, asOf: ev.barTime });
        }
      }
      // ---- template / custom rules on the snapshot ----
      const tmpl = rules.filter((r) => r.kind !== "indicator");
      if (tmpl.length) {
        let sectorCtx = null;
        if (tmpl.some((r) => r.template === "sector_rsc_ewcw")) {
          const { rows } = await pool.query(`select scope_key, sectors from tas_rotation`);
          sectorCtx = { rotation: Object.fromEntries(rows.map((x) => [x.scope_key, x.sectors])), ewcw: await data.api.ewcw() };
        }
        for (const r of tmpl) {
          const matches = evaluateAlerts([r], st.rows, wls, sectorCtx, st.info.asOf);
          const silent = !(await seeded(u.id, r.id));
          if (silent) await record(u.id, r.id, "__seed__", "seed", { seededAt: new Date().toISOString(), matches: matches.length }, true);
          for (const m of matches) {
            const eventId = await record(u.id, r.id, m.id || m.symbol, m.asOf || st.info.asOf, { template: r.template, text: m.detail, name: m.name }, silent);
            if (eventId && !silent) fired.push({ eventId, symbol: m.symbol, text: r.name || m.detail, asOf: m.asOf });
          }
        }
      }
      if (fired.length) { await deliver(u, fired); total += fired.length; }
    }
    if (total) log(`[alerts] ${total} new alert(s) delivered`);
    return { users: list.length, fired: total };
  }

  async function sendTest(user) {
    if (!user.telegram_chat_id) return { error: "Telegram is not linked for this account" };
    await telegram.send(user.telegram_chat_id, "✅ <b>GQ Technical Analysis</b>\nTelegram alerts are working for your account.");
    return { ok: true };
  }

  return { tick, sendTest };
}
