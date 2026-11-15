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
import { DERIV_ALERT_RULES, evaluateDerivRule, marketView, positionView, PRIORITY_CHANNELS } from "../../engine/deriv/alerts.js";
import { decodeDay } from "../../engine/deriv/codec.js";
import { enrichChain } from "../../engine/deriv/chain.js";

const TF = { D: "daily", W: "weekly", M: "monthly" };

export function createAlertEngine({ cfg, pool, data, telegram, push, channels = null, log = console.log }) {
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

  const stats = { deliveries: 0, errors: {}, lastRun: null, lastDeriv: null };
  const hooks = { onFired: null };
  const allowed = (f, ch) => (PRIORITY_CHANNELS[f.priority || "normal"] || PRIORITY_CHANNELS.normal).includes(ch);
  async function deliver(user, firedAll) {
    if (!firedAll.length) return;
    try { hooks.onFired?.(user, firedAll); } catch { /* stream is best-effort */ }
    const fired = firedAll.filter((f) => allowed(f, "telegram") || allowed(f, "push"));
    const status = {};
    // webhook and email first: they carry every item their tier allows
    const hook = user.settings?.webhookUrl, hookItems = firedAll.filter((f) => allowed(f, "webhook"));
    if (hook && channels?.webhook && hookItems.length) {
      try { await channels.webhook.send(hook, { app: "GQ XRayDar", at: new Date().toISOString(), alerts: hookItems.map((f) => ({ symbol: f.symbol, text: f.text, value: f.value, asOf: f.asOf, priority: f.priority || "normal", kind: f.kind || "stock" })) }); status.webhook = new Date().toISOString(); }
      catch (e) { status.webhook = `error: ${e.message}`; stats.errors.webhook = (stats.errors.webhook || 0) + 1; }
    }
    const mailItems = firedAll.filter((f) => allowed(f, "email"));
    if (user.settings?.emailAlerts && channels?.email?.enabled && mailItems.length) {
      try { await channels.email.send(user.email, `GQ XRayDar: ${mailItems.length} alert${mailItems.length > 1 ? "s" : ""}`, mailItems.map((f) => `• ${f.symbol}: ${f.text}${f.value != null ? ` (${f.value})` : ""}${f.asOf ? ` · ${f.asOf}` : ""}`).join("\n") + "\n\nSignals from stored data, not recommendations."); status.email = new Date().toISOString(); }
      catch (e) { status.email = `error: ${e.message}`; stats.errors.email = (stats.errors.email || 0) + 1; }
    }
    if (!fired.length) { await pool.query(`update tas_alert_event set delivered = delivered || $2::jsonb where id = any($1)`, [firedAll.map((f) => f.eventId), JSON.stringify({ ...status, app: "only (low priority)" })]); return; }
    const lines = fired.slice(0, 25).map((f) => `• <b>${esc(f.symbol)}</b> ${esc(f.text)}${f.value != null ? ` <i>(${esc(f.value)})</i>` : ""}${f.asOf ? ` · ${esc(f.asOf)}` : ""}`);
    const more = fired.length > 25 ? `\n…and ${fired.length - 25} more in the app` : "";
    const html = `🔔 <b>${fired.length} new alert${fired.length > 1 ? "s" : ""}</b>\n${lines.join("\n")}${more}${cfg.appUrl ? `\n\n<a href="${cfg.appUrl}/#/alerts">Open alerts</a>` : ""}\n<i>Signals from stored data, not recommendations.</i>`;
    if (user.telegram_chat_id && telegram.enabled) {
      try { await telegram.send(user.telegram_chat_id, html); status.telegram = new Date().toISOString(); stats.deliveries++; } catch (e) { status.telegram = `error: ${e.message}`; stats.errors.telegram = (stats.errors.telegram || 0) + 1; log(`[alerts] telegram to ${user.email}: ${e.message}`); }
    }
    if (push.enabled) {
      try { const r = await push.notify(user.id, { title: `${fired.length} new alert${fired.length > 1 ? "s" : ""}`, body: fired.slice(0, 4).map((f) => `${f.symbol}: ${f.text}`).join("\n"), url: "/#/alerts" }); status.push = r.sent ? new Date().toISOString() : "no device"; }
      catch (e) { status.push = `error: ${e.message}`; }
    }
    await pool.query(`update tas_alert_event set delivered = delivered || $2::jsonb where id = any($1)`, [firedAll.map((f) => f.eventId), JSON.stringify(status)]);
  }

  // ---------------------------------------------------------------- derivatives
  async function derivContext(needChains) {
    const { rows: ds } = await pool.query(`select distinct date from tas_fo_stats order by date desc limit 2`).catch(() => ({ rows: [] }));
    if (!ds.length) return null;
    const dates = ds.map((x) => (x.date instanceof Date ? x.date.toISOString().slice(0, 10) : String(x.date).slice(0, 10)));
    const { rows } = await pool.query(`select date, und, s from tas_fo_stats where date = any($1::date[])`, [dates]);
    const cur = new Map(), prev = new Map();
    for (const r of rows) { const d = r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10); (d === dates[0] ? cur : prev).set(r.und, r.s); }
    const { rows: mk } = await pool.query(`select date, ban, mwpl from tas_fo_market order by date desc limit 2`).catch(() => ({ rows: [] }));
    const mkt = mk.map((m) => ({ ...m, date: m.date instanceof Date ? m.date.toISOString().slice(0, 10) : String(m.date).slice(0, 10) }));
    const chains = new Map();
    if (needChains.size) {
      const { rows: cs } = await pool.query(`select date, und, kind, spot, lot, data from tas_fo_chain where und = any($1) and date = any($2::date[])`, [[...needChains], dates]);
      for (const c of cs) { const d = c.date instanceof Date ? c.date.toISOString().slice(0, 10) : String(c.date).slice(0, 10); try { chains.set(`${c.und}|${d}`, enrichChain(decodeDay({ ...c, date: d }))); } catch { /* bad row */ } }
    }
    return { dates, cur, prev, market: mkt[0] || null, marketPrev: mkt[1] || null, chains };
  }

  async function onCooldown(userId, ruleId, inst, days) {
    if (!(days > 0)) return false;
    const { rows } = await pool.query(`select 1 from tas_alert_event where user_id = $1 and rule_id = $2 and instrument_id = $3 and fired_at > now() - ($4 || ' days')::interval and not (delivered ? 'seeded') limit 1`, [userId, ruleId, inst, String(days)]);
    return rows.length > 0;
  }

  async function derivTick() {
    const { rows: list } = await pool.query(`select u.*, r.value as rules, p.value as positions from tas_user u join tas_user_doc r on r.user_id = u.id and r.key = 'deriv.alerts' left join tas_user_doc p on p.user_id = u.id and p.key = 'deriv.positions'`);
    if (!list.length) return { users: 0, fired: 0 };
    const needChains = new Set();
    for (const u of list) for (const r of (Array.isArray(u.rules) ? u.rules : [])) if (DERIV_ALERT_RULES[r.rule]?.scope === "position") for (const p of (u.positions || [])) if (!r.target?.positionIds?.length || r.target.positionIds.includes(p.id)) needChains.add(p.und);
    const ctx = await derivContext(needChains);
    if (!ctx) return { users: list.length, fired: 0, note: "no F&O sessions stored" };
    let total = 0;
    for (const u of list) {
      if (u.settings?.alertsPaused || u.role === "viewer" || u.role === "disabled") continue;
      const rules = (Array.isArray(u.rules) ? u.rules : []).filter((r) => r.enabled !== false && DERIV_ALERT_RULES[r.rule]);
      const fired = [];
      for (const r of rules) {
        const R = DERIV_ALERT_RULES[r.rule];
        const silent = !(await seeded(u.id, r.id));
        if (silent) await record(u.id, r.id, "__seed__", "seed", { seededAt: new Date().toISOString() }, true);
        const targets = [];
        if (R.scope === "position") for (const p of (u.positions || [])) { if (r.target?.positionIds?.length && !r.target.positionIds.includes(p.id)) continue; const c = ctx.chains.get(`${p.und}|${ctx.dates[0]}`), cp = ctx.dates[1] ? ctx.chains.get(`${p.und}|${ctx.dates[1]}`) : null; if (c) targets.push({ key: `pos:${p.id}`, symbol: p.name, cur: positionView(p, c), prev: cp ? positionView(p, cp) : null }); }
        else {
          const unds = r.target?.unds?.length ? r.target.unds : [...ctx.cur.keys()].filter((x) => !r.target?.kind || ctx.cur.get(x)?.kind === r.target.kind);
          for (const und of unds) {
            if (R.scope === "market") { const cur = marketView(ctx.market, und); if (cur?.pct == null && !cur?.banned) continue; targets.push({ key: und, symbol: und, cur, prev: marketView(ctx.marketPrev, und) }); }
            else if (ctx.cur.has(und)) targets.push({ key: und, symbol: und, cur: ctx.cur.get(und), prev: ctx.prev.get(und) || null });
          }
        }
        for (const t of targets) {
          const ev = evaluateDerivRule(r.rule, r.params, t.cur, t.prev);
          if (!ev.fired) continue;
          if (!silent && await onCooldown(u.id, r.id, t.key, r.cooldownDays)) continue;
          const eventId = await record(u.id, r.id, t.key, `F:${ev.session || ctx.dates[0]}`, { kind: "deriv", rule: r.rule, params: r.params, text: ev.text, value: ev.value, session: ev.session }, silent);
          if (eventId && !silent) fired.push({ eventId, symbol: t.symbol, text: ev.text, value: ev.value, asOf: ev.session || ctx.dates[0], priority: r.priority || "normal", kind: "deriv" });
        }
      }
      if (fired.length) { await deliver(u, fired); total += fired.length; }
    }
    stats.lastDeriv = { at: new Date().toISOString(), session: ctx.dates[0], fired: total };
    if (total) log(`[alerts] ${total} derivatives alert(s) delivered for session ${ctx.dates[0]}`);
    return { users: list.length, fired: total, session: ctx.dates[0] };
  }

  async function tick() {
    const st = await data.get();
    const list = await users();
    const barCache = new Map();
    let total = 0;
    for (const u of list) {
      if (u.settings?.alertsPaused || u.role === "viewer" || u.role === "disabled") continue;
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
          if (eventId) fired.push({ eventId, symbol: sec?.symbol || id, text, value: ev.value != null ? Math.round(ev.value * 100) / 100 : null, asOf: ev.barTime, priority: r.priority || "normal" });
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
            if (eventId && !silent) fired.push({ eventId, symbol: m.symbol, text: r.name || m.detail, asOf: m.asOf, priority: r.priority || "normal" });
          }
        }
      }
      if (fired.length) { await deliver(u, fired); total += fired.length; }
    }
    if (total) log(`[alerts] ${total} new alert(s) delivered`);
    let deriv = null;
    try { deriv = await derivTick(); } catch (e) { log(`[alerts] derivatives: ${e.message}`); deriv = { error: e.message }; }
    stats.lastRun = { at: new Date().toISOString(), fired: total, deriv };
    return { users: list.length, fired: total, deriv };
  }

  async function sendTest(user) {
    if (!user.telegram_chat_id) return { error: "Telegram is not linked for this account" };
    await telegram.send(user.telegram_chat_id, "✅ <b>GQ XRayDar</b>\nTelegram alerts are working for your account.");
    return { ok: true };
  }

  return { tick, derivTick, sendTest, stats: () => stats, hooks };
}
