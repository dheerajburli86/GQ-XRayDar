// Loading instruments as bar series (securities or indices), with caching and
// currency alignment for relative-strength comparisons.
import { majorCurrency } from "../../engine/fx.js";
import { countryFamily } from "../../engine/geography.js";

const cache = new Map();
export const clearSeriesCache = () => cache.clear();
const memo = (k, f) => { if (!cache.has(k)) cache.set(k, f().catch((e) => { cache.delete(k); throw e; })); return cache.get(k); };

/** ref: {kind:'sec', id} | {kind:'index', key} -> {time, open, high, low, close, volume, currency, label, kind} */
export function loadInstrument(api, ref, d) {
  if (!ref) return Promise.resolve(null);
  if (ref.kind === "x") {
    return memo(`x:${ref.key}`, async () => {
      const s = await api.extraSeries?.(ref.key);
      if (!s?.dates?.length) return null;
      const c = s.close.map(Number);
      return { kind: "x", key: ref.key, label: s.label || ref.key, currency: s.currency && s.currency.length === 3 ? s.currency : "USD", time: s.dates, open: c, high: c, low: c, close: c, volume: null };
    });
  }
  if (ref.kind === "index") {
    return memo(`i:${ref.key}`, async () => {
      const s = await api.indexSeries(ref.key);
      if (!s) return null;
      const meta = d.indexByKey.get(ref.key);
      return { kind: "index", key: ref.key, label: meta?.name || ref.key, currency: meta?.currencyCode || "USD", time: s.dates, open: s.level, high: s.level, low: s.level, close: s.level, volume: null, n: s.n, nStale: s.nStale };
    });
  }
  return memo(`s:${ref.id}`, async () => {
    const b = await api.bars(ref.id);
    if (!b) return null;
    const sec = d.secById.get(ref.id);
    return { kind: "sec", id: ref.id, label: sec ? `${sec.symbol} · ${sec.name}` : ref.id, currency: b.currency || sec?.currency || "USD", ...b };
  });
}

export function loadFx(api, ccy) {
  const { major } = majorCurrency(ccy);
  if (major === "USD") return Promise.resolve(null);
  return memo(`fx:${major}`, () => api.fxSeries(major));
}

/** Closes converted to USD on each bar date (rate on or before the date). */
export async function closesInUsd(api, inst) {
  const { major, divisor } = majorCurrency(inst.currency);
  if (major === "USD" && divisor === 1) return inst.close;
  const fx = await loadFx(api, inst.currency);
  if (!fx) return inst.close.map((c) => c / divisor);
  const out = new Array(inst.time.length);
  let j = 0;
  for (let i = 0; i < inst.time.length; i++) {
    while (j + 1 < fx.dates.length && fx.dates[j + 1] <= inst.time[i]) j++;
    out[i] = (inst.close[i] / divisor) * fx.rate[j];
  }
  return out;
}

/** Bring A and B into one currency: unchanged if they share a major currency, else both USD. */
export async function alignCurrency(api, a, b) {
  const ma = majorCurrency(a.currency).major, mb = majorCurrency(b.currency).major;
  if (ma === mb) return { a: a.close, b: b.close, currency: ma };
  const [ua, ub] = await Promise.all([closesInUsd(api, a), closesInUsd(api, b)]);
  return { a: ua, b: ub, currency: "USD" };
}

/** Default benchmark for a security: its country CW index in local currency. */
export const defaultBenchmark = (sec) => (sec ? { kind: "index", key: `${countryFamily(sec.country)}|LCL|C:${sec.country}`, label: `${sec.country} ${countryFamily(sec.country)} (local)` } : { kind: "index", key: "CW|USD|G", label: "Global CW (USD)" });
