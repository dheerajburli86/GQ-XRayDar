// Accounts, per-person agent access, sharing levels, rooms / boards / chat: end to end against the LOCAL Postgres
// (same setup as server.test.mjs, plus the 20261124 migration and an auth.users stand-in). Nothing leaves the machine.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickItem, normaliseAccess } from "../server/lib/community.mjs";

test("pickItem finds one item in arrays (id / name) and objects (key)", () => {
  assert.deepEqual(pickItem([{ id: "a", name: "x" }, { id: "b" }], "b"), { id: "b" });
  assert.deepEqual(pickItem([{ id: "a", name: "Momentum" }], "Momentum"), { id: "a", name: "Momentum" });
  assert.deepEqual(pickItem({ k1: { name: "Core" } }, "k1"), { name: "Core" });
  assert.equal(pickItem({ k1: 1 }, "k2"), undefined);
  assert.deepEqual(pickItem({ a: 1 }, "*"), { a: 1 });
});

test("agent access: off by default, admin always everything, unknown sources dropped", () => {
  assert.deepEqual(normaliseAccess(undefined), { enabled: false, sources: [] });
  assert.deepEqual(normaliseAccess({ enabled: false, sources: ["web"] }), { enabled: false, sources: [] });
  assert.deepEqual(normaliseAccess({ enabled: true, sources: ["web", "gmail", "web"] }), { enabled: true, sources: ["web"] });
  assert.equal(normaliseAccess({}, { isAdmin: true }).sources.includes("busybee"), true);
});

const DB = process.env.TEST_DATABASE_URL;
test("community end to end", { skip: !DB && "set TEST_DATABASE_URL to a local Postgres with an engine run" }, async () => {
  const { createServer } = await import("../server/index.mjs");
  const { loadConfig } = await import("../server/lib/config.mjs");
  const cfg = loadConfig({ DATABASE_URL: DB, AUTH_MODE: "dev", TA_API_SECRET: "s3cret", PORT: "0", ADMIN_EMAILS: "boss@co.test", JOBS_ENABLED: "false" });
  const app = await createServer(cfg, { fetch: async (u) => { throw new Error(`unexpected fetch ${u}`); } });
  const P = app.pool;
  await P.query(`delete from tas_room; delete from tas_share; delete from tas_user where email like '%@co.test' or email like '%@signup.test'`);
  await P.query(`delete from auth.users where email like '%@signup.test'`).catch(() => {});
  await new Promise((r) => app.server.listen(0, r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (method, path, body, who, extra = {}) => {
    const headers = { ...(who ? { "x-dev-email": who } : {}), ...extra };
    let payload;
    if (Buffer.isBuffer(body)) payload = body; else if (body !== undefined) { payload = JSON.stringify(body); headers["content-type"] = "application/json"; }
    const r = await fetch(base + path, { method, headers, body: payload });
    const ct = r.headers.get("content-type") || "";
    return { status: r.status, json: ct.includes("json") ? await r.json() : null, buf: ct.includes("json") ? null : Buffer.from(await r.arrayBuffer()), headers: r.headers };
  };
  const A = "alice@co.test", B = "bob@co.test", C = "carol@co.test", BOSS = "boss@co.test";
  try {
    // ---------------------------------------------------------- accounts
    const me = {};
    for (const [who, name] of [[A, "Alice"], [B, "Bob"], [C, "Carol"], [BOSS, "Boss"]]) {
      me[who] = (await call("GET", "/api/me", undefined, who)).json;
      assert.ok(me[who].id, `${who} signs in`);
      await call("PATCH", "/api/me", { displayName: name }, who);
    }
    assert.equal((await call("GET", "/api/me", undefined, "someone@gmail.com")).status, 200, "open signup: any email may sign in");
    assert.equal((await call("GET", "/api/me", undefined, A)).json.displayName, "Alice");
    const su = await call("POST", "/api/auth/signup", { email: "New.Person@signup.test", password: "longenough", name: "New Person" });
    assert.equal(su.status, 200, JSON.stringify(su.json));
    assert.equal((await call("POST", "/api/auth/signup", { email: "new.person@signup.test", password: "longenough", name: "Again" })).status, 409, "one account per email, case-insensitive");
    assert.equal((await call("POST", "/api/auth/signup", { email: "x@signup.test", password: "short", name: "Xy" })).status, 400);
    assert.equal((await call("POST", "/api/auth/signup", { email: "not-an-email", password: "longenough", name: "Xy" })).status, 400);
    const row = (await P.query(`select email_confirmed_at is not null as confirmed, encrypted_password like '$2a$%' as bcrypt from auth.users where email = 'new.person@signup.test'`)).rows[0];
    assert.deepEqual(row, { confirmed: true, bcrypt: true }, "account is confirmed and has a GoTrue-style bcrypt hash");
    // people search shows names, never emails
    const found = (await call("GET", "/api/people?q=bo", undefined, A)).json;
    assert.ok(found.some((p) => p.name === "Bob"));
    assert.ok(found.every((p) => !("email" in p)));
    assert.equal((await call("GET", `/api/people?q=${encodeURIComponent(C)}`, undefined, A)).json[0]?.name, "Carol", "exact email finds a person");

    // ---------------------------------------------------------- per-person agent access
    assert.deepEqual(me[A].agentAccess, { enabled: false, sources: [] }, "agent is off for a new account");
    const chat = await call("POST", "/api/agent/chat", { message: "top 5 US stocks" }, A);
    assert.equal(chat.status, 403);
    assert.match(chat.json.error, /not switched on/);
    assert.equal((await call("POST", "/api/agent/chat", { message: "hi" })).status, 401, "no guest agent");
    assert.equal((await call("PUT", `/api/admin/users/${me[A].id}/agent`, { enabled: true, sources: ["xraydar"] }, B)).status, 403, "only admins change access");
    const set = await call("PUT", `/api/admin/users/${me[A].id}/agent`, { enabled: true, sources: ["xraydar", "gmail"] }, BOSS);
    assert.deepEqual(set.json, { enabled: true, sources: ["xraydar"] }, "unknown sources (gmail) are dropped");
    assert.deepEqual((await call("GET", "/api/me", undefined, A)).json.agentAccess, { enabled: true, sources: ["xraydar"] });
    assert.equal((await call("POST", "/api/agent/chat", { message: "top 5 stocks by market cap" }, A)).json.source, "built-in", "allowed person is answered");
    assert.equal((await call("GET", "/api/me", undefined, BOSS)).json.agentAccess.sources.length, 8, "admins have every source");
    const users = (await call("GET", "/api/admin/users", undefined, BOSS)).json;
    assert.ok(users.find((u) => u.email === A).agent_access.enabled);
    assert.equal((await call("POST", `/api/admin/users/${me[A].id}/password`, { password: "short" }, BOSS)).status, 400);

    // ---------------------------------------------------------- sharing levels
    const wl = { w1: { name: "Breakouts", ids: ["1", "2"], weights: {} }, w2: { name: "Secret", ids: ["3"], weights: {} } };
    await call("PUT", "/api/docs/watchlists", { value: wl }, A);
    assert.equal((await call("POST", "/api/shares", { sourceKey: "watchlists", sourceItem: "nope", visibility: "everyone" }, A)).status, 404);
    assert.equal((await call("POST", "/api/shares", { sourceKey: "paper", sourceItem: "x", visibility: "everyone" }, A)).status, 400, "only shareable kinds");
    const sh = (await call("POST", "/api/shares", { sourceKey: "watchlists", sourceItem: "w1", visibility: "people", people: [me[B].id] }, A)).json;
    assert.equal(sh.title, "Breakouts");
    assert.equal(sh.people[0].name, "Bob");
    assert.equal((await call("GET", "/api/shares?scope=with-me", undefined, B)).json[0]?.id, sh.id, "Bob sees it");
    assert.equal((await call("GET", "/api/shares", undefined, C)).json.length, 0, "Carol does not");
    assert.equal((await call("GET", `/api/shares/${sh.id}`, undefined, C)).status, 404);
    assert.equal((await call("PATCH", `/api/shares/${sh.id}`, { visibility: "everyone" }, B)).status, 404, "only the owner changes a share");
    await call("PATCH", `/api/shares/${sh.id}`, { visibility: "everyone" }, A);
    assert.equal((await call("GET", "/api/shares?scope=everyone", undefined, C)).json[0]?.id, sh.id, "everyone now");
    // live: the owner edits the list, the share follows
    await call("PUT", "/api/docs/watchlists", { value: { ...wl, w1: { ...wl.w1, ids: ["1", "2", "9"] } } }, A);
    assert.deepEqual((await call("GET", `/api/shares/${sh.id}`, undefined, C)).json.payload.ids, ["1", "2", "9"]);
    await call("PATCH", `/api/shares/${sh.id}`, { visibility: "private" }, A);
    assert.equal((await call("GET", `/api/shares/${sh.id}`, undefined, C)).status, 404, "private again");
    assert.equal((await call("GET", "/api/shares/mine", undefined, A)).json.length, 1);
    // deleting the item stops the sharing
    await call("PUT", "/api/docs/watchlists", { value: { w2: wl.w2 } }, A);
    assert.equal((await call("GET", "/api/shares/mine", undefined, A)).json.length, 0);

    // ---------------------------------------------------------- rooms and boards
    const room = (await call("POST", "/api/rooms", { kind: "room", name: "Indian markets", visibility: "public" }, A)).json;
    assert.equal(room.myRole, "owner");
    assert.ok((await call("GET", "/api/rooms/public", undefined, C)).json.some((r) => r.id === room.id));
    assert.equal((await call("GET", `/api/rooms/${room.id}/messages`, undefined, C)).status, 200, "a public room can be read without joining");
    const m1 = (await call("POST", `/api/rooms/${room.id}/messages`, { body: "Nifty looks strong" }, A)).json;
    const m2 = (await call("POST", `/api/rooms/${room.id}/messages`, { body: "Agreed", attachments: [{ type: "chart", ref: "s:1", tf: "W", screen: "chart", title: "RELIANCE weekly" }] }, C)).json;
    assert.equal(m2.attachments[0].type, "chart");
    assert.ok((await call("GET", "/api/rooms", undefined, C)).json.some((r) => r.id === room.id), "posting joins a public room");
    assert.equal((await call("GET", "/api/unread", undefined, A)).json.unread, 1);
    await call("POST", `/api/rooms/${room.id}/read`, { lastId: m2.id }, A);
    assert.equal((await call("GET", "/api/unread", undefined, A)).json.unread, 0);
    const after = (await call("GET", `/api/rooms/${room.id}/messages?after=${m1.id}`, undefined, B)).json.messages;
    assert.deepEqual(after.map((m) => m.id), [m2.id], "polling after an id returns only newer messages");
    assert.equal((await call("DELETE", `/api/messages/${m1.id}`, undefined, C)).status, 403, "cannot delete someone else's message");
    assert.equal((await call("DELETE", `/api/messages/${m2.id}`, undefined, A)).status, 200, "room owner can moderate");
    assert.equal((await call("PATCH", `/api/messages/${m1.id}`, { body: "Nifty looks very strong" }, A)).json.body, "Nifty looks very strong");
    assert.equal((await call("POST", `/api/rooms/${room.id}/messages`, { attachments: [{ type: "link", url: "javascript:alert(1)" }] }, A)).status, 400, "no script links");

    const board = (await call("POST", "/api/rooms", { kind: "board", name: "Ideas", visibility: "public" }, B)).json;
    assert.equal((await call("POST", `/api/rooms/${board.id}/messages`, { body: "no title" }, B)).status, 400, "a topic needs a title");
    const topic = (await call("POST", `/api/rooms/${board.id}/messages`, { title: "Metals breakout?", body: "Thoughts?" }, B)).json;
    await call("POST", `/api/rooms/${board.id}/messages`, { parentId: topic.id, body: "Yes, weekly RSC turning up" }, A);
    const threads = (await call("GET", `/api/rooms/${board.id}/messages?threads=1`, undefined, C)).json.messages;
    assert.equal(threads[0].title, "Metals breakout?");
    assert.equal(threads[0].replies, 1);
    assert.equal((await call("GET", `/api/rooms/${board.id}/messages?parent=${topic.id}`, undefined, C)).json.messages.length, 2);

    // ---------------------------------------------------------- private groups and direct messages
    const grp = (await call("POST", "/api/rooms", { kind: "group", name: "Desk", members: [me[B].id] }, A)).json;
    assert.equal(grp.visibility, "private");
    assert.equal((await call("GET", `/api/rooms/${grp.id}/messages`, undefined, C)).status, 403, "outsiders cannot read a group");
    assert.equal((await call("POST", `/api/rooms/${grp.id}/join`, undefined, C)).status, 403, "or join it");
    assert.equal((await call("POST", `/api/rooms/${grp.id}/messages`, { body: "hi" }, C)).status, 403);
    assert.equal((await call("POST", `/api/rooms/${grp.id}/messages`, { body: "hi team" }, B)).status, 200);
    const dm1 = (await call("POST", "/api/rooms/dm", { userId: me[B].id }, A)).json;
    const dm2 = (await call("POST", "/api/rooms/dm", { userId: me[A].id }, B)).json;
    assert.equal(dm1.id, dm2.id, "one conversation per pair");
    assert.equal(dm1.name, "Bob");
    assert.equal((await call("GET", `/api/rooms/${dm1.id}/messages`, undefined, C)).status, 403);
    // an item sent in a chat is a copy
    const sent = (await call("POST", `/api/rooms/${dm1.id}/messages`, { body: "my screen", attachments: [{ type: "item", kind: "screens", title: "Momentum", payload: { name: "Momentum", conditions: [] } }] }, A)).json;
    assert.equal(sent.attachments[0].kindLabel, "Saved screen");

    // ---------------------------------------------------------- files
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
    const up = await call("POST", `/api/rooms/${dm1.id}/files?name=chart.png`, png, A, { "content-type": "image/png" });
    assert.equal(up.status, 200, JSON.stringify(up.json));
    assert.equal((await call("POST", `/api/rooms/${dm1.id}/files?name=x.exe`, png, A, { "content-type": "application/x-msdownload" })).status, 415);
    assert.equal((await call("POST", `/api/rooms/${dm1.id}/messages`, { attachments: [{ type: "file", fileId: up.json.id, name: "chart.png", mime: "image/png", size: png.length }] }, A)).status, 200);
    assert.equal((await call("POST", `/api/rooms/${grp.id}/messages`, { attachments: [{ type: "file", fileId: up.json.id, name: "chart.png" }] }, A)).status, 400, "a file belongs to the conversation it was uploaded to");
    const dl = await call("GET", `/api/files/${up.json.id}`, undefined, B);
    assert.equal(dl.status, 200);
    assert.ok(dl.buf.equals(png));
    assert.match(dl.headers.get("content-security-policy"), /sandbox/);
    assert.equal((await call("GET", `/api/files/${up.json.id}`, undefined, C)).status, 403, "outsiders cannot download");

    // ---------------------------------------------------------- leaving, ownership, deleting
    assert.equal((await call("DELETE", `/api/rooms/${room.id}`, undefined, C)).status, 403);
    await call("DELETE", `/api/rooms/${grp.id}/members/${me[A].id}`, undefined, A);
    assert.equal((await call("GET", `/api/rooms/${grp.id}`, undefined, B)).json.members.find((m) => m.id === me[B].id).role, "owner", "the next member becomes owner");
    assert.equal((await call("DELETE", `/api/rooms/${room.id}`, undefined, A)).status, 200);
    assert.equal((await call("GET", `/api/rooms/${room.id}`, undefined, A)).status, 404);
  } finally {
    await P.query(`delete from tas_room; delete from tas_share; delete from tas_user where email like '%@co.test' or email like '%@signup.test' or email = 'someone@gmail.com'`).catch(() => {});
    await P.query(`delete from auth.users where email like '%@signup.test'`).catch(() => {});
    await app.close?.();
    app.server.close();
  }
});
