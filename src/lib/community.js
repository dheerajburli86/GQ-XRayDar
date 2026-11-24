// Browser side of sharing, rooms and chat. Everything goes through the TA server (lib/server.js api()), which
// checks the login and the membership on every call.
import { api, authHeaders, SERVER_URL } from "./server.js";
import { load, save, uid } from "./storage.js";

// What can be shared, with a word for one item. Keys are workspace documents (storage keys).
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
export const VIS_LABEL = { private: "Only me", people: "Chosen people", everyone: "Everyone on XRayDar" };

/** Push a workspace document to the account right now (sharing reads the saved copy, not the browser's). */
export async function flushDoc(key) {
  const v = load(key, undefined);
  if (v === undefined) throw new Error("Nothing saved yet.");
  await api("PUT", `/api/docs/${encodeURIComponent(key)}`, { value: v });
}

/** Adds a shared item to the person's own workspace as a copy, named after its owner. Returns a short note. */
export function saveCopy(kind, payload, ownerName = "someone", sourceItem = null) {
  const from = ` (from ${ownerName})`;
  const cur = load(kind, undefined);
  const named = (x) => (x && typeof x === "object" && !Array.isArray(x) ? { ...x, ...(x.name ? { name: `${x.name}${from}` } : {}), ...(x.title ? { title: `${x.title}${from}` } : {}) } : x);
  if (kind === "indSettings") {
    if (!confirm("Replace your indicator settings with these? Your current settings will be overwritten.")) return null;
    save(kind, payload);
    return "Your indicator settings were replaced.";
  }
  if (kind === "drawings" || kind === "projections") {
    // keyed by instrument: the shared item is that instrument's list
    const all = cur && typeof cur === "object" ? { ...cur } : {};
    const list = Array.isArray(payload) ? payload : [];
    const inst = sourceItem;
    if (!inst) return null;
    all[inst] = [...(all[inst] || []), ...list.map((x) => ({ ...x, id: uid() }))];
    save(kind, all);
    return "Added to that chart.";
  }
  if (Array.isArray(cur) || ["screens", "customIndicators", "alerts.rules", "notes", "customIndices", "deriv.screens"].includes(kind)) {
    const list = Array.isArray(cur) ? cur : [];
    save(kind, [...list, { ...named(payload), id: uid() }]);
    return `Saved to your ${SHARE_KINDS[kind] ? SHARE_KINDS[kind].toLowerCase() + "s" : kind}.`;
  }
  // object maps: watchlists, workspaces
  const all = cur && typeof cur === "object" ? { ...cur } : {};
  const key = kind === "watchlists" ? uid() : `${payload?.name || "Shared"}${from}`;
  all[key] = named(payload);
  save(kind, all);
  return `Saved to your ${SHARE_KINDS[kind] ? SHARE_KINDS[kind].toLowerCase() + "s" : kind}.`;
}

/** Uploads a file (Blob / File) into a conversation. Returns {id, name, mime, size}. */
export async function uploadFile(roomId, blob, name) {
  if (blob.size > 10 * 1024 * 1024) throw new Error("Files can be at most 10 MB.");
  const r = await fetch(`${SERVER_URL}/api/rooms/${roomId}/files?name=${encodeURIComponent(name)}`, { method: "POST", headers: { "content-type": blob.type || "application/octet-stream", ...(await authHeaders()) }, body: blob });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `upload failed (HTTP ${r.status})`);
  return j;
}

const blobCache = new Map();
/** A file from a conversation, as an object URL (files need the login, so a plain <img src> cannot fetch them). */
export async function fileUrl(id) {
  if (blobCache.has(id)) return blobCache.get(id);
  const p = (async () => {
    const r = await fetch(`${SERVER_URL}/api/files/${id}`, { headers: await authHeaders() });
    if (!r.ok) throw new Error(`could not open the file (HTTP ${r.status})`);
    return URL.createObjectURL(await r.blob());
  })();
  blobCache.set(id, p);
  p.catch(() => blobCache.delete(id));
  return p;
}
export async function downloadFile(id, name) {
  const u = await fileUrl(id);
  const a = document.createElement("a"); a.href = u; a.download = name || "file"; document.body.appendChild(a); a.click(); a.remove();
}

/** A picture of a lightweight-charts chart (or a canvas), as a PNG Blob. */
export async function chartPicture(chart) {
  const c = chart?.takeScreenshot ? chart.takeScreenshot() : chart;
  if (!c?.toBlob) return null;
  return new Promise((res) => c.toBlob((b) => res(b), "image/png"));
}

/** Posts a chart to a conversation: a picture (when available) plus a link that opens the same chart. */
export async function sendChart(roomId, { ref, tf, screen, title, picture, note }) {
  let fileId = null;
  if (picture) fileId = (await uploadFile(roomId, picture, `${(title || "chart").replace(/[^\w.-]+/g, "_").slice(0, 60)}.png`)).id;
  return api("POST", `/api/rooms/${roomId}/messages`, { body: note || "", attachments: [{ type: "chart", ref, tf, screen, title, fileId }] });
}

/** Where a chart attachment opens. */
export function chartHref(a) {
  const id = String(a.ref || "").replace(/^s:/, "");
  if (a.screen && /^(RSIMMA|RSIACC|RSCMMA|RSCACC)$/.test(a.screen)) return `#/screens/${a.screen}/${encodeURIComponent(a.ref)}`;
  if (a.screen === "stock") return `#/stock/${encodeURIComponent(id)}`;
  return `#/chart/${encodeURIComponent(id)}${a.tf ? `?tf=${encodeURIComponent(a.tf)}` : ""}`;
}

// ---- unread badge: one poll shared by the whole app -----------------------------------------------------------
let unread = 0;
const subs = new Set();
let timer = null;
export function onUnread(fn) {
  subs.add(fn); fn(unread);
  if (!timer) { const tick = () => api("GET", "/api/unread").then((j) => { unread = j.unread; subs.forEach((f) => f(unread)); }).catch(() => {}); tick(); timer = setInterval(tick, 30_000); }
  return () => { subs.delete(fn); if (!subs.size) { clearInterval(timer); timer = null; } };
}
export function bumpUnread() { api("GET", "/api/unread").then((j) => { unread = j.unread; subs.forEach((f) => f(unread)); }).catch(() => {}); }

export const fmtWhen = (iso) => {
  const d = new Date(iso), now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};
export const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
