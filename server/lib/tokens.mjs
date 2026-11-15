// API tokens for quant users (Python / R). A token is shown once at creation;
// only its sha256 is stored. Scopes limit what it can read; each token has its
// own per-minute rate limit. Every API call is written to the audit trail.
import crypto from "node:crypto";
import { HttpError } from "./http.mjs";

export const API_SCOPES = { market: "Screens, stocks, market overview", deriv: "Derivatives: summaries, chains with IV / Greeks, surfaces, screens", indices: "House CW / EW index series" };
const sha = (t) => crypto.createHash("sha256").update(t).digest("hex");

export function createTokens(pool) {
  const hits = new Map();
  async function create(user, { name, scopes, ratePerMin }) {
    const sc = (Array.isArray(scopes) && scopes.length ? scopes : Object.keys(API_SCOPES)).filter((s) => API_SCOPES[s]);
    if (!sc.length) throw new HttpError(400, "no valid scope");
    const token = `xr_${crypto.randomBytes(24).toString("base64url")}`;
    const { rows } = await pool.query(`insert into tas_api_token (user_id, name, prefix, token_hash, scopes, rate_per_min) values ($1,$2,$3,$4,$5,$6) returning id, name, prefix, scopes, rate_per_min, created_at`,
      [user.id, String(name || "token").slice(0, 60), token.slice(0, 10), sha(token), sc, Math.max(5, Math.min(600, +ratePerMin || 60))]);
    return { ...rows[0], token, note: "Copy the token now: it is not shown again." };
  }
  async function list(userId) {
    const { rows } = await pool.query(`select id, name, prefix, scopes, rate_per_min, created_at, last_used_at, uses, revoked_at from tas_api_token where user_id = $1 order by id desc`, [userId]);
    return rows;
  }
  async function revoke(userId, id) {
    const { rowCount } = await pool.query(`update tas_api_token set revoked_at = now() where id = $1 and user_id = $2 and revoked_at is null`, [id, userId]);
    return rowCount > 0;
  }
  /** Resolve an API call: Authorization: Token xr_... (or Bearer xr_...). */
  async function verify(req, scope) {
    const h = String(req.headers.authorization || "");
    const t = h.replace(/^(Token|Bearer)\s+/i, "");
    if (!t.startsWith("xr_")) throw new HttpError(401, "API token required: Authorization: Token xr_...");
    const { rows } = await pool.query(`select t.*, u.email, u.role from tas_api_token t join tas_user u on u.id = t.user_id where t.token_hash = $1`, [sha(t)]);
    const tok = rows[0];
    if (!tok || tok.revoked_at) throw new HttpError(401, "token unknown or revoked");
    if (tok.role === "disabled") throw new HttpError(403, "account disabled");
    if (scope && !tok.scopes.includes(scope)) throw new HttpError(403, `token lacks the "${scope}" scope`);
    const now = Date.now(), w = (hits.get(tok.id) || []).filter((x) => now - x < 60000);
    if (w.length >= tok.rate_per_min) throw new HttpError(429, `rate limit ${tok.rate_per_min}/min for this token`);
    w.push(now); hits.set(tok.id, w);
    pool.query(`update tas_api_token set last_used_at = now(), uses = uses + 1 where id = $1`, [tok.id]).catch(() => {});
    return { tokenId: tok.id, prefix: tok.prefix, userId: tok.user_id, email: tok.email, scopes: tok.scopes, role: tok.role };
  }
  async function usage() {
    const { rows } = await pool.query(`select t.prefix, t.name, u.email, t.uses, t.last_used_at, t.revoked_at from tas_api_token t join tas_user u on u.id = t.user_id order by t.uses desc limit 50`);
    return rows;
  }
  return { create, list, revoke, verify, usage };
}
