// Append-only audit trail (tas_audit) and the AI / model output log (tas_ai_audit).
// Both tables refuse UPDATE and DELETE at the database level.
import crypto from "node:crypto";
import { MODEL_VERSIONS, ENGINE_VERSION } from "../../engine/versions.js";

export const hashOf = (x) => crypto.createHash("sha256").update(JSON.stringify(x ?? null)).digest("hex").slice(0, 32);
const clip = (x, max = 20000) => { const s = JSON.stringify(x ?? null); return s.length > max ? { truncated: true, head: s.slice(0, max) } : x; };

export function createAudit(pool, log = console.log) {
  async function event({ userId = null, actor, category, action, detail = {} }) {
    try { await pool.query(`insert into tas_audit (user_id, actor, category, action, detail) values ($1,$2,$3,$4,$5)`, [userId, actor, category, action, JSON.stringify(clip(detail, 8000))]); }
    catch (e) { log(`[audit] ${category}/${action}: ${e.message}`); }
  }
  async function ai({ userId = null, kind, source = "engine", modelKey = null, modelVersion = null, params = null, features = null, output = null, tookMs = null }) {
    try {
      await pool.query(`insert into tas_ai_audit (user_id, kind, source, model_version, engine_version, params, features, features_hash, output, took_ms) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [userId, kind, source, modelVersion || (modelKey ? MODEL_VERSIONS[modelKey] : null), ENGINE_VERSION, JSON.stringify(clip(params, 8000)), JSON.stringify(clip(features, 20000)), hashOf(features), JSON.stringify(clip(output, 20000)), tookMs]);
    } catch (e) { log(`[audit] ai ${kind}: ${e.message}`); }
  }
  async function list({ category = null, userId = null, limit = 200, before = null } = {}) {
    const w = [], a = [];
    if (category) { a.push(category); w.push(`category = $${a.length}`); }
    if (userId) { a.push(userId); w.push(`user_id = $${a.length}`); }
    if (before) { a.push(before); w.push(`id < $${a.length}`); }
    a.push(Math.min(1000, limit));
    const { rows } = await pool.query(`select * from tas_audit ${w.length ? `where ${w.join(" and ")}` : ""} order by id desc limit $${a.length}`, a);
    return rows;
  }
  async function listAi({ kind = null, userId = null, limit = 200 } = {}) {
    const w = [], a = [];
    if (kind) { a.push(kind); w.push(`kind = $${a.length}`); }
    if (userId) { a.push(userId); w.push(`user_id = $${a.length}`); }
    a.push(Math.min(1000, limit));
    const { rows } = await pool.query(`select id, at, user_id, kind, source, model_version, engine_version, params, features_hash, output, took_ms from tas_ai_audit ${w.length ? `where ${w.join(" and ")}` : ""} order by id desc limit $${a.length}`, a);
    return rows;
  }
  return { event, ai, list, listAi };
}
