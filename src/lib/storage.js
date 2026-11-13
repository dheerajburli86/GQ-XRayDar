// User workspace state (watchlists, notes, saved screens, layouts, alerts,
// settings). Kept in this browser's localStorage until user accounts are
// connected; every read is guarded because storage can be unavailable.
import { useEffect, useState, useCallback } from "react";

const PREFIX = "gqta.v1.";
export function load(key, fallback) {
  try { const v = localStorage.getItem(PREFIX + key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
}
export function save(key, value) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* storage full or blocked */ }
  window.dispatchEvent(new CustomEvent("gqta-store", { detail: key }));
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
