// RPC client for the demo Web Worker. Every method of the data API becomes a
// message; results come back structured-cloned.
export function createDemoApi(onProgress) {
  const worker = new Worker(new URL("./demo.worker.js", import.meta.url), { type: "module" });
  let seq = 0;
  const pending = new Map();
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === "progress") { onProgress?.(m); return; }
    if (m.type === "ready") { onProgress?.({ phase: "ready" }); return; }
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.error) p.reject(new Error(m.error)); else p.resolve(m.result);
  };
  const call = (method, ...args) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, method, args });
  });
  return new Proxy({}, { get: (_, method) => (method === "then" ? undefined : (...args) => call(method, ...args)) });
}
