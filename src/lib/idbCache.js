// Tiny IndexedDB key/value cache. Two stores:
//   kv   the startup bundle (one entry, replaced on every new engine run)
//   run  per-run results that are expensive to refetch (index series, breadth...),
//        keyed "<runId>|<what>"; entries of older runs are purged at startup.
// Every call fails soft: a blocked or full store just means "no cache".
const DB = "tas-cache", STORE = "kv", RUN = "run";
let dbp = null;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    if (typeof indexedDB === "undefined") return rej(new Error("no indexedDB"));
    const r = indexedDB.open(DB, 2);
    r.onupgradeneeded = () => { for (const s of [STORE, RUN]) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s); };
    r.onsuccess = () => { r.result.onversionchange = () => { r.result.close(); dbp = null; }; res(r.result); };
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error("blocked"));
  });
  dbp.catch(() => { dbp = null; });
  return dbp;
}
const req = (q) => new Promise((res) => { q.onsuccess = () => res(q.result ?? null); q.onerror = () => res(null); });
const done = (t) => new Promise((res) => { t.oncomplete = () => res(); t.onerror = () => res(); t.onabort = () => res(); });

export async function idbGet(key) {
  try { const db = await open(); return await req(db.transaction(STORE).objectStore(STORE).get(key)); } catch { return null; }
}
export async function idbSet(key, value) {
  try { const db = await open(); const t = db.transaction(STORE, "readwrite"); t.objectStore(STORE).clear(); t.objectStore(STORE).put(value, key); await done(t); } catch { /* cache is optional */ }
}
export async function runGet(key) {
  try { const db = await open(); return await req(db.transaction(RUN).objectStore(RUN).get(key)); } catch { return null; }
}
export async function runSet(key, value) {
  try { const db = await open(); const t = db.transaction(RUN, "readwrite"); t.objectStore(RUN).put(value, key); await done(t); } catch { /* cache is optional */ }
}
/** Drop every per-run entry that does not belong to `prefix` (the current run). */
export async function runPurge(prefix) {
  try {
    const db = await open(); const t = db.transaction(RUN, "readwrite"); const st = t.objectStore(RUN);
    const keys = await req(st.getAllKeys());
    for (const k of keys || []) if (!String(k).startsWith(prefix)) st.delete(k);
    await done(t);
  } catch { /* cache is optional */ }
}
