// Minimal HTTP layer: routing, JSON bodies, CORS, errors. No framework needed.
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
        if (m) return { handler: r.handler, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
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

export function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

/** Simple per-key token bucket. */
export class RateLimiter {
  constructor(perMin) { this.perMin = perMin; this.hits = new Map(); }
  check(key) {
    const now = Date.now(), w = this.hits.get(key) || [];
    const recent = w.filter((t) => now - t < 60000);
    if (recent.length >= this.perMin) throw new HttpError(429, "too many requests; slow down");
    recent.push(now); this.hits.set(key, recent);
  }
}
