// End-to-end test of the TA server against a LOCAL Postgres that already holds
// an engine run (scripts/local-integration.mjs + cli/run.mjs + the tas_users
// migration). Skipped when TEST_DATABASE_URL is not set, so `npm test` stays
// self-contained. Telegram and Supabase are faked; nothing leaves the machine.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextRun } from "../server/lib/tasks.mjs";
import { istNow, weekKey } from "../server/lib/digests.mjs";

test("task schedules are IST wall-clock", () => {
  const from = new Date("2026-11-13T10:00:00Z"); // Fri 15:30 IST
  assert.equal(nextRun("daily 08:30", from).toISOString(), "2026-11-14T03:00:00.000Z");
  assert.equal(nextRun("weekdays 08:30", from).toISOString(), "2026-11-16T03:00:00.000Z"); // skips the weekend
  assert.equal(nextRun("weekly mon 09:15", from).toISOString(), "2026-11-16T03:45:00.000Z");
  assert.equal(nextRun(null), null);
  assert.throws(() => nextRun("every day"));
  assert.deepEqual(istNow(new Date("2026-11-13T20:00:00Z")), { date: "2026-11-14", hhmm: "01:30", dow: "sat" });
  assert.equal(weekKey("2026-11-13"), "2026-W46");
});

const DB = process.env.TEST_DATABASE_URL;
test("server: link, alerts, tasks, digests, agent fallback", { skip: !DB && "set TEST_DATABASE_URL to a local Postgres with an engine run" }, async () => {
  const { createServer } = await import("../server/index.mjs");
  const { loadConfig } = await import("../server/lib/config.mjs");
  const sent = [];
  const fakeFetch = async (url, init) => {
    if (String(url).includes("/sendMessage")) { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ ok: true, result: { message_id: sent.length } })); }
    throw new Error(`unexpected fetch ${url}`);
  };
  const cfg = { ...loadConfig({ DATABASE_URL: DB, AUTH_MODE: "dev", TA_API_SECRET: "s3cret", TELEGRAM_BOT_TOKEN: "123:abc", APP_URL: "https://ta.example", PORT: "0" }) };
  const app = await createServer(cfg, { fetch: fakeFetch });
  await app.pool.query(`delete from tas_user where email like '%@gquants.com'`);
  await new Promise((r) => app.server.listen(0, r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (method, path, body, headers = {}) => {
    const r = await fetch(base + path, { method, headers: { "content-type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json() };
  };
  const web = { "x-dev-email": "tester@gquants.com" };
  const agent = { "x-ta-secret": "s3cret", "x-telegram-user": "777" };
  try {
    assert.equal((await call("GET", "/health")).json.db, true);
    assert.equal((await call("GET", "/api/me", null, { "x-dev-email": "x@gmail.com" })).status, 403);
    assert.equal((await call("GET", "/api/me", null, web)).json.email, "tester@gquants.com");
    assert.equal((await call("GET", "/api/stock/AAA", null, { "x-ta-secret": "wrong" })).status, 401);

    // Telegram link: code from the web app, claimed by the agent
    assert.equal((await call("GET", "/api/watchlists", null, agent)).status, 403);
    const { code } = (await call("POST", "/api/telegram/code", null, web)).json;
    assert.match(code, /^\d{6}$/);
    assert.equal((await call("POST", "/api/telegram/link", { code, telegramUserId: "777", chatId: "777", name: "Tester" }, agent)).json.ok, true);
    assert.equal((await call("POST", "/api/telegram/link", { code, telegramUserId: "777", chatId: "777" }, agent)).status, 404); // single use

    // Analysis through the agent door
    const st = await app.data.get();
    const stock = st.rows.find((r) => r.sec.assetClass === "Stock");
    const a = (await call("GET", `/api/stock/${stock.sec.id}`, null, agent)).json;
    assert.equal(a.instrument.symbol, stock.sec.symbol);
    assert.ok(a.timeframes.weekly);
    assert.match((await call("GET", `/api/chart-read/${stock.sec.id}?tfs=D,W`, null, agent)).json.text, /Weekly/);
    const sc = (await call("POST", "/api/screen", { query: "weekly MMA bullish", limit: 5 }, agent)).json;
    assert.ok(sc.total >= 0 && Array.isArray(sc.results));
    assert.ok((await call("GET", "/api/market?scope=G", null, agent)).json.cwIndex);

    // Watchlist + indicator alert, created from Telegram, delivered on Telegram
    const syms = st.rows.filter((r) => r.sec.assetClass === "Stock").slice(0, 30).map((r) => r.sec.id);
    assert.equal((await call("POST", "/api/watchlists", { action: "create", watchlist: "Core", symbols: syms }, agent)).json.size, 30);
    const rule = (await call("POST", "/api/alerts/rules", { rule: "price_above", params: { price: 0.0001 }, tf: "D", watchlist: "core" }, agent)).json;
    assert.equal(rule.kind, "indicator");
    // price_above fires on an EDGE; a level of ~0 never crosses, so nothing fires
    let t = await app.alerts.tick();
    assert.equal(t.fired, 0);
    const bad = await call("POST", "/api/alerts/rules", { rule: "nope", instrument: stock.sec.symbol }, agent);
    assert.equal(bad.status, 400);
    // template rule: first evaluation is a silent seed
    await call("POST", "/api/alerts/rules", { template: "rsc_mma" }, agent);
    t = await app.alerts.tick();
    assert.equal(t.fired, 0, "first template evaluation must seed, not notify");
    assert.equal((await call("GET", "/api/alerts/events", null, web)).json.length, 0);
    // an event recorded once is never sent twice
    const id1 = await app.pool.query(`insert into tas_alert_event (user_id, rule_id, instrument_id, bar_key, payload) select id, 'x', 'i', 'b', '{}' from tas_user where telegram_user_id = '777' on conflict do nothing returning id`);
    const id2 = await app.pool.query(`insert into tas_alert_event (user_id, rule_id, instrument_id, bar_key, payload) select id, 'x', 'i', 'b', '{}' from tas_user where telegram_user_id = '777' on conflict do nothing returning id`);
    assert.equal(id1.rowCount, 1); assert.equal(id2.rowCount, 0);

    // An indicator rule whose edge is on the newest candle is delivered once
    const { evaluateRule, RULES } = await import("../engine/rules.js");
    let hit = null;
    for (const r of st.rows.slice(0, 120)) {
      const b = await app.data.api.bars(r.id);
      for (const k of Object.keys(RULES)) { const e = evaluateRule(k, k === "price_above" || k === "price_below" ? { price: b.close.at(-2) } : {}, b, "D"); if (e.ok && e.fired) { hit = { id: r.id, rule: k, params: k.startsWith("price_a") || k.startsWith("price_b") ? { price: b.close.at(-2) } : {} }; break; } }
      if (hit) break;
    }
    assert.ok(hit, "demo data should have at least one rule firing on the last candle");
    await call("POST", "/api/alerts/rules", { rule: hit.rule, params: hit.params, tf: "D", instrument: hit.id }, agent);
    sent.length = 0;
    assert.ok((await app.alerts.tick()).fired >= 1);
    assert.ok(sent.some((m) => /new alert/.test(m.text)));
    assert.equal((await app.alerts.tick()).fired, 0, "the same candle never alerts twice");
    const evs = (await call("GET", "/api/alerts/events", null, web)).json;
    assert.ok(evs.length >= 1 && evs[0].delivered.telegram);

    // Scorecard
    const card = (await call("GET", "/api/alerts/scorecard?rule=golden_cross&tf=D&sample=40", null, agent)).json;
    assert.equal(card.direction, "up");
    assert.equal(card.summary.length, 3);

    // Tasks: run-once task reports on Telegram
    sent.length = 0;
    const task = (await call("POST", "/api/tasks", { kind: "review_list", title: "Review core", params: { watchlist: "Core" } }, agent)).json;
    assert.equal(task.status, "pending");
    await app.tasks.tick();
    const done = (await call("GET", "/api/tasks", null, web)).json.find((x) => x.id === task.id);
    assert.equal(done.status, "done");
    assert.ok(sent.some((m) => /Review core/.test(m.text)));
    const rec = (await call("POST", "/api/tasks", { kind: "summary", schedule: "weekdays 08:30", params: { scope: "G" } }, agent)).json;
    assert.ok(new Date(rec.next_run) > new Date());

    // Digests: once per period per user
    sent.length = 0;
    const mon0830 = new Date("2026-11-16T03:50:00Z"); // Mon 09:20 IST
    await app.digests.tick(mon0830);
    await app.digests.tick(mon0830);
    assert.equal(sent.filter((m) => /market brief/.test(m.text)).length, 1);

    // Agent panel falls back to the built-in assistant
    const ch = (await call("POST", "/api/agent/chat", { message: `explain ${stock.sec.symbol}` }, web)).json;
    assert.equal(ch.source, "built-in");
    assert.ok(ch.blocks.length > 0);

    // Docs sync
    assert.equal((await call("PUT", "/api/docs/notes", { value: [{ id: "n1", text: "hi" }] }, web)).json.key, "notes");
    assert.equal((await call("PUT", "/api/docs/evil", { value: 1 }, web)).status, 400);
    assert.equal((await call("GET", "/api/docs", null, web)).json.notes[0].text, "hi");
  } finally {
    await app.pool.query(`delete from tas_user where email like '%@gquants.com'`);
    await app.close();
    await app.pool.end().catch(() => {});
  }
});
