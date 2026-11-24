// Accounts, per-person agent access, sharing levels, rooms / boards and chat (owner + Shankar Sir, 2026-11-24).
//
//   Everything here goes through the server: the tables are RLS-on / no-policy, so membership and visibility
//   are checked HERE on every call. A person only ever sees:
//     - their own shares, shares marked "everyone", and shares naming them;
//     - rooms / boards / groups / DMs they belong to, plus public rooms and boards;
//     - other people's display names (never their email address).
import { HttpError } from "./http.mjs";

// What an admin can switch on for a person's agent. "xraydar" = XRayDar's market data; the rest are the GQ
// agent's project ids (code + database of that project). Order = order in the admin page.
export const AGENT_SOURCES = [
  ["xraydar", "XRayDar market data"],
  ["web", "Web search"],
  ["heatmap-dashboard", "Heatmap dashboard (code + database)"],
  ["gq-xraydar", "XRayDar code"],
  ["eti", "ETI research (code + database)"],
  ["gq-finxray-us", "GQ FinXray US"],
  ["gdp-macro-dashboard", "GDP macro dashboard"],
  ["busybee", "BusyBee (staff tasks, timesheets, payroll)"],
];
const SOURCE_IDS = new Set(AGENT_SOURCES.map(([k]) => k));
export const ALL_SOURCES = AGENT_SOURCES.map(([k]) => k);

// Workspace documents whose items can be shared, and what one item is called.
export const SHARE_KINDS = {
  watchlists: "Watchlist",
  screens: "Saved screen",
  customIndicators: "Formula",
  "alerts.rules": "Alert rule",
  notes: "Research note",
  workspaces: "Chart workspace",
  customIndices: "Custom index",
  "deriv.screens": "Derivatives screen",
  drawings: "Chart drawings",
  projections: "Chart projections",
  indSettings: "Indicator settings",
};

const MAX_BODY = 8000;
const MAX_ATTACH = 10;
const MAX_FILE = 10 * 1024 * 1024;
const FILE_TYPES = /^(image\/(png|jpeg|gif|webp)|application\/pdf|text\/(plain|csv)|application\/(vnd\.openxmlformats-officedocument\.(spreadsheetml\.sheet|wordprocessingml\.document|presentationml\.presentation)|vnd\.ms-excel|msword|json|zip))$/;
// drop control characters (keep tab and newline) so names and messages cannot carry terminal / layout tricks
const clean = (s, n) => [...String(s ?? "")].filter((ch) => { const c = ch.charCodeAt(0); return c === 9 || c === 10 || c === 13 || c >= 32; }).join("").trim().slice(0, n);
const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ""));
const needUuid = (s, what = "id") => { if (!isUuid(s)) throw new HttpError(400, `bad ${what}`); return s; };

/** The one item of a workspace document that a share points at (array: by id or name; object: by key). */
export function pickItem(value, item) {
  if (value == null) return undefined;
  if (Array.isArray(value)) return value.find((x) => x && (String(x.id) === item || x.name === item));
  if (typeof value === "object") return item === "*" ? value : value[item];
  return undefined;
}
function titleOf(kind, item, payload) {
  return clean(payload?.name || payload?.title || payload?.label || (typeof payload?.text === "string" ? payload.text.split("\n")[0] : "") || `${SHARE_KINDS[kind] || kind} ${item}`, 120);
}

export function normaliseAccess(a, { isAdmin = false } = {}) {
  if (isAdmin) return { enabled: true, sources: [...ALL_SOURCES], admin: true };
  const enabled = !!a?.enabled;
  const sources = [...new Set((Array.isArray(a?.sources) ? a.sources : []).filter((s) => SOURCE_IDS.has(s)))];
  return { enabled, sources: enabled ? sources : [] };
}

export function createCommunity({ pool, audit = { event() {} } }) {
  const q = (sql, args) => pool.query(sql, args);
  const one = async (sql, args) => (await q(sql, args)).rows[0] || null;
  const person = (r) => ({ id: r.id, name: r.display_name || r.name || "Member" });

  // ------------------------------------------------------------ accounts
  async function signup({ email, password, name }) {
    const e = clean(email, 200).toLowerCase(), n = clean(name, 40);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new HttpError(400, "Enter a valid email address.");
    if (String(password || "").length < 8) throw new HttpError(400, "Use a password of at least 8 characters.");
    if (String(password).length > 72) throw new HttpError(400, "Use a password of at most 72 characters.");
    if (n.length < 2) throw new HttpError(400, "Enter your name (at least 2 characters).");
    let id;
    try { id = (await one(`select public.tas_create_account($1, $2, $3) as id`, [e, password, n])).id; }
    catch (err) {
      if (err.code === "23505" || /account exists/.test(err.message)) throw new HttpError(409, "An account with this email already exists. Sign in instead.");
      if (err.code === "22023") throw new HttpError(400, err.message);
      throw err;
    }
    await q(`insert into tas_user (id, email, name, display_name, created_via, last_seen_at) values ($1, $2, $3, $3, 'signup', now())
             on conflict (id) do update set display_name = coalesce(tas_user.display_name, excluded.display_name)`, [id, e, n]);
    audit.event({ userId: id, actor: e, category: "account", action: "signup", detail: {} });
    return { id, email: e };
  }
  async function setPassword(adminUser, userId, password) {
    needUuid(userId, "user");
    if (String(password || "").length < 8) throw new HttpError(400, "Use at least 8 characters.");
    const r = await one(`select public.tas_set_password($1, $2) as ok`, [userId, password]);
    if (!r?.ok) throw new HttpError(404, "no such account");
    audit.event({ userId: adminUser.id, actor: adminUser.email, category: "admin", action: "set_password", detail: { target: userId } });
    return { ok: true };
  }
  async function setDisplayName(user, name) {
    const n = clean(name, 40);
    if (n.length < 2) throw new HttpError(400, "Use at least 2 characters.");
    await q(`update tas_user set display_name = $2 where id = $1`, [user.id, n]);
    return { displayName: n };
  }
  async function setAgentAccess(adminUser, userId, access) {
    needUuid(userId, "user");
    const a = normaliseAccess(access);
    const r = await one(`update tas_user set agent_access = $2 where id = $1 returning id, email`, [userId, JSON.stringify(a)]);
    if (!r) throw new HttpError(404, "no such user");
    audit.event({ userId: adminUser.id, actor: adminUser.email, category: "admin", action: "agent_access", detail: { target: r.email, ...a } });
    return a;
  }
  async function people(user, text) {
    const t = clean(text, 80);
    if (t.length < 2) return [];
    const { rows } = await q(
      `select id, name, display_name from tas_user
        where id <> $1 and coalesce(role, 'analyst') <> 'disabled'
          and (lower(coalesce(display_name, name, '')) like '%' || lower($2) || '%' or lower(email) = lower($2))
        order by lower(coalesce(display_name, name)) limit 20`, [user.id, t]);
    return rows.map(person);
  }

  // ------------------------------------------------------------ sharing levels
  const shareRow = (r, me) => ({
    id: r.id, kind: r.kind, kindLabel: SHARE_KINDS[r.kind] || r.kind, sourceKey: r.source_key, sourceItem: r.source_item, title: r.title,
    visibility: r.visibility, createdAt: r.created_at, updatedAt: r.updated_at, mine: r.owner_id === me,
    owner: { id: r.owner_id, name: r.owner_name || "Member" }, payload: r.payload, people: r.people || undefined,
  });
  async function docValue(userId, key) {
    return (await one(`select value from tas_user_doc where user_id = $1 and key = $2`, [userId, key]))?.value;
  }
  async function setMembers(shareId, ownerId, ids) {
    const list = [...new Set((ids || []).filter(isUuid))].filter((x) => x !== ownerId).slice(0, 500);
    await q(`delete from tas_share_member where share_id = $1`, [shareId]);
    if (list.length) await q(`insert into tas_share_member (share_id, user_id) select $1, unnest($2::uuid[]) on conflict do nothing`, [shareId, list]);
    return list;
  }
  async function shareItem(user, { sourceKey, sourceItem, title, visibility = "private", people: who = [] }) {
    if (!SHARE_KINDS[sourceKey]) throw new HttpError(400, "this kind of item cannot be shared");
    if (!["private", "people", "everyone"].includes(visibility)) throw new HttpError(400, "visibility must be private, people or everyone");
    const item = clean(sourceItem, 200);
    if (!item) throw new HttpError(400, "which item?");
    // the payload comes from the owner's SAVED document, never from the request
    const payload = pickItem(await docValue(user.id, sourceKey), item);
    if (payload === undefined) throw new HttpError(404, "that item is not saved in your account yet; wait a second and try again");
    if (JSON.stringify(payload).length > 500_000) throw new HttpError(413, "that item is too large to share");
    const t = clean(title, 120) || titleOf(sourceKey, item, payload);
    const r = await one(
      `insert into tas_share (owner_id, kind, source_key, source_item, title, payload, visibility)
       values ($1, $2, $2, $3, $4, $5, $6)
       on conflict (owner_id, source_key, source_item) do update set title = excluded.title, payload = excluded.payload, visibility = excluded.visibility, updated_at = now()
       returning *`, [user.id, sourceKey, item, t, JSON.stringify(payload), visibility]);
    const members = await setMembers(r.id, user.id, visibility === "people" ? who : []);
    audit.event({ userId: user.id, actor: user.email, category: "share", action: "share", detail: { id: r.id, kind: sourceKey, visibility, people: members.length } });
    return { ...shareRow(r, user.id), people: await peopleOf(r.id) };
  }
  async function peopleOf(shareId) {
    const { rows } = await q(`select u.id, u.name, u.display_name from tas_share_member m join tas_user u on u.id = m.user_id where m.share_id = $1 order by 2`, [shareId]);
    return rows.map(person);
  }
  async function updateShare(user, id, { visibility, people: who, title }) {
    needUuid(id, "share");
    const s = await one(`select * from tas_share where id = $1 and owner_id = $2`, [id, user.id]);
    if (!s) throw new HttpError(404, "no such share of yours");
    const vis = visibility || s.visibility;
    if (!["private", "people", "everyone"].includes(vis)) throw new HttpError(400, "visibility must be private, people or everyone");
    const r = await one(`update tas_share set visibility = $2, title = coalesce(nullif($3, ''), title), updated_at = now() where id = $1 returning *`, [id, vis, clean(title, 120)]);
    if (who !== undefined || vis !== "people") await setMembers(id, user.id, vis === "people" ? who || [] : []);
    return { ...shareRow(r, user.id), people: await peopleOf(id) };
  }
  async function removeShare(user, id) {
    needUuid(id, "share");
    const { rowCount } = await q(`delete from tas_share where id = $1 and owner_id = $2`, [id, user.id]);
    if (!rowCount) throw new HttpError(404, "no such share of yours");
    return { ok: true };
  }
  async function myShares(user) {
    const { rows } = await q(`select s.*, null as owner_name from tas_share s where owner_id = $1 order by updated_at desc`, [user.id]);
    const out = rows.map((r) => shareRow(r, user.id));
    for (const s of out) if (s.visibility === "people") s.people = await peopleOf(s.id);
    return out.map((s) => ({ ...s, payload: undefined }));
  }
  const VISIBLE = `(s.owner_id = $1 or s.visibility = 'everyone' or (s.visibility = 'people' and exists (select 1 from tas_share_member m where m.share_id = s.id and m.user_id = $1)))`;
  async function library(user, { scope = "all", kind = "" } = {}) {
    const k = SHARE_KINDS[kind] ? kind : null;
    const filter = scope === "with-me" ? `s.visibility = 'people' and exists (select 1 from tas_share_member m where m.share_id = s.id and m.user_id = $1)`
      : scope === "everyone" ? `s.visibility = 'everyone'` : `${VISIBLE}`;
    const { rows } = await q(
      `select s.id, s.kind, s.source_key, s.source_item, s.title, s.visibility, s.created_at, s.updated_at, s.owner_id,
              coalesce(u.display_name, u.name) as owner_name
         from tas_share s join tas_user u on u.id = s.owner_id
        where s.owner_id <> $1 and ${filter} and ($2::text is null or s.kind = $2) and coalesce(u.role, 'analyst') <> 'disabled'
        order by s.updated_at desc limit 300`, [user.id, k]);
    return rows.map((r) => shareRow(r, user.id));
  }
  async function getShare(user, id) {
    needUuid(id, "share");
    const r = await one(`select s.*, coalesce(u.display_name, u.name) as owner_name from tas_share s join tas_user u on u.id = s.owner_id where s.id = $2 and ${VISIBLE}`, [user.id, id]);
    if (!r) throw new HttpError(404, "this item is not shared with you (or no longer exists)");
    return shareRow(r, user.id);
  }
  /** After the owner saves a document: refresh what is shared from it; an item that is gone stops being shared. */
  async function refreshFromDoc(userId, key, value) {
    if (!SHARE_KINDS[key]) return;
    const { rows } = await q(`select id, source_item from tas_share where owner_id = $1 and source_key = $2`, [userId, key]);
    for (const s of rows) {
      const p = pickItem(value, s.source_item);
      if (p === undefined) await q(`delete from tas_share where id = $1`, [s.id]);
      else await q(`update tas_share set payload = $2, updated_at = now() where id = $1 and payload is distinct from $2::jsonb`, [s.id, JSON.stringify(p)]);
    }
  }

  // ------------------------------------------------------------ rooms, boards, groups, DMs
  async function membership(user, roomId) {
    return one(`select r.*, m.role as my_role, m.last_read_id from tas_room r left join tas_room_member m on m.room_id = r.id and m.user_id = $2 where r.id = $1`, [roomId, user.id]);
  }
  /** Read access: members, plus anyone for a public room / board. */
  async function canRead(user, roomId) {
    needUuid(roomId, "room");
    const r = await membership(user, roomId);
    if (!r) throw new HttpError(404, "no such room");
    if (!r.my_role && !(r.visibility === "public" && (r.kind === "room" || r.kind === "board"))) throw new HttpError(403, "you are not a member of this conversation");
    return r;
  }
  const manage = (user, r) => user.isAdmin || r.my_role === "owner" || r.my_role === "admin";
  const roomOut = (r) => ({ id: r.id, kind: r.kind, name: r.name, description: r.description, visibility: r.visibility, createdAt: r.created_at, lastMsgAt: r.last_msg_at, myRole: r.my_role || null });

  async function createRoom(user, { kind, name, description, visibility, members = [] }) {
    if (!["room", "board", "group"].includes(kind)) throw new HttpError(400, "kind must be room, board or group");
    const n = clean(name, 80);
    if (n.length < 2) throw new HttpError(400, "Give it a name (at least 2 characters).");
    const vis = kind === "group" ? "private" : visibility === "public" ? "public" : "private";
    const r = await one(`insert into tas_room (kind, name, description, visibility, created_by) values ($1, $2, $3, $4, $5) returning *`, [kind, n, clean(description, 500) || null, vis, user.id]);
    await q(`insert into tas_room_member (room_id, user_id, role) values ($1, $2, 'owner')`, [r.id, user.id]);
    await addMembers(user, r.id, members, { skipCheck: true });
    return roomOut({ ...r, my_role: "owner" });
  }
  async function dm(user, otherId) {
    needUuid(otherId, "person");
    if (otherId === user.id) throw new HttpError(400, "that is you");
    const other = await one(`select id, name, display_name, role from tas_user where id = $1`, [otherId]);
    if (!other || other.role === "disabled") throw new HttpError(404, "no such person");
    const key = [user.id, otherId].sort().join(":");
    let r = await one(`select * from tas_room where dm_key = $1`, [key]);
    if (!r) {
      r = await one(`insert into tas_room (kind, visibility, dm_key, created_by) values ('dm', 'private', $1, $2) on conflict (dm_key) do update set dm_key = excluded.dm_key returning *`, [key, user.id]);
      await q(`insert into tas_room_member (room_id, user_id, role) values ($1, $2, 'member'), ($1, $3, 'member') on conflict do nothing`, [r.id, user.id, otherId]);
    }
    return { ...roomOut({ ...r, my_role: "member" }), name: person(other).name, with: person(other) };
  }
  async function addMembers(user, roomId, ids, { skipCheck = false } = {}) {
    const r = await canRead(user, roomId);
    if (r.kind === "dm") throw new HttpError(400, "a direct conversation is between two people; start a group instead");
    if (!skipCheck && !manage(user, r) && !(r.kind === "group" && r.my_role)) throw new HttpError(403, "only the owner or an admin of this room can add people");
    const list = [...new Set((ids || []).filter(isUuid))].slice(0, 200);
    if (list.length) await q(`insert into tas_room_member (room_id, user_id) select $1, u.id from tas_user u where u.id = any($2::uuid[]) and coalesce(u.role, 'analyst') <> 'disabled' on conflict do nothing`, [roomId, list]);
    return { added: list.length };
  }
  async function removeMember(user, roomId, uid) {
    needUuid(uid, "person");
    const r = await canRead(user, roomId);
    if (uid !== user.id && !manage(user, r)) throw new HttpError(403, "only the owner or an admin can remove people");
    if (r.kind === "dm") throw new HttpError(400, "you cannot leave a direct conversation; just stop replying");
    const target = await one(`select role from tas_room_member where room_id = $1 and user_id = $2`, [roomId, uid]);
    if (target?.role === "owner" && uid !== user.id && !user.isAdmin) throw new HttpError(403, "the owner cannot be removed");
    await q(`delete from tas_room_member where room_id = $1 and user_id = $2`, [roomId, uid]);
    // an owner who leaves hands the room to the longest-standing member
    if (target?.role === "owner") await q(`update tas_room_member set role = 'owner' where room_id = $1 and user_id = (select user_id from tas_room_member where room_id = $1 order by joined_at limit 1)`, [roomId]);
    return { ok: true };
  }
  async function setMemberRole(user, roomId, uid, role) {
    needUuid(uid, "person");
    if (!["admin", "member"].includes(role)) throw new HttpError(400, "role must be admin or member");
    const r = await canRead(user, roomId);
    if (!(user.isAdmin || r.my_role === "owner")) throw new HttpError(403, "only the owner can change roles");
    await q(`update tas_room_member set role = $3 where room_id = $1 and user_id = $2 and role <> 'owner'`, [roomId, uid, role]);
    return { ok: true };
  }
  async function join(user, roomId) {
    const r = await canRead(user, roomId);
    if (r.my_role) return roomOut(r);
    await q(`insert into tas_room_member (room_id, user_id) values ($1, $2) on conflict do nothing`, [roomId, user.id]);
    return roomOut({ ...r, my_role: "member" });
  }
  async function updateRoom(user, roomId, { name, description, visibility }) {
    const r = await canRead(user, roomId);
    if (!manage(user, r) || r.kind === "dm") throw new HttpError(403, "only the owner or an admin can change this");
    const vis = r.kind === "group" ? "private" : ["public", "private"].includes(visibility) ? visibility : r.visibility;
    const out = await one(`update tas_room set name = coalesce(nullif($2, ''), name), description = $3, visibility = $4 where id = $1 returning *`, [roomId, clean(name, 80), description === undefined ? r.description : clean(description, 500) || null, vis]);
    return roomOut({ ...out, my_role: r.my_role });
  }
  async function deleteRoom(user, roomId) {
    const r = await canRead(user, roomId);
    if (!(user.isAdmin || r.my_role === "owner") || r.kind === "dm") throw new HttpError(403, "only the owner can delete this");
    await q(`delete from tas_room where id = $1`, [roomId]);
    audit.event({ userId: user.id, actor: user.email, category: "community", action: "delete_room", detail: { id: roomId, name: r.name } });
    return { ok: true };
  }
  async function roomInfo(user, roomId) {
    const r = await canRead(user, roomId);
    const { rows } = await q(`select u.id, u.name, u.display_name, m.role from tas_room_member m join tas_user u on u.id = m.user_id where m.room_id = $1 order by (m.role = 'owner') desc, (m.role = 'admin') desc, 2 limit 500`, [roomId]);
    const members = rows.map((x) => ({ ...person(x), role: x.role }));
    const out = { ...roomOut(r), canManage: manage({ ...user }, r), members, memberCount: members.length };
    if (r.kind === "dm") { const o = members.find((m) => m.id !== user.id); out.name = o?.name || "Direct message"; out.with = o || null; }
    return out;
  }
  async function myRooms(user) {
    const { rows } = await q(
      `select r.*, m.role as my_role, m.last_read_id,
              (select count(*)::int from tas_message x where x.room_id = r.id and x.id > m.last_read_id and x.deleted_at is null and x.user_id is distinct from $1) as unread,
              (select json_build_object('id', x.id, 'body', left(coalesce(nullif(coalesce(x.title, x.body), ''), case when jsonb_array_length(x.attachments) > 0 then '📎 attachment' else '' end), 140), 'at', x.created_at, 'by', coalesce(u.display_name, u.name))
                 from tas_message x left join tas_user u on u.id = x.user_id where x.room_id = r.id and x.deleted_at is null order by x.id desc limit 1) as last,
              (select coalesce(u.display_name, u.name) from tas_room_member o join tas_user u on u.id = o.user_id where r.kind = 'dm' and o.room_id = r.id and o.user_id <> $1 limit 1) as dm_name,
              (select o.user_id from tas_room_member o where r.kind = 'dm' and o.room_id = r.id and o.user_id <> $1 limit 1) as dm_with
         from tas_room r join tas_room_member m on m.room_id = r.id and m.user_id = $1
        order by r.last_msg_at desc limit 500`, [user.id]);
    return rows.map((r) => ({ ...roomOut(r), name: r.kind === "dm" ? r.dm_name || "Direct message" : r.name, with: r.dm_with ? { id: r.dm_with, name: r.dm_name } : undefined, unread: r.unread, last: r.last }));
  }
  async function publicRooms(user, kind) {
    const k = kind === "board" ? "board" : kind === "room" ? "room" : null;
    const { rows } = await q(
      `select r.*, (select role from tas_room_member m where m.room_id = r.id and m.user_id = $1) as my_role,
              (select count(*)::int from tas_room_member m where m.room_id = r.id) as members
         from tas_room r where r.visibility = 'public' and r.kind in ('room', 'board') and ($2::text is null or r.kind = $2)
        order by r.last_msg_at desc limit 300`, [user.id, k]);
    return rows.map((r) => ({ ...roomOut(r), members: r.members }));
  }
  async function unread(user) {
    const r = await one(
      `select coalesce(sum((select count(*) from tas_message x where x.room_id = m.room_id and x.id > m.last_read_id and x.deleted_at is null and x.user_id is distinct from $1)), 0)::int as n
         from tas_room_member m where m.user_id = $1`, [user.id]);
    return { unread: r?.n || 0 };
  }

  // ------------------------------------------------------------ messages
  function checkAttachments(list) {
    if (!Array.isArray(list)) return [];
    if (list.length > MAX_ATTACH) throw new HttpError(400, `at most ${MAX_ATTACH} attachments per message`);
    return list.map((a) => {
      const t = a?.type;
      if (t === "chart") return { type: "chart", ref: clean(a.ref, 120), tf: clean(a.tf, 8), screen: clean(a.screen, 40), title: clean(a.title, 160), fileId: isUuid(a.fileId) ? a.fileId : null };
      if (t === "item") {
        if (!SHARE_KINDS[a.kind]) throw new HttpError(400, "unknown item type");
        const p = JSON.stringify(a.payload ?? null);
        if (p.length > 200_000) throw new HttpError(413, "that item is too large to send in a message; share it instead");
        return { type: "item", kind: a.kind, kindLabel: SHARE_KINDS[a.kind], title: clean(a.title, 160), payload: a.payload ?? null };
      }
      if (t === "share") return { type: "share", shareId: needUuid(a.shareId, "share"), title: clean(a.title, 160), kind: clean(a.kind, 40) };
      if (t === "file") return { type: "file", fileId: needUuid(a.fileId, "file"), name: clean(a.name, 200), mime: clean(a.mime, 100), size: Number(a.size) || 0 };
      if (t === "link") { const u = clean(a.url, 500); if (!/^https?:\/\//i.test(u) && !/^#\//.test(u)) throw new HttpError(400, "links must start with https://"); return { type: "link", url: u, title: clean(a.title, 160) }; }
      throw new HttpError(400, "unknown attachment");
    });
  }
  const msgOut = (m) => ({
    id: Number(m.id), roomId: m.room_id, parentId: m.parent_id ? Number(m.parent_id) : null, title: m.deleted_at ? null : m.title,
    body: m.deleted_at ? "" : m.body, attachments: m.deleted_at ? [] : m.attachments, createdAt: m.created_at, editedAt: m.edited_at, deleted: !!m.deleted_at,
    author: m.user_id ? { id: m.user_id, name: m.author_name || "Member" } : { id: null, name: "Former member" },
    replies: m.replies != null ? Number(m.replies) : undefined, lastReplyAt: m.last_reply_at || undefined,
  });
  async function messages(user, roomId, { after = 0, before = 0, parent = null, threads = false, limit = 60 } = {}) {
    const r = await canRead(user, roomId);
    const lim = Math.max(1, Math.min(200, Number(limit) || 60));
    const a = Math.max(0, Number(after) || 0), b = Math.max(0, Number(before) || 0);
    const pid = parent != null && parent !== "" ? Number(parent) : null;
    const base = `select x.*, coalesce(u.display_name, u.name) as author_name`;
    let rows;
    if (threads) { // a board's thread list, newest activity first
      ({ rows } = await q(
        `${base}, (select count(*) from tas_message y where y.parent_id = x.id and y.deleted_at is null) as replies,
                (select max(y.created_at) from tas_message y where y.parent_id = x.id) as last_reply_at
           from tas_message x left join tas_user u on u.id = x.user_id
          where x.room_id = $1 and x.parent_id is null and x.deleted_at is null
          order by greatest(x.created_at, coalesce((select max(y.created_at) from tas_message y where y.parent_id = x.id), x.created_at)) desc limit $2`, [roomId, lim]));
      return { room: roomOut(r), messages: rows.map(msgOut) };
    }
    ({ rows } = await q(
      `${base} from tas_message x left join tas_user u on u.id = x.user_id
        where x.room_id = $1 and ($2::bigint = 0 or x.id > $2) and ($3::bigint = 0 or x.id < $3)
          and (case when $4::bigint is null then ($5 = 'board' or x.parent_id is null) else (x.id = $4 or x.parent_id = $4) end)
        order by x.id ${a ? "asc" : "desc"} limit $6`, [roomId, a, b, pid, r.kind, lim]));
    if (!a) rows.reverse();
    return { room: roomOut(r), messages: rows.map(msgOut) };
  }
  async function post(user, roomId, { body, attachments, parentId, title }) {
    let r = await canRead(user, roomId);
    if (!r.my_role) { await join(user, roomId); r = { ...r, my_role: "member" }; } // posting in a public room joins it
    const text = clean(body, MAX_BODY);
    const att = checkAttachments(attachments);
    const pid = parentId ? Number(parentId) : null;
    let t = null;
    if (r.kind === "board" && !pid) { t = clean(title, 160); if (t.length < 3) throw new HttpError(400, "A new topic needs a title (at least 3 characters)."); }
    if (!text && !att.length && !t) throw new HttpError(400, "Write something first.");
    if (pid) {
      const p = await one(`select id, room_id, parent_id from tas_message where id = $1`, [pid]);
      if (!p || p.room_id !== roomId) throw new HttpError(400, "that message is not in this conversation");
      if (p.parent_id) throw new HttpError(400, "reply to the topic, not to a reply");
    }
    for (const a of att) {
      if (a.type === "file" || (a.type === "chart" && a.fileId)) {
        const f = await one(`select owner_id, room_id from tas_file where id = $1`, [a.fileId]);
        if (!f || f.room_id !== roomId || f.owner_id !== user.id) throw new HttpError(400, "attach files to this conversation before sending them");
      }
      if (a.type === "share") await getShare(user, a.shareId); // you can only point at something you can see
    }
    const recent = await one(`select count(*)::int as n from tas_message where user_id = $1 and created_at > now() - interval '1 minute'`, [user.id]);
    if (recent.n >= 30) throw new HttpError(429, "You are sending messages too fast. Wait a minute.");
    const m = await one(`insert into tas_message (room_id, user_id, parent_id, title, body, attachments) values ($1, $2, $3, $4, $5, $6) returning *`,
      [roomId, user.id, pid, t, text, JSON.stringify(att)]);
    await q(`update tas_room set last_msg_at = now() where id = $1`, [roomId]);
    await q(`update tas_room_member set last_read_id = greatest(last_read_id, $3) where room_id = $1 and user_id = $2`, [roomId, user.id, m.id]);
    return msgOut({ ...m, author_name: user.displayName || user.name });
  }
  async function editMessage(user, id, { body }) {
    const m = await one(`select * from tas_message where id = $1`, [Number(id) || 0]);
    if (!m || m.deleted_at) throw new HttpError(404, "no such message");
    if (m.user_id !== user.id) throw new HttpError(403, "you can only edit your own messages");
    const text = clean(body, MAX_BODY);
    if (!text && !(m.attachments || []).length) throw new HttpError(400, "a message cannot be empty; delete it instead");
    const out = await one(`update tas_message set body = $2, edited_at = now() where id = $1 returning *`, [m.id, text]);
    return msgOut({ ...out, author_name: user.displayName || user.name });
  }
  async function deleteMessage(user, id) {
    const m = await one(`select * from tas_message where id = $1`, [Number(id) || 0]);
    if (!m || m.deleted_at) throw new HttpError(404, "no such message");
    if (m.user_id !== user.id) {
      const r = await membership(user, m.room_id);
      if (!manage(user, r)) throw new HttpError(403, "you can only delete your own messages");
      audit.event({ userId: user.id, actor: user.email, category: "community", action: "moderate_delete", detail: { message: Number(m.id), room: m.room_id } });
    }
    await q(`update tas_message set deleted_at = now() where id = $1`, [m.id]);
    return { ok: true };
  }
  async function markRead(user, roomId, lastId) {
    await q(`update tas_room_member set last_read_id = greatest(last_read_id, $3) where room_id = $1 and user_id = $2`, [needUuid(roomId, "room"), user.id, Math.max(0, Number(lastId) || 0)]);
    return { ok: true };
  }

  // ------------------------------------------------------------ files
  async function upload(user, roomId, { name, mime, data }) {
    const r = await canRead(user, roomId);
    if (!r.my_role) throw new HttpError(403, "join this room first");
    const n = clean(name, 200).replace(/[\\/]/g, "_") || "file";
    const t = String(mime || "").toLowerCase().split(";")[0].trim();
    if (!FILE_TYPES.test(t)) throw new HttpError(415, "This file type cannot be shared. Use an image, PDF, text/CSV, Excel, Word, PowerPoint, JSON or ZIP file.");
    if (!data?.length) throw new HttpError(400, "the file is empty");
    if (data.length > MAX_FILE) throw new HttpError(413, "Files can be at most 10 MB.");
    const f = await one(`insert into tas_file (owner_id, room_id, name, mime, size, data) values ($1, $2, $3, $4, $5, $6) returning id, name, mime, size`, [user.id, roomId, n, t, data.length, data]);
    return { id: f.id, name: f.name, mime: f.mime, size: f.size };
  }
  async function download(user, fileId) {
    needUuid(fileId, "file");
    const f = await one(`select id, room_id, name, mime, size, data from tas_file where id = $1`, [fileId]);
    if (!f) throw new HttpError(404, "no such file");
    await canRead(user, f.room_id);
    return f;
  }

  return {
    signup, setPassword, setDisplayName, setAgentAccess, people,
    shareItem, updateShare, removeShare, myShares, library, getShare, refreshFromDoc,
    createRoom, dm, addMembers, removeMember, setMemberRole, join, updateRoom, deleteRoom, roomInfo, myRooms, publicRooms, unread,
    messages, post, editMessage, deleteMessage, markRead, upload, download,
  };
}
