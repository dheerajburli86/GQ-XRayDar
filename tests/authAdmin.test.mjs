import test from "node:test";
import assert from "node:assert/strict";
import { createAuthAdmin } from "../server/lib/authAdmin.mjs";

const cfg = { authUrl: "https://x.supabase.co", authServiceKey: "svc" };
const reply = (status, body) => async (url, init) => { reply.last = { url, init }; return { status, json: async () => body }; };

test("createUser sends a confirmed account and returns the id", async () => {
  const a = createAuthAdmin(cfg, reply(200, { id: "u1" }));
  assert.equal(await a.createUser("a@b.co", "longenough", "Ann"), "u1");
  const b = JSON.parse(reply.last.init.body);
  assert.equal(b.email_confirm, true); assert.equal(b.user_metadata.full_name, "Ann");
  assert.equal(reply.last.init.headers.apikey, "svc");
});
test("an existing email is a 409, a missing user on password change is false", async () => {
  await assert.rejects(createAuthAdmin(cfg, reply(422, { error_code: "email_exists" })).createUser("a@b.co", "longenough", "Ann"), (e) => e.status === 409);
  assert.equal(await createAuthAdmin(cfg, reply(404, {})).setPassword("u", "longenough"), false);
  assert.equal(await createAuthAdmin(cfg, reply(200, {})).setPassword("u", "longenough"), true);
});
