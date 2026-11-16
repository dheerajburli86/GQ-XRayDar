// Tiny IndexedDB key/value cache for the startup bundle (too big for localStorage).
// Every call fails soft: a blocked or full store just means "no cache".
const DB = "tas-cache", STORE = "kv";
function open() {
  return new Promise((res, rej) => {
    if (typeof indexedDB === "undefined") return rej(new Error("no indexedDB"));
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
export async function idbGet(key) {
  try {
    const db = await open();
    return await new Promise((res) => { const q = db.transaction(STORE).objectStore(STORE).get(key); q.onsuccess = () => res(q.result ?? null); q.onerror = () => res(null); });
  } catch { return null; }
}
export async function idbSet(key, value) {
  try {
    const db = await open();
    await new Promise((res) => { const t = db.transaction(STORE, "readwrite"); t.objectStore(STORE).clear(); t.objectStore(STORE).put(value, key); t.oncomplete = () => res(); t.onerror = () => res(); t.onabort = () => res(); });
  } catch { /* cache is optional */ }
}
