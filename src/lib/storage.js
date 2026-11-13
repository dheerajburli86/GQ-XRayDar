// User workspace state (watchlists, notes, saved screens, layouts, alerts,
// settings). Kept in this browser's localStorage and, when the TA server is
// connected and the user is signed in, mirrored to their account (lib/server.js)
// so the phone, the laptop and the Telegram agent see the same lists.
// Every read is guarded because storage can be unavailable.
import { useEffect, useState, useCallback } from "react";

const PREFIX = "gqta.v1.";
export function load(key, fallback) {
  try { const v = localStorage.getItem(PREFIX + key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
}
let syncHook = null;
/** The server sync (lib/server.js) registers here; local saves are mirrored to the account. */
export const setSyncHook = (fn) => { syncHook = fn; };
export function save(key, value, { fromServer = false } = {}) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* storage full or blocked */ }
  window.dispatchEvent(new CustomEvent("gqta-store", { detail: key }));
  if (!fromServer && syncHook) syncHook(key, value);
}
export function localKeys() {
  const out = [];
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith(PREFIX)) out.push(k.slice(PREFIX.length)); } } catch { /* blocked */ }
  return out;
}
export function usePersistent(key, fallback) {
  const [v, setV] = useState(() => load(key, fallback));
  useEffect(() => {
    const h = (e) => { if (e.detail === key) setV(load(key, fallback)); };
    window.addEventListener("gqta-store", h);
    return () => window.removeEventListener("gqta-store", h);
    // fallback is a literal at every call site
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const set = useCallback((next) => {
    const val = typeof next === "function" ? next(load(key, fallback)) : next;
    save(key, val);
    setV(val);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return [v, set];
}
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
