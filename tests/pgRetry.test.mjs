import { test } from "node:test";
import assert from "node:assert/strict";
import { withRetry, isTransient } from "../cli/pgRetry.mjs";

test("a dropped connection is retried; a real error is not", async () => {
  let n = 0;
  const r = await withRetry(async () => { if (++n < 3) throw new Error("Connection terminated unexpectedly"); return "ok"; }, { log: () => {}, tries: 5 });
  assert.equal(r, "ok"); assert.equal(n, 3);
  let m = 0;
  await assert.rejects(withRetry(async () => { m++; const e = new Error("duplicate key"); e.code = "23505"; throw e; }, { log: () => {} }));
  assert.equal(m, 1);
  assert.equal(isTransient({ code: "57014", message: "canceling statement due to statement timeout" }), false);
  assert.equal(isTransient({ code: "ECONNRESET", message: "read ECONNRESET" }), true);
});

test("a client-side read timeout (a silently dead connection) is retried", () => {
  assert.equal(isTransient(new Error("Query read timeout")), true);
});
