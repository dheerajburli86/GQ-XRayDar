import test from "node:test";
import assert from "node:assert/strict";
import { refresh } from "../cli/extraJob.mjs";

test("first fetch walks back past FMP's 5000-bar page until the history ends", async () => {
  const saved = [];
  const pool = { query: async (sql, args) => (/max\(date\)/.test(sql) ? { rows: [{ d: null }] } : (saved.push(...JSON.parse(args[0])), { rows: [] })) };
  const day = (i) => new Date(Date.UTC(2000, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
  const all = Array.from({ length: 11000 }, (_, i) => ({ date: day(i), close: 1 + i }));
  const calls = [];
  const fetchImpl = async (url) => {
    const to = new URL(url).searchParams.get("to");
    calls.push(to);
    const rows = all.filter((x) => !to || x.date <= to).slice(-5000).reverse(); // newest first, 5000 max, like FMP
    return { ok: true, json: async () => rows };
  };
  await refresh(pool, "TEST", "k", fetchImpl);
  assert.equal(new Set(saved.map((x) => x.date)).size, 11000);
  assert.ok(calls.length >= 3);
});
