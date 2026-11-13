// Minimal hash router: #/page/arg1/arg2?key=value. No dependency, works on any
// static host (Vercel, Netlify, S3) without rewrite rules.
import { useEffect, useState } from "react";

export function parseHash(h = window.location.hash) {
  const s = h.replace(/^#\/?/, "");
  const [path, qs] = s.split("?");
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  const query = Object.fromEntries(new URLSearchParams(qs || ""));
  return { page: parts[0] || "home", args: parts.slice(1), query, path };
}
export function navigate(path, query) {
  const q = query ? `?${new URLSearchParams(Object.entries(query).filter(([, v]) => v != null && v !== "")).toString()}` : "";
  window.location.hash = `#/${path.replace(/^\//, "")}${q}`;
}
export function href(path, query) {
  const q = query ? `?${new URLSearchParams(Object.entries(query).filter(([, v]) => v != null && v !== "")).toString()}` : "";
  return `#/${path.replace(/^\//, "")}${q}`;
}
export function useRoute() {
  const [r, setR] = useState(() => parseHash());
  useEffect(() => {
    const h = () => setR(parseHash());
    window.addEventListener("hashchange", h);
    return () => window.removeEventListener("hashchange", h);
  }, []);
  return r;
}
