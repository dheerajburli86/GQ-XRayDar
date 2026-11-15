// Quant API: documented REST endpoints under /v1 and a WebSocket stream at
// /v1/stream, authenticated with personal API tokens (tokens.mjs), rate-limited
// per token, scoped (market | deriv | indices) and audited call by call.
//
//   GET  /v1                              index of endpoints and scopes
//   GET  /v1/deriv/underlyings            latest session summary per underlying      [deriv]
//   GET  /v1/deriv/stats/:und?from&to     daily summary history                       [deriv]
//   GET  /v1/deriv/chain/:und?date        chain with IV, Greeks and quote-quality flags [deriv]
//   GET  /v1/deriv/surface/:und?date      IV surface grid, term structure, SVI fits    [deriv]
//   GET  /v1/deriv/screen?preset|conds    derivatives screener on the latest session   [deriv]
//   GET  /v1/deriv/market?from            participant OI, ban list, MWPL               [deriv]
//   GET  /v1/indices/:key?from            house index level and return series           [indices]
//   GET  /v1/stock/:ref                   one instrument's analysis                     [market]
//   POST /v1/market/screen                stock screen {conditions, scope, limit}       [market]
//   WS   /v1/stream?token=xr_...          events: fo.session, alert (own), ping
import { WebSocketServer } from "ws";
import { HttpError } from "./http.mjs";
import { decodeDay } from "../../engine/deriv/codec.js";
import { enrichChain, surfaceGrid, termStructure, fitSvi, chainQuality } from "../../engine/deriv/chain.js";
import { DERIV_PRESETS, DERIV_FIELDS, matches, confluence } from "../../engine/deriv/screen.js";
import { MODEL_VERSIONS, ENGINE_VERSION } from "../../engine/versions.js";
import { API_SCOPES } from "./tokens.mjs";

const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
const dateQ = (v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

export const API_ENDPOINTS = [
  ["GET", "/v1/deriv/underlyings", "deriv", "Latest session summary per F&O underlying"],
  ["GET", "/v1/deriv/stats/:und?from=&to=", "deriv", "Daily summary history (PCR, IV, IV rank, OI, build-up, walls, GEX...)"],
  ["GET", "/v1/deriv/chain/:und?date=", "deriv", "Full chain with IV, Greeks and quote-quality flags (Black-76 on the same-expiry future)"],
  ["GET", "/v1/deriv/surface/:und?date=", "deriv", "IV surface grid by moneyness, term structure and SVI fits"],
  ["GET", "/v1/deriv/screen?preset=&conds=", "deriv", "Run a preset or JSON conditions on the latest session"],
  ["GET", "/v1/deriv/market?from=", "deriv", "Exchange participant-wise OI, ban list and MWPL by session"],
  ["GET", "/v1/indices/:key?from=", "indices", "House CW / EW index series (level and daily return)"],
  ["GET", "/v1/stock/:ref", "market", "Analysis of one instrument (symbol or id)"],
  ["POST", "/v1/market/screen", "market", "Stock screen: {conditions:[{field,op,value}], scope, limit}"],
  ["WS", "/v1/stream?token=", "deriv", "Push events: fo.session when a new F&O session lands; alert for your own alerts"],
];

export function registerPublicApi({ r, pool, tokens, audit, analysis }) {
  const call = (scope, fn) => async (req, params, url) => {
    const t0 = Date.now();
    const who = await tokens.verify(req, scope);
    try { return await fn({ req, params, url, who }); }
    finally { audit.event({ userId: who.userId, actor: `api:${who.prefix}`, category: "api", action: url.pathname, detail: { q: Object.fromEntries(url.searchParams), ms: Date.now() - t0 } }); }
  };
  const latestDate = async () => { const { rows } = await pool.query(`select max(date) d from tas_fo_stats`); return rows[0]?.d ? iso(rows[0].d) : null; };
  const chainOf = async (und, date) => {
    const { rows } = await pool.query(date ? `select * from tas_fo_chain where und = $1 and date = $2` : `select * from tas_fo_chain where und = $1 order by date desc limit 1`, date ? [und, date] : [und]);
    if (!rows[0]) throw new HttpError(404, `no stored chain for ${und}${date ? ` on ${date}` : ""} (chains are kept for the most recent sessions only)`);
    return enrichChain(decodeDay({ ...rows[0], date: iso(rows[0].date) }));
  };

  r.get("/v1", async () => ({ app: "GQ XRayDar", engineVersion: ENGINE_VERSION, models: MODEL_VERSIONS, auth: "Authorization: Token xr_... (create tokens in the app: Account -> API tokens)", scopes: API_SCOPES,
    endpoints: API_ENDPOINTS.map(([method, path, scope, desc]) => ({ method, path, scope, desc })), units: "fractions everywhere (0.052 = 5.2%); dates ISO YYYY-MM-DD; prices in the instrument's currency",
    labels: "exchange-published values (prices, OI, participant OI, ban) are facts; IV, Greeks, build-up, GEX and margin are calculations with the stated assumptions" }));

  r.get("/v1/deriv/underlyings", call("deriv", async () => {
    const d = await latestDate();
    if (!d) return { date: null, rows: [] };
    const { rows } = await pool.query(`select und, kind, s from tas_fo_stats where date = $1 order by und`, [d]);
    return { date: d, rows: rows.map((x) => ({ und: x.und, kind: x.kind, ...x.s })) };
  }));
  r.get("/v1/deriv/stats/:und", call("deriv", async ({ params, url }) => {
    const from = dateQ(url.searchParams.get("from")) || "1900-01-01", to = dateQ(url.searchParams.get("to")) || "2999-12-31";
    const { rows } = await pool.query(`select date, s from tas_fo_stats where und = $1 and date between $2 and $3 order by date`, [params.und.toUpperCase(), from, to]);
    return { und: params.und.toUpperCase(), rows: rows.map((x) => ({ ...x.s, date: iso(x.date) })) };
  }));
  r.get("/v1/deriv/chain/:und", call("deriv", async ({ params, url }) => {
    const ch = await chainOf(params.und.toUpperCase(), dateQ(url.searchParams.get("date")));
    const rows = [];
    for (const ex of ch.expiries) for (const row of ex.rows) for (const leg of [row.ce, row.pe]) {
      if (!leg) continue;
      rows.push({ expiry: ex.expiry, dte: ex.dte, forward: ex.F, strike: row.strike, type: leg.cp > 0 ? "CE" : "PE", price: leg.px, settle: leg.settle, oi: leg.oi, chgOi: leg.chgOi, volume: leg.vol, iv: leg.iv,
        delta: leg.g?.delta ?? null, gamma: leg.g?.gamma ?? null, theta: leg.g?.theta ?? null, vega: leg.g?.vega ?? null, rho: leg.g?.rho ?? null, vanna: leg.g?.vanna ?? null, charm: leg.g?.charm ?? null, vomma: leg.g?.vomma ?? null, quality: leg.q });
    }
    return { und: ch.underlying, date: ch.date, spot: ch.spot, lot: ch.lot, futures: ch.futures, assumptions: ch.assumptions, quality: chainQuality(ch), rows };
  }));
  r.get("/v1/deriv/surface/:und", call("deriv", async ({ params, url }) => {
    const ch = await chainOf(params.und.toUpperCase(), dateQ(url.searchParams.get("date")));
    return { und: ch.underlying, date: ch.date, grid: surfaceGrid(ch), term: termStructure(ch), svi: ch.expiries.filter((e) => e.rows.length >= 5).map((e) => ({ expiry: e.expiry, fit: fitSvi(e) })), assumptions: ch.assumptions };
  }));
  r.get("/v1/deriv/screen", call("deriv", async ({ url }) => {
    const d = await latestDate();
    if (!d) return { date: null, rows: [] };
    const preset = url.searchParams.get("preset");
    let conds, rank = null, asc = false;
    if (preset) { const p = DERIV_PRESETS.find((x) => x.name.toLowerCase() === preset.toLowerCase()); if (!p) throw new HttpError(400, `unknown preset; one of: ${DERIV_PRESETS.map((x) => x.name).join(" | ")}`); conds = p.conds; rank = p.rank; asc = !!p.asc; }
    else { try { conds = JSON.parse(url.searchParams.get("conds") || "[]"); } catch { throw new HttpError(400, "conds must be JSON"); } }
    const [{ rows }, { rows: mk }] = await Promise.all([pool.query(`select und, kind, s from tas_fo_stats where date = $1`, [d]), pool.query(`select ban, mwpl from tas_fo_market order by date desc limit 1`)]);
    const mw = new Map((mk[0]?.mwpl || []).map((x) => [x.symbol, x])), ban = new Set(mk[0]?.ban || []);
    const out = rows.map((x) => { const row = { id: x.und, und: x.und, kind: x.kind, s: x.s, tech: null, mw: mw.get(x.und) || null, banned: ban.has(x.und) }; row.conf = confluence(row); return row; }).filter((row) => matches(row, conds));
    const F = Object.fromEntries(DERIV_FIELDS.map((f) => [f.key, f]));
    if (rank && F[rank]) out.sort((a, b) => ((F[rank].value(a) ?? -Infinity) - (F[rank].value(b) ?? -Infinity)) * (asc ? 1 : -1));
    return { date: d, conditions: conds, n: out.length, rows: out.map((row) => ({ und: row.und, kind: row.kind, ...Object.fromEntries(DERIV_FIELDS.map((f) => [f.key, f.value(row) ?? null])) })), note: "Technical fields (MMA, RSI, RSC) need the app's screen rows and are null over the API; use /v1/market/screen for those." };
  }));
  r.get("/v1/deriv/market", call("deriv", async ({ url }) => {
    const from = dateQ(url.searchParams.get("from")) || "1900-01-01";
    const { rows } = await pool.query(`select date, participants, ban, mwpl from tas_fo_market where date >= $1 order by date`, [from]);
    return { rows: rows.map((x) => ({ ...x, date: iso(x.date) })), label: "exchange-published facts" };
  }));
  r.get("/v1/indices/:key", call("indices", async ({ params, url }) => {
    const from = dateQ(url.searchParams.get("from")) || "1900-01-01";
    const { rows } = await pool.query(`select * from tas_index_series($1) where date >= $2`, [params.key, from]);
    if (!rows.length) throw new HttpError(404, `no index ${params.key} (keys look like CW|USD|G or EW|LCL|C:India)`);
    return { key: params.key, rows: rows.map((x) => ({ ...x, date: iso(x.date) })) };
  }));
  r.get("/v1/stock/:ref", call("market", async ({ params }) => analysis.stock(params.ref)));
  r.post("/v1/market/screen", call("market", async ({ req }) => { const { readJson } = await import("./http.mjs"); return analysis.screen(await readJson(req)); }));
}

/** WebSocket stream on the same HTTP server. Clients pass ?token=xr_... (browsers cannot set headers). */
export function attachStream({ server, tokens, audit, log = console.log }) {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set();
  server.on("upgrade", async (req, socket, head) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname !== "/v1/stream") { socket.destroy(); return; }
    try {
      const tk = url.searchParams.get("token") || "";
      const who = await tokens.verify({ headers: { authorization: `Token ${tk}` } }, "deriv");
      wss.handleUpgrade(req, socket, head, (ws) => {
        const c = { ws, who, topics: new Set(["fo", "alerts"]) };
        clients.add(c);
        audit.event({ userId: who.userId, actor: `api:${who.prefix}`, category: "api", action: "/v1/stream connect" });
        ws.send(JSON.stringify({ type: "hello", topics: [...c.topics], note: "send {\"subscribe\":[\"fo\",\"alerts\"]} to change topics" }));
        ws.on("message", (m) => { try { const j = JSON.parse(String(m)); if (Array.isArray(j.subscribe)) c.topics = new Set(j.subscribe.filter((x) => ["fo", "alerts"].includes(x))); ws.send(JSON.stringify({ type: "subscribed", topics: [...c.topics] })); } catch { /* ignore */ } });
        ws.on("close", () => clients.delete(c));
        ws.on("error", () => clients.delete(c));
      });
    } catch (e) { socket.write(`HTTP/1.1 ${e.status || 401} Unauthorized\r\n\r\n${e.message}`); socket.destroy(); }
  });
  const ping = setInterval(() => { for (const c of clients) { try { c.ws.send(JSON.stringify({ type: "ping", at: new Date().toISOString() })); } catch { clients.delete(c); } } }, 30_000);
  ping.unref?.();
  return {
    clients: () => clients.size,
    broadcast(topic, payload, { userId = null } = {}) {
      let n = 0;
      for (const c of clients) { if (!c.topics.has(topic) || (userId && c.who.userId !== userId)) continue; try { c.ws.send(JSON.stringify({ type: topic === "fo" ? "fo.session" : "alert", ...payload })); n++; } catch { clients.delete(c); } }
      if (n) log(`[stream] ${topic} -> ${n} client(s)`);
      return n;
    },
    close() { clearInterval(ping); for (const c of clients) c.ws.close(); wss.close(); },
  };
}
