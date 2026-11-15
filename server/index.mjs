// GQ Technical Analysis server (Railway, ONE replica is enough; two are safe).
//
//   Web app      /api/*  with a Supabase login (gquants.com allow-list)
//   GQ agent     /api/*  with x-ta-secret (+ x-telegram-user for "me")
//   Background   alerts every ALERT_POLL_MINUTES, tasks + digests every minute
//
// It reads the engine's tas_* tables and the heatmap's price_history, and
// writes only its own per-user tables (tas_user*, tas_alert_event, tas_task,
// tas_push_sub, tas_digest_log). It never writes a heatmap-owned table.
import http from "node:http";
import pg from "pg";
import { loadConfig } from "./lib/config.mjs";
import { createRouter, readJson, cors, send, HttpError, RateLimiter } from "./lib/http.mjs";
import { createAuth } from "./lib/auth.mjs";
import { createTelegram } from "./lib/telegram.mjs";
import { createPush } from "./lib/push.mjs";
import { createData } from "./lib/data.mjs";
import { createAnalysis } from "./lib/analysis.mjs";
import { createUserData, DOC_KEYS, findWatchlist } from "./lib/userdata.mjs";
import { createAlertEngine } from "./lib/alerts.mjs";
import { createDigests } from "./lib/digests.mjs";
import { createTasks, TASK_KINDS } from "./lib/tasks.mjs";
import { createScorecard } from "./lib/scorecard.mjs";
import { createAgentProxy } from "./lib/agent.mjs";
import { createFo, foConfig } from "./lib/fo.mjs";
import { runXasset } from "../cli/xassetJob.mjs";
import { RULES, DEFAULT_PARAMS, normalizeParams, describeRule, evaluateRule } from "../engine/rules.js";
import { ALERT_TEMPLATES } from "../engine/alerts.js";
import { FIELD } from "../engine/fields.js";

const log = (m) => console.log(`${new Date().toISOString().slice(0, 19)} ${m}`);

export async function createServer(cfg = loadConfig(), deps = {}) {
  if (!cfg.databaseUrl && !deps.pool) throw new Error("DATABASE_URL is not set (Supabase -> Project settings -> Database -> connection string, Session pooler).");
  const pool = deps.pool || new pg.Pool({ connectionString: cfg.databaseUrl, max: 8, ssl: /localhost|127\.0\.0\.1/.test(cfg.databaseUrl) ? false : { rejectUnauthorized: false } });
  const fetchImpl = deps.fetch || fetch;
  const auth = createAuth(cfg, pool, fetchImpl);
  const telegram = createTelegram(cfg, fetchImpl, log);
  const push = await createPush(cfg, pool, log);
  const data = createData(pool, log);
  const analysis = createAnalysis(data, cfg);
  const userdata = createUserData(pool);
  const alerts = createAlertEngine({ cfg, pool, data, telegram, push, log });
  const digests = createDigests({ cfg, pool, data, analysis, telegram, log });
  const tasks = createTasks({ pool, analysis, userdata, telegram, log });
  const scorecard = createScorecard({ data });
  const agentProxy = createAgentProxy({ cfg, data, fetchImpl, log });
  const fo = deps.fo || createFo({ pool, log, fetchImpl, cfg: foConfig(cfg.env || process.env) });
  const limiter = new RateLimiter(cfg.rateLimitPerMin);
  const r = createRouter();

  // Who is "me" for this request. Agent calls without a linked user get null.
  const needUser = async (req) => {
    const a = await auth.any(req);
    if (!a.user) throw new HttpError(403, a.agent ? `This Telegram account is not linked to the Technical Analysis app. Open the app -> Alerts -> Telegram and send the bot "/ta link <code>".` : "sign in required");
    return a.user;
  };
  const q = (url, k, d = null) => url.searchParams.get(k) ?? d;

  // ------------------------------------------------------------- health / meta
  r.get("/health", async () => {
    let db = false, asOf = null;
    try { await pool.query("select 1"); db = true; const s = await data.get(); asOf = s.info.asOf; } catch { /* reported below */ }
    const f = fo.status();
    return { ok: db, db, dataAsOf: asOf, telegram: telegram.enabled, push: push.enabled, agent: agentProxy.connected(), jobs: cfg.jobsEnabled, fo: { enabled: f.enabled, running: f.running, last: f.last && { at: f.last.at, done: f.last.done.map((x) => `${x.date}:${x.status}`) } } };
  });
  r.get("/api/me", async (req) => {
    const u = await auth.web(req);
    return { ...u, telegramBot: cfg.telegramBotUsername, pushKey: push.publicKey, agentConnected: agentProxy.connected() };
  });
  r.get("/api/meta", async () => ({
    rules: Object.fromEntries(Object.entries(RULES).map(([k, v]) => [k, { label: describeRule(k, DEFAULT_PARAMS[k]), group: v.group, params: DEFAULT_PARAMS[k] || {} }])),
    templates: ALERT_TEMPLATES.map((t) => ({ id: t.id, name: t.name, desc: t.desc })), taskKinds: TASK_KINDS,
    fields: Object.keys(FIELD).length,
  }));

  // ------------------------------------------------------------- user documents
  r.get("/api/docs", async (req) => userdata.allDocs((await auth.web(req)).id));
  r.put("/api/docs/:key", async (req, { key }) => {
    const u = await auth.web(req);
    if (!DOC_KEYS.test(key)) throw new HttpError(400, `unknown document ${key}`);
    const body = await readJson(req, 2_000_000);
    return { key, value: await userdata.putDoc(u.id, key, body.value) };
  });
  r.patch("/api/settings", async (req) => {
    const u = await auth.web(req);
    const b = await readJson(req);
    const allowed = ["morningSummary", "weeklySummary", "alertsPaused"];
    return userdata.updateSettings(u.id, Object.fromEntries(Object.entries(b).filter(([k]) => allowed.includes(k)).map(([k, v]) => [k, !!v])));
  });

  // ------------------------------------------------------------- telegram link
  r.post("/api/telegram/code", async (req) => {
    const u = await auth.web(req);
    const code = await userdata.linkCode(u.id);
    return { code, expiresInMinutes: 15, instruction: `Open @${cfg.telegramBotUsername} on Telegram and send: /ta link ${code}`, deepLink: `https://t.me/${cfg.telegramBotUsername}` };
  });
  r.post("/api/telegram/link", async (req) => { // called by the GQ agent
    await auth.agent(req);
    const b = await readJson(req);
    if (!b.code || !b.telegramUserId || !b.chatId) throw new HttpError(400, "code, telegramUserId and chatId are required");
    const u = await userdata.claimCode(b.code, b.telegramUserId, b.chatId, b.name);
    if (!u) throw new HttpError(404, "That code is wrong or has expired. Get a new one in the app (Alerts -> Telegram).");
    return { ok: true, email: u.email, name: u.name };
  });
  r.post("/api/telegram/unlink", async (req) => {
    const a = await auth.any(req);
    if (a.user) { await userdata.unlink(a.user.id); return { ok: true }; }
    throw new HttpError(404, "not linked");
  });
  r.post("/api/telegram/test", async (req) => {
    const u = await auth.web(req);
    const { rows } = await pool.query(`select * from tas_user where id = $1`, [u.id]);
    const out = await alerts.sendTest(rows[0]);
    if (out.error) throw new HttpError(400, out.error);
    return out;
  });

  // ------------------------------------------------------------- alerts
  const ruleList = async (u) => userdata.getDoc(u.id, "alerts.rules", []);
  r.get("/api/alerts/rules", async (req) => {
    const u = await needUser(req);
    const rules = await ruleList(u);
    return rules.map((x) => ({ ...x, description: x.kind === "indicator" ? `${describeRule(x.rule, x.params)} (${x.tf || "D"})` : x.name }));
  });
  r.post("/api/alerts/rules", async (req) => {
    const u = await needUser(req);
    const b = await readJson(req);
    const rules = await ruleList(u);
    const wls = await userdata.getDoc(u.id, "watchlists", {});
    let rule;
    if (b.rule) {
      if (!RULES[b.rule]) throw new HttpError(400, `unknown rule ${b.rule}; one of ${Object.keys(RULES).join(", ")}`);
      const norm = normalizeParams(b.rule, b.params);
      if (norm.error) throw new HttpError(400, norm.error);
      const tf = ["D", "W", "M"].includes(String(b.tf || "D").toUpperCase()) ? String(b.tf || "D").toUpperCase() : null;
      if (!tf) throw new HttpError(400, "tf must be D, W or M");
      let target;
      if (b.watchlist) { const wl = findWatchlist(wls, b.watchlist); if (!wl) throw new HttpError(404, `watchlist "${b.watchlist}" not found`); target = { watchlistId: wl.id, watchlistName: wl.name }; }
      else {
        const c = await data.resolve(b.instrument || b.instrumentId);
        if (!c.length) throw new HttpError(404, `no instrument matches "${b.instrument || b.instrumentId}"`);
        if (c.length > 1 && !c.every((x) => x.symbol === c[0].symbol)) return { ambiguous: true, candidates: c.map((x) => ({ id: x.id, symbol: x.symbol, name: x.name, country: x.country })) };
        target = { instrumentId: c[0].id, symbol: c[0].symbol };
      }
      rule = { id: `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, kind: "indicator", rule: b.rule, params: norm.params, tf, target, enabled: true, name: `${target.symbol || target.watchlistName}: ${describeRule(b.rule, norm.params)} (${tf})`, createdAt: new Date().toISOString(), source: b.source || "web" };
    } else if (b.template) {
      if (b.template !== "custom" && !ALERT_TEMPLATES.some((t) => t.id === b.template)) throw new HttpError(400, "unknown template");
      for (const c of b.conditions || []) if (!FIELD[c.field]) throw new HttpError(400, `unknown field ${c.field}`);
      rule = { id: `t${Date.now().toString(36)}`, template: b.template, conditions: b.conditions, universe: b.universe || {}, enabled: true, name: b.name || ALERT_TEMPLATES.find((t) => t.id === b.template)?.name || "Custom rule" };
    } else throw new HttpError(400, "give either rule (+ instrument or watchlist) or template");
    await userdata.putDoc(u.id, "alerts.rules", [...rules, rule]);
    return rule;
  });
  r.patch("/api/alerts/rules/:id", async (req, { id }) => {
    const u = await needUser(req);
    const b = await readJson(req);
    const rules = await ruleList(u);
    const i = rules.findIndex((x) => x.id === id || x.name?.toLowerCase() === id.toLowerCase());
    if (i < 0) throw new HttpError(404, "no such alert");
    if ("enabled" in b) rules[i].enabled = !!b.enabled;
    if (b.name) rules[i].name = String(b.name).slice(0, 120);
    await userdata.putDoc(u.id, "alerts.rules", rules);
    return rules[i];
  });
  r.delete("/api/alerts/rules/:id", async (req, { id }) => {
    const u = await needUser(req);
    const rules = await ruleList(u);
    const next = rules.filter((x) => x.id !== id);
    if (next.length === rules.length) throw new HttpError(404, "no such alert");
    await userdata.putDoc(u.id, "alerts.rules", next);
    return { ok: true };
  });
  r.post("/api/alerts/pause", async (req) => { const u = await needUser(req); const b = await readJson(req); return userdata.updateSettings(u.id, { alertsPaused: b.paused !== false }); });
  r.get("/api/alerts/events", async (req, _, url) => {
    const u = await needUser(req);
    const { rows } = await pool.query(`select id, rule_id, instrument_id, bar_key, fired_at, payload, delivered from tas_alert_event where user_id = $1 and instrument_id <> '__seed__' and not (delivered ? 'seeded') order by fired_at desc limit $2`, [u.id, Math.min(+q(url, "limit", 200) || 200, 500)]);
    const st = await data.get();
    return rows.map((e) => ({ ...e, symbol: st.secById.get(e.instrument_id)?.symbol || e.instrument_id }));
  });
  r.post("/api/alerts/check", async (req) => { // "does this rule hold on this instrument right now?"
    await auth.any(req);
    const b = await readJson(req);
    const c = await data.resolve(b.instrument);
    if (!c.length) throw new HttpError(404, "instrument not found");
    const bars = await data.api.bars(c[0].id);
    return { symbol: c[0].symbol, ...evaluateRule(b.rule, b.params, bars, b.tf || "D") };
  });
  r.post("/api/alerts/run", async (req) => { const u = await auth.web(req); if (!u.isAdmin) throw new HttpError(403, "admins only"); return alerts.tick(); });
  r.get("/api/alerts/scorecard", async (req, _, url) => {
    await auth.any(req);
    const ids = q(url, "ids") ? q(url, "ids").split(",") : null;
    return scorecard.card({ rule: q(url, "rule"), params: JSON.parse(q(url, "params", "{}")), tf: q(url, "tf", "D"), ids, sample: Math.min(+q(url, "sample", 150) || 150, 500) });
  });

  // ------------------------------------------------------------- watchlists (agent)
  r.get("/api/watchlists", async (req) => {
    const u = await needUser(req);
    const wls = await userdata.getDoc(u.id, "watchlists", {});
    const st = await data.get();
    return Object.entries(wls).map(([id, l]) => ({ id, name: l.name, count: l.ids.length, symbols: l.ids.map((x) => st.secById.get(x)?.symbol || x) }));
  });
  r.post("/api/watchlists", async (req) => {
    const u = await needUser(req);
    const b = await readJson(req);
    const wls = await userdata.getDoc(u.id, "watchlists", {});
    let wl = findWatchlist(wls, b.watchlist);
    if (b.action === "create") {
      if (wl) throw new HttpError(409, `a list called "${wl.name}" already exists`);
      const id = `w${Date.now().toString(36)}`;
      wls[id] = { name: String(b.watchlist).slice(0, 60), ids: [], weights: {} };
      wl = { id, ...wls[id] };
    }
    if (!wl) throw new HttpError(404, `watchlist "${b.watchlist}" not found; existing: ${Object.values(wls).map((x) => x.name).join(", ") || "none"}`);
    const changed = [], unknown = [], ambiguous = [];
    for (const s of b.symbols || []) {
      const c = await data.resolve(s);
      if (!c.length) { unknown.push(s); continue; }
      if (c.length > 1 && !c.every((x) => x.symbol === c[0].symbol)) { ambiguous.push({ query: s, candidates: c.slice(0, 5).map((x) => `${x.symbol} (${x.country}, ${x.name})`) }); continue; }
      const id = c[0].id, list = wls[wl.id].ids;
      if (b.action === "remove") { if (list.includes(id)) { wls[wl.id].ids = list.filter((x) => x !== id); changed.push(c[0].symbol); } }
      else if (!list.includes(id)) { list.push(id); changed.push(c[0].symbol); }
    }
    if (b.action === "delete") delete wls[wl.id];
    await userdata.putDoc(u.id, "watchlists", wls);
    return { watchlist: wl.name, action: b.action, changed, unknown, ambiguous, size: wls[wl.id]?.ids.length ?? 0 };
  });

  // ------------------------------------------------------------- tasks
  r.get("/api/tasks", async (req) => tasks.list((await needUser(req)).id));
  r.post("/api/tasks", async (req) => {
    const a = await auth.any(req);
    if (!a.user) throw new HttpError(403, "link Telegram to the app first");
    const b = await readJson(req);
    try { return await tasks.create(a.user.id, { ...b, source: a.agent ? "telegram" : "web" }); }
    catch (e) { throw new HttpError(e.status || 400, e.message); }
  });
  r.patch("/api/tasks/:id", async (req, { id }) => {
    const u = await needUser(req);
    try { const t = await tasks.update(u.id, id, await readJson(req)); if (!t) throw new HttpError(404, "no such task"); return t; }
    catch (e) { throw e instanceof HttpError ? e : new HttpError(400, e.message); }
  });
  r.delete("/api/tasks/:id", async (req, { id }) => { const u = await needUser(req); if (!(await tasks.remove(u.id, id))) throw new HttpError(404, "no such task"); return { ok: true }; });

  // ------------------------------------------------------------- push
  r.get("/api/push/key", async () => ({ publicKey: push.publicKey }));
  r.post("/api/push/subscribe", async (req) => {
    const u = await auth.web(req);
    const b = await readJson(req);
    if (!b.endpoint || !b.keys) throw new HttpError(400, "endpoint and keys required");
    await pool.query(`insert into tas_push_sub (user_id, endpoint, keys) values ($1,$2,$3) on conflict (endpoint) do update set user_id = excluded.user_id, keys = excluded.keys`, [u.id, b.endpoint, JSON.stringify(b.keys)]);
    return { ok: true };
  });
  r.post("/api/push/test", async (req) => { const u = await auth.web(req); return push.notify(u.id, { title: "GQ XRayDar", body: "Notifications are working on this device.", url: "/#/alerts" }); });

  // ------------------------------------------------------------- analysis (web + agent)
  r.get("/api/resolve", async (req, _, url) => { await auth.any(req); return (await data.resolve(q(url, "q"))).map((x) => ({ id: x.id, symbol: x.symbol, name: x.name, country: x.country, exchange: x.exchange, assetClass: x.assetClass })); });
  r.get("/api/stock/:ref", async (req, { ref }) => { await auth.any(req); return analysis.stock(ref); });
  r.get("/api/chart-read/:id", async (req, { id }, url) => {
    await auth.any(req);
    let iid = id;
    if (!(await data.get()).secById.has(id)) { const c = await data.resolve(id); if (!c.length) throw new HttpError(404, "instrument not found"); iid = c[0].id; }
    return analysis.chartRead(iid, { tfs: (q(url, "tfs") || "D,W").split(",").filter((x) => /^[DWMQY]$/.test(x)), mode: q(url, "mode") });
  });
  r.get("/api/compare", async (req, _, url) => { await auth.any(req); return analysis.compare(q(url, "a"), q(url, "b")); });
  r.post("/api/screen", async (req) => { await auth.any(req); return analysis.screen(await readJson(req)); });
  r.get("/api/market", async (req, _, url) => { await auth.any(req); return analysis.market(q(url, "scope", "G")); });
  r.post("/api/review", async (req) => {
    const a = await auth.any(req);
    const b = await readJson(req);
    let ids = b.ids;
    if (!ids && b.watchlist) {
      if (!a.user) throw new HttpError(403, "link Telegram to the app to use your watchlists");
      const wl = findWatchlist(await userdata.getDoc(a.user.id, "watchlists", {}), b.watchlist);
      if (!wl) throw new HttpError(404, `watchlist "${b.watchlist}" not found`);
      ids = wl.ids;
    }
    if (!ids && b.symbols) { ids = []; for (const s of b.symbols) { const c = await data.resolve(s); if (c[0]) ids.push(c[0].id); } }
    if (!ids?.length) throw new HttpError(400, "give a watchlist, symbols or ids");
    return analysis.review(ids, b.question);
  });
  r.get("/api/signal-stats", async (req) => { await auth.any(req); return data.api.backtestSummary(); });
  r.get("/api/brief", async (req, _, url) => { await auth.any(req); const p = q(url, "period", "daily"); return digests.briefText(["daily", "weekly"].includes(p) ? p : "daily"); });
  r.post("/api/agent/chat", async (req) => {
    const u = await auth.web(req);
    const b = await readJson(req, 200_000);
    if (!b.message) throw new HttpError(400, "message required");
    return agentProxy.chat({ message: String(b.message).slice(0, 4000), history: b.history, context: b.context, user: u });
  });

  // ------------------------------------------------------------- derivatives (F&O end-of-day collector)
  r.get("/api/fo/status", async (req) => { await auth.any(req); return fo.status(); });
  r.post("/api/fo/run", async (req) => {
    const a = await auth.any(req);
    if (!a.agent && !a.user?.isAdmin) throw new HttpError(403, "admins only");
    return fo.tick();
  });

  // ------------------------------------------------------------- HTTP plumbing
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    cors(req, res, cfg.appOrigins);
    if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
    const m = r.match(req.method, url.pathname);
    if (!m) return send(res, 404, { error: "not found" });
    try {
      if (url.pathname !== "/health") limiter.check(req.headers["x-telegram-user"] || req.headers.authorization || req.socket.remoteAddress);
      const out = await m.handler(req, m.params, url);
      send(res, 200, out ?? { ok: true });
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) log(`[http] ${req.method} ${url.pathname}: ${e.stack || e.message}`);
      send(res, status, { error: status >= 500 && !e.status ? "internal error" : e.message });
    }
  });

  // ------------------------------------------------------------- background jobs
  const timers = [];
  let busy = { alerts: false, minute: false };
  const guard = (k, fn) => async () => { if (busy[k]) return; busy[k] = true; try { await fn(); } catch (e) { log(`[jobs] ${k}: ${e.message}`); } finally { busy[k] = false; } };
  function startJobs() {
    if (!cfg.jobsEnabled) { log("[jobs] JOBS_ENABLED=false: alerts, digests and tasks will not run here"); return; }
    timers.push(setInterval(guard("alerts", () => alerts.tick()), cfg.alertPollMinutes * 60_000));
    timers.push(setInterval(guard("minute", async () => { await tasks.tick(); await digests.tick(); }), 60_000));
    setTimeout(guard("alerts", () => alerts.tick()), 20_000);
    // Cross-asset series: refreshed when older than 20 hours (checked every 3 hours).
    const xasset = async () => {
      const { rows } = await pool.query(`select max(updated_at) t from tas_xasset`).catch(() => ({ rows: [] }));
      if (rows[0]?.t && Date.now() - new Date(rows[0].t).getTime() < 20 * 3600_000) return;
      await runXasset(pool, { log, fetchImpl });
    };
    timers.push(setInterval(guard("xasset", xasset), 3 * 3600_000));
    setTimeout(guard("xasset", xasset), 90_000);
    const foCfg = fo.status().cfg;
    if (foCfg.enabled) {
      timers.push(setInterval(guard("fo", () => fo.tick()), foCfg.pollMinutes * 60_000));
      setTimeout(guard("fo", () => fo.tick()), 45_000);
      log(`[jobs] F&O collector every ${foCfg.pollMinutes} min (backfill ${foCfg.backfill} sessions, chains kept ${foCfg.keepChains})`);
    }
    log(`[jobs] alerts every ${cfg.alertPollMinutes} min; tasks + digests every minute (morning ${cfg.morningSummaryTime} IST weekdays, weekly ${cfg.weeklySummaryTime} IST)`);
  }
  async function close() { timers.forEach(clearInterval); await new Promise((res) => server.close(res)); if (!deps.pool) await pool.end(); }

  return { server, pool, startJobs, close, alerts, tasks, digests, data, analysis, fo };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cfg = loadConfig();
  const app = await createServer(cfg);
  app.server.listen(cfg.port, () => log(`[server] listening on ${cfg.port}; auth=${cfg.authMode}; telegram=${!!cfg.telegramToken}; agent=${cfg.agentUrl || "built-in"}`));
  app.startJobs();
  const stop = () => { log("[server] shutting down"); app.close().finally(() => process.exit(0)); setTimeout(() => process.exit(0), 8000).unref(); };
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
}
