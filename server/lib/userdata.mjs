// Per-user documents (watchlists, alert rules, notes, layouts, paper portfolio,
// settings). The web app syncs them; the agent edits them for a linked user.
import crypto from "node:crypto";

export const DOC_KEYS = /^(watchlists|alerts\.rules|alerts\.inbox|notes|screens|workspaces|workspace\.current|layout\.[A-Za-z]+|paper|settings|assistant\.history|agent\.history|navCollapsed|drawings|chartlab|scanners|customIndices|deriv\.positions|deriv\.journal|deriv\.screens|deriv\.events|deriv\.alerts|deriv\.risk|deriv\.coach|customIndicators|projections|indSettings|tiles\.shortcuts|analyst\.studies|events|gp\.configs)$/;

export function createUserData(pool) {
  async function getDoc(userId, key, fallback = null) {
    const { rows } = await pool.query(`select value from tas_user_doc where user_id = $1 and key = $2`, [userId, key]);
    return rows.length ? rows[0].value : fallback;
  }
  async function putDoc(userId, key, value) {
    await pool.query(`insert into tas_user_doc (user_id, key, value, updated_at) values ($1, $2, $3, now())
                      on conflict (user_id, key) do update set value = excluded.value, updated_at = now()`, [userId, key, JSON.stringify(value)]);
    return value;
  }
  async function allDocs(userId) {
    const { rows } = await pool.query(`select key, value, updated_at from tas_user_doc where user_id = $1`, [userId]);
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }
  async function updateSettings(userId, patch) {
    const { rows } = await pool.query(`update tas_user set settings = settings || $2::jsonb where id = $1 returning settings`, [userId, JSON.stringify(patch)]);
    return rows[0]?.settings || {};
  }
  async function linkCode(userId) {
    const code = crypto.randomInt(100000, 999999).toString();
    await pool.query(`delete from tas_link_code where user_id = $1 or expires_at < now()`, [userId]);
    await pool.query(`insert into tas_link_code (code, user_id, expires_at) values ($1, $2, now() + interval '15 minutes')`, [code, userId]);
    return code;
  }
  async function claimCode(code, telegramUserId, chatId, name) {
    const { rows } = await pool.query(`delete from tas_link_code where code = $1 and expires_at > now() returning user_id`, [String(code).trim()]);
    if (!rows.length) return null;
    await pool.query(`update tas_user set telegram_user_id = null, telegram_chat_id = null where telegram_user_id = $1`, [String(telegramUserId)]);
    const { rows: u } = await pool.query(`update tas_user set telegram_user_id = $2, telegram_chat_id = $3, telegram_name = $4 where id = $1 returning *`, [rows[0].user_id, String(telegramUserId), String(chatId), name || null]);
    return u[0];
  }
  async function unlink(userId) { await pool.query(`update tas_user set telegram_user_id = null, telegram_chat_id = null, telegram_name = null where id = $1`, [userId]); }
  return { getDoc, putDoc, allDocs, updateSettings, linkCode, claimCode, unlink };
}

/** Resolve a watchlist reference (id or name, case-insensitive) in a user's lists. */
export function findWatchlist(lists, ref) {
  if (!lists || !ref) return null;
  if (lists[ref]) return { id: ref, ...lists[ref] };
  const low = String(ref).toLowerCase().trim();
  for (const [id, l] of Object.entries(lists)) if (String(l.name).toLowerCase() === low) return { id, ...l };
  for (const [id, l] of Object.entries(lists)) if (String(l.name).toLowerCase().includes(low)) return { id, ...l };
  return null;
}
