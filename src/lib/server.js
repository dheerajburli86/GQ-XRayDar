// Connection to the TA backend server (VITE_TA_SERVER_URL) and the login.
//
//   Login     Supabase Auth on the heatmap project (Google or an email link).
//             Required whenever the app reads live data; the server checks the
//             @gquants.com allow-list again on every call.
//   Server    alerts on Telegram, tasks, the GQ agent, push notifications and
//             account sync of watchlists / alerts / notes / layouts.
// Without VITE_TA_SERVER_URL the app still works; those features say so.
import { createClient } from "@supabase/supabase-js";
import { load, save, setSyncHook, localKeys } from "./storage.js";

const env = import.meta.env;
export const SERVER_URL = (env.VITE_TA_SERVER_URL || "").replace(/\/$/, "");
export const SERVER_ON = !!SERVER_URL;
const SB_ON = !!(env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY) && env.VITE_DATA_SOURCE !== "demo";
export const LOGIN_REQUIRED = SB_ON && env.VITE_REQUIRE_LOGIN !== "false";
export const ALLOWED_DOMAINS = String(env.VITE_ALLOWED_EMAIL_DOMAINS || "gquants.com").split(/[\s,]+/).filter(Boolean).map((x) => x.toLowerCase());
export const SYNC_KEYS = /^(watchlists|alerts\.rules|alerts\.inbox|notes|screens|workspaces|workspace\.current|layout\.[A-Za-z]+|paper|settings|assistant\.history|agent\.history|navCollapsed|drawings|chartlab|scanners|customIndices|deriv\.positions|deriv\.journal|deriv\.screens|deriv\.events|deriv\.alerts|deriv\.risk|deriv\.coach)$/;

export const auth = SB_ON ? createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: "gqta-auth", detectSessionInUrl: true } }).auth : null;

export const emailAllowed = (email) => ALLOWED_DOMAINS.includes(String(email || "").toLowerCase().split("@")[1] || "");

async function token() {
  if (!auth) return null;
  const { data } = await auth.getSession();
  return data.session?.access_token || null;
}

export async function api(method, path, body) {
  if (!SERVER_ON) throw new Error("The Technical Analysis server is not connected (VITE_TA_SERVER_URL).");
  const t = await token();
  let r;
  // the agent can think for a couple of minutes; everything else should answer well within one
  const ms = /\/api\/agent/.test(path) ? 180_000 : 60_000;
  try { r = await fetch(SERVER_URL + path, {
    signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined,
    method,
    headers: { "content-type": "application/json", ...(t ? { authorization: `Bearer ${t}` } : {}), ...(!t && env.VITE_DEV_EMAIL ? { "x-dev-email": env.VITE_DEV_EMAIL } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }); } catch (e) { throw new Error(e?.name === "TimeoutError" ? "The server took too long to answer. Try again." : "Could not reach the server. Check the connection and try again."); }
  let j = null;
  try { j = await r.json(); } catch { /* empty */ }
  if (!r.ok) throw new Error(j?.error || `server answered HTTP ${r.status}`);
  return j;
}

// ---- account sync of user documents ------------------------------------------
const timers = new Map();
let syncing = false;
function push(key, value) {
  if (!SYNC_KEYS.test(key)) return;
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => { api("PUT", `/api/docs/${encodeURIComponent(key)}`, { value }).catch((e) => console.warn(`[sync] ${key}: ${e.message}`)); }, 800));
}

/** After sign-in: the account's copy wins; keys only this browser has are uploaded. */
export async function startSync() {
  if (!SERVER_ON || syncing) return;
  syncing = true;
  const remote = await api("GET", "/api/docs");
  for (const [k, v] of Object.entries(remote)) if (SYNC_KEYS.test(k)) save(k, v, { fromServer: true });
  for (const k of localKeys()) if (SYNC_KEYS.test(k) && !(k in remote)) { const v = load(k, undefined); if (v !== undefined) push(k, v); }
  setSyncHook(push);
}
