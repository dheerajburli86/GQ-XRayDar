// Minimal HTTP layer: routing, JSON bodies, CORS, errors. No framework needed.
import { gzipSync } from "node:zlib";
export class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

export function createRouter() {
  const routes = [];
  const add = (method, path, handler) => {
    const keys = [];
    const re = new RegExp(`^${path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return "([^/]+)"; })}$`);
    routes.push({ method, re, keys, handler });
  };
  return {
    get: (p, h) => add("GET", p, h), post: (p, h) => add("POST", p, h), put: (p, h) => add("PUT", p, h),
    patch: (p, h) => add("PATCH", p, h), delete: (p, h) => add("DELETE", p, h),
    match(method, path) {
      for (const r of routes) {
        if (r.method !== method) continue;
        const m = path.match(r.re);
        if (m) {
          try { return { handler: r.handler, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) }; }
          catch { throw new HttpError(400, "malformed address"); }
        }
      }
      return null;
    },
  };
}

export async function readJson(req, limit = 1_000_000) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > limit) throw new HttpError(413, "request too large"); chunks.push(c); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new HttpError(400, "invalid JSON"); }
}

export function cors(req, res, origins) {
  const o = req.headers.origin;
  if (o && (origins.includes(o.toLowerCase()) || origins.includes("*"))) {
    res.setHeader("access-control-allow-origin", o);
    res.setHeader("vary", "origin");
    res.setHeader("access-control-allow-headers", "authorization, content-type, x-ta-secret, x-telegram-user, x-dev-email");
    res.setHeader("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.setHeader("access-control-max-age", "600");
  }
}

/** JSON response. Bodies over 2 KB are gzipped when the client accepts it (screens and series shrink ~8x). */
export function send(res, status, body, req) {
  if (res.headersSent || res.writableEnded) return;
  let buf = Buffer.from(JSON.stringify(body) ?? "null");
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" };
  if (buf.length > 2048 && /\bgzip\b/.test(String(req?.headers?.["accept-encoding"] || ""))) {
    try { buf = gzipSync(buf, { level: 5 }); headers["content-encoding"] = "gzip"; headers.vary = "origin, accept-encoding"; } catch { /* send plain */ }
  }
  headers["content-length"] = buf.length;
  res.writeHead(status, headers);
  res.end(buf);
}

/** Rejects with 504 when a handler takes longer than ms (the handler keeps running; its answer is dropped). */
export function withTimeout(promise, ms, what = "request") {
  let t;
  const timer = new Promise((_, rej) => { t = setTimeout(() => rej(new HttpError(504, `${what} took too long; please try again`)), ms); });
  return Promise.race([promise, timer]).finally(() => clearTimeout(t));
}

/** Sliding one-minute window per key. Idle keys are dropped so the map cannot grow without bound. */
export class RateLimiter {
  /** perMin requests per window (default one minute). */
  constructor(perMin, windowMs = 60000) { this.perMin = perMin; this.windowMs = windowMs; this.hits = new Map(); this.sweptAt = Date.now(); }
  check(key) {
    const now = Date.now(), w = this.hits.get(key) || [];
    const recent = w.filter((t) => now - t < this.windowMs);
    if (now - this.sweptAt > 120000 || this.hits.size > 20000) this.sweep(now);
    if (recent.length >= this.perMin) { this.hits.set(key, recent); throw new HttpError(429, this.windowMs > 60000 ? "too many attempts from this address; try again later" : "too many requests; slow down"); }
    recent.push(now); this.hits.set(key, recent);
  }
  sweep(now = Date.now()) {
    this.sweptAt = now;
    for (const [k, w] of this.hits) if (!w.length || now - w[w.length - 1] >= this.windowMs) this.hits.delete(k);
  }
}
