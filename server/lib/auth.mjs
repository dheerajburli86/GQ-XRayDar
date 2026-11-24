// Who is calling.
//   Web app      Authorization: Bearer <Supabase access token>. Verified with the
//                Supabase Auth API, then the @gquants.com / ALLOWED_EMAILS list.
//   GQ agent     x-ta-secret: <TA_API_SECRET>, optionally x-telegram-user: <id>.
//                The Telegram id maps to a web user once they linked Telegram.
import crypto from "node:crypto";
import { HttpError } from "./http.mjs";
import { normaliseAccess } from "./community.mjs";

export function createAuth(cfg, pool, fetchImpl = fetch) {
  const cache = new Map(); // token -> {user, until}
  const allowed = (email) => {
    const e = String(email || "").toLowerCase();
    // open signup (owner, 2026-11-24): anyone with an account may sign in; admins can still disable a person
    if (cfg.openSignup) return /^[^@\s]+@[^@\s]+$/.test(e);
    if (cfg.allowedEmails.includes(e)) return true;
    const dom = e.split("@")[1];
    return !!dom && cfg.allowedDomains.includes(dom);
  };
  async function upsertUser(id, email, name) {
    const { rows } = await pool.query(
      `insert into tas_user (id, email, name, display_name, created_via, last_seen_at) values ($1, $2, $3, $3, 'login', now())
       on conflict (id) do update set email = excluded.email, name = coalesce(excluded.name, tas_user.name),
         display_name = coalesce(tas_user.display_name, excluded.name), last_seen_at = now()
       returning *`, [id, email, name || null]);
    return rows[0];
  }
  const shape = (u) => {
    const isAdmin = cfg.adminEmails.includes(String(u.email).toLowerCase()) || u.role === "admin";
    const role = cfg.adminEmails.includes(String(u.email).toLowerCase()) ? "admin" : u.role || "analyst";
    if (role === "disabled") throw new HttpError(403, "this account has been disabled by an administrator");
    return { id: u.id, email: u.email, name: u.name, displayName: u.display_name || u.name || String(u.email).split("@")[0],
      agentAccess: normaliseAccess(u.agent_access, { isAdmin: role === "admin" }), telegramLinked: !!u.telegram_chat_id, telegramName: u.telegram_name, telegramUserId: u.telegram_user_id || null, settings: u.settings || {}, isAdmin, role };
  };

  async function web(req) {
    if (cfg.authMode === "dev") {
      const email = req.headers["x-dev-email"];
      if (!email) throw new HttpError(401, "sign in required");
      if (!allowed(email)) throw new HttpError(403, "this account is not allowed");
      const id = crypto.createHash("md5").update(String(email)).digest("hex").replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*/, "$1-$2-$3-$4-$5");
      return shape(await upsertUser(id, email, email.split("@")[0]));
    }
    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : null;
    if (!token) throw new HttpError(401, "sign in required");
    const hit = cache.get(token);
    if (hit && hit.until > Date.now()) return hit.user;
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) throw new HttpError(500, "SUPABASE_URL / SUPABASE_ANON_KEY are not set on the server");
    let r;
    try { r = await fetchImpl(`${cfg.supabaseUrl}/auth/v1/user`, { headers: { apikey: cfg.supabaseAnonKey, authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) }); }
    catch { throw new HttpError(503, "could not verify the login right now; try again in a moment"); }
    if (!r.ok) throw new HttpError(401, "session expired; sign in again");
    const u = await r.json();
    if (!allowed(u.email)) throw new HttpError(403, `${u.email} is not allowed to use this app`);
    const user = shape(await upsertUser(u.id, u.email, u.user_metadata?.full_name || u.user_metadata?.name));
    cache.set(token, { user, until: Date.now() + 5 * 60_000 });
    if (cache.size > 5000) cache.clear();
    return user;
  }

  /** The agent: secret required; user resolved from the Telegram id when linked. */
  async function agent(req) {
    const got = String(req.headers["x-ta-secret"] || "");
    if (!cfg.agentSecret || got.length !== cfg.agentSecret.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(cfg.agentSecret))) throw new HttpError(401, "agent secret missing or wrong");
    const tg = req.headers["x-telegram-user"] ? String(req.headers["x-telegram-user"]) : null;
    if (!tg) return { agent: true, user: null, telegramUserId: null };
    const { rows } = await pool.query(`select * from tas_user where telegram_user_id = $1`, [tg]);
    return { agent: true, user: rows[0] ? shape(rows[0]) : null, telegramUserId: tg };
  }

  /** Either caller. Returns {user, agent, telegramUserId}. */
  async function any(req) {
    if (req.headers["x-ta-secret"]) return agent(req);
    return { user: await web(req), agent: false };
  }
  /** Drop cached logins so a changed name / agent access / role takes effect on the next call. */
  const forget = (req) => { const h = req?.headers?.authorization || ""; if (h.startsWith("Bearer ")) cache.delete(h.slice(7)); };
  const forgetUser = (id) => { for (const [k, v] of cache) if (v.user?.id === id) cache.delete(k); };
  return { web, agent, any, allowed, forget, forgetUser };
}
