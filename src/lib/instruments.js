// One instrument search for every picker and the quick-ticker popup: securities, the house
// CW / EW indices and the chart-only extras (more indices, yields, commodities, currency pairs),
// with the owner's country / category filter (INDIA, US, EUROPE, Emerging, JAPAN, Indices,
// Currency, Commodity, Crypto).
import { useEffect, useState } from "react";
import { usePersistent } from "./storage.js";
import { secRankCmp } from "../../engine/turnover.js";

export const INDIA_PROXY_LABEL = "India CW (Nifty 500, official index)";
export const CATEGORIES = ["All", "India", "US", "US ETF", "Europe", "Emerging", "Japan", "Indices", "Currency", "Commodity"]; // "Crypto" is hidden for now (HIDE_CRYPTO in features.js)
export const CATEGORY_LABEL = { India: "INDIA", US: "US", Europe: "EUROPE", Japan: "JAPAN" };

/** A chart reference as one string for URLs: s:<id> | i:<index key> | x:<extra symbol>. */
export const encodeRef = (r) => (!r ? "" : r.kind === "index" ? `i:${r.key}` : r.kind === "x" ? `x:${r.key}` : `s:${r.id}`);
export function decodeRef(str, d) {
  if (!str) return null;
  const k = str.slice(0, 2), v = str.slice(2);
  if (k === "i:") return { kind: "index", key: v, label: d?.indexByKey?.get(v)?.name || v };
  if (k === "x:") return { kind: "x", key: v, label: v.replace(/^FX:/, "") };
  const id = k === "s:" ? v : str;
  const sec = d?.secById?.get(id);
  return { kind: "sec", id, label: sec ? `${sec.symbol} · ${sec.name}` : id };
}

const isMsciEtf = (s) => (s.assetClass === "ETF") && /\bMSCI\b/i.test(s.name || "");
export function secInCategory(s, cat) {
  switch (cat) {
    case "India": return s.country === "India";
    case "US": return s.country === "United States";
    case "Europe": return s.region === "Europe";
    case "Emerging": return s.classification === "Emerging Markets";
    case "Japan": return s.country === "Japan";
    case "US ETF": return s.assetClass === "ETF" && s.country === "United States";
    case "Indices": return s.assetClass === "Index";
    case "Currency": return s.assetClass === "Currency";
    case "Commodity": return s.assetClass === "Commodity";
    case "Crypto": return s.assetClass === "Crypto";
    default: return true;
  }
}
const extraInCategory = (x, cat) => cat === "All" || (cat === "Indices" && x.category === "Index") || (cat === "Currency" && x.category === "Currency")
  || (cat === "Commodity" && x.category === "Commodity") || (cat === "US" && x.country === "United States") || (cat === "Europe" && x.region === "Europe")
  || (cat === "India" && /INR/.test(x.symbol)) || (cat === "Japan" && /JPY/.test(x.symbol));
const houseIndexInCategory = (x, cat) => cat === "All" || cat === "Indices" || (cat === "India" && /C:India\b/.test(x.key)) || (cat === "US" && /C:United States\b/.test(x.key))
  || (cat === "Japan" && /C:Japan\b/.test(x.key)) || (cat === "Europe" && /R:Europe\b/.test(x.key));

let extrasPromise = null;
/** Chart-only extra instruments, loaded once per page load. */
export function useExtras(api) {
  const [list, setList] = useState([]);
  useEffect(() => {
    if (!api?.extraList) return undefined;
    let live = true;
    extrasPromise ||= api.extraList().catch(() => []);
    extrasPromise.then((l) => { if (live) setList(l || []); });
    return () => { live = false; };
  }, [api]);
  return list;
}

/**
 * Search. Returns refs usable by loadInstrument: {kind:'sec', id} | {kind:'index', key} | {kind:'x', key},
 * each with label and sub. An empty query lists the category's best-known names (largest first).
 */
export function searchInstruments(d, extras, q, cat = "All", { allowIndex = true, allowExtra = true, limit = 40 } = {}) {
  const s = String(q || "").trim().toLowerCase();
  const out = [];
  const secMatch = (x) => !s || x.symbol.toLowerCase().startsWith(s) || (s.length >= 2 && (x.name || "").toLowerCase().includes(s));
  const rank = (x) => (x.symbol.toLowerCase() === s ? 0 : x.symbol.toLowerCase().startsWith(s) ? 1 : 2);
  // India has no cap-weighted house index (no reliable market cap): the official Nifty 500 stands in, labelled as such
  const proxy = d.secs.find((x) => x.country === "India" && x.symbol === "NIFTY 500" && x.assetClass === "Index");
  if (proxy && ["All", "India", "Indices"].includes(cat) && (!s || "india cw nifty 500 official index".includes(s) || s.split(/\s+/).every((w) => "india cw nifty 500 official index".includes(w)))) {
    out.push({ kind: "sec", id: proxy.id, label: INDIA_PROXY_LABEL, sub: "Official index proxy · chart / RSC only, not a house cap-weighted index" });
  }
  const secs = d.secs.filter((x) => secInCategory(x, cat) && secMatch(x));
  secs.sort((a, b) => (s ? rank(a) - rank(b) : 0) || secRankCmp(a, b));
  for (const x of secs.slice(0, limit)) out.push({ kind: "sec", id: x.id, label: `${x.symbol} · ${x.name}`, sub: `${x.assetClass && x.assetClass !== "Stock" ? `${x.assetClass} · ` : ""}${x.country || ""}${isMsciEtf(x) ? " · tracks an MSCI index" : ""}` });
  for (const x of allowExtra ? extras || [] : []) {
    if (!extraInCategory(x, cat)) continue;
    if (s && !x.symbol.toLowerCase().replace(/^fx:/, "").startsWith(s) && !x.label.toLowerCase().includes(s)) continue;
    out.push({ kind: "x", key: x.symbol, label: x.label, sub: `${x.category}${x.country ? ` · ${x.country}` : ""} · ${x.source || ""}` });
  }
  if (allowIndex) {
    let n = 0;
    for (const x of d.indices || []) {
      if (n >= 15) break;
      if (!houseIndexInCategory(x, cat)) continue;
      if (s && !x.name.toLowerCase().includes(s) && !x.key.toLowerCase().includes(s)) continue;
      if (!s && cat !== "Indices") continue;
      out.push({ kind: "index", key: x.key, label: x.name, sub: `GQ house index L${x.level}` }); n++;
    }
  }
  return out.slice(0, limit + 20);
}

/** The instrument last opened on any chart screen: a new screen opens on it (owner, item 14). */
export function useLastInstrument() {
  return usePersistent("lastInstrument", null);
}
