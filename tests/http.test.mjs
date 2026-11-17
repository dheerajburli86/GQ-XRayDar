// The server's HTTP plumbing: no database needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { createRouter, send, withTimeout, RateLimiter, HttpError } from "../server/lib/http.mjs";

const fakeRes = () => { const r = { headersSent: false, writableEnded: false, status: null, headers: null, body: null, writeHead(s, h) { r.status = s; r.headers = h; r.headersSent = true; }, end(b) { r.body = b; r.writableEnded = true; } }; return r; };

test("send: small bodies go out plain, large ones gzipped only when the client accepts it", () => {
  const small = fakeRes(); send(small, 200, { ok: true }, { headers: { "accept-encoding": "gzip" } });
  assert.equal(small.headers["content-encoding"], undefined);
  assert.deepEqual(JSON.parse(small.body.toString()), { ok: true });
  const big = { rows: Array.from({ length: 500 }, (_, i) => ({ i, name: `row ${i}` })) };
  const z = fakeRes(); send(z, 200, big, { headers: { "accept-encoding": "br, gzip" } });
  assert.equal(z.headers["content-encoding"], "gzip");
  assert.equal(z.headers["content-length"], z.body.length);
  assert.deepEqual(JSON.parse(gunzipSync(z.body).toString()), big);
  const plain = fakeRes(); send(plain, 200, big, { headers: {} });
  assert.equal(plain.headers["content-encoding"], undefined);
  assert.deepEqual(JSON.parse(plain.body.toString()), big);
});

test("send: never writes twice", () => {
  const r = fakeRes(); send(r, 200, { a: 1 }); const first = r.body; send(r, 500, { error: "late" });
  assert.equal(r.status, 200); assert.equal(r.body, first);
});

test("withTimeout: a slow handler becomes a 504, a fast one passes through", async () => {
  assert.equal(await withTimeout(Promise.resolve(7), 50), 7);
  await assert.rejects(withTimeout(new Promise((r) => setTimeout(r, 200)), 20), (e) => e instanceof HttpError && e.status === 504);
});

test("router: parameters are decoded; a malformed address is a 400, not a crash", () => {
  const r = createRouter(); r.get("/api/x/:id", () => 1);
  assert.deepEqual(r.match("GET", "/api/x/M%26M").params, { id: "M&M" });
  assert.equal(r.match("POST", "/api/x/1"), null);
  assert.throws(() => r.match("GET", "/api/x/%E0%A4%A"), (e) => e.status === 400);
});

test("rate limiter: blocks over the limit and forgets idle keys", () => {
  const l = new RateLimiter(3);
  l.check("a"); l.check("a"); l.check("a");
  assert.throws(() => l.check("a"), (e) => e.status === 429);
  l.check("b");
  l.sweep(Date.now() + 61_000);
  assert.equal(l.hits.size, 0);
});

test("push: real VAPID keys switch it on; bad keys switch it off without throwing", async () => {
  const { createPush } = await import("../server/lib/push.mjs");
  const mod = await import("web-push");
  const keys = (mod.default?.generateVAPIDKeys ? mod.default : mod).generateVAPIDKeys();
  const on = await createPush({ vapidPublic: keys.publicKey, vapidPrivate: keys.privateKey, vapidSubject: "mailto:t@gquants.com" }, null, () => {});
  assert.equal(on.enabled, true);
  const logs = [];
  const bad = await createPush({ vapidPublic: "nope", vapidPrivate: "nope", vapidSubject: "mailto:t@gquants.com" }, null, (m) => logs.push(m));
  assert.equal(bad.enabled, false);
  assert.match(logs[0], /disabled/);
  const none = await createPush({}, null);
  assert.equal(none.enabled, false);
});
