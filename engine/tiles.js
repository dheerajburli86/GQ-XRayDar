// Multi-tile screen (owner, Nov 2026): a written command such as
//   "Show us the Semiconductor sector in US, top 8 market cap companies relative to the
//    semiconductor sector index, daily charts in MMA format"
// becomes a set of 6-8 charts. This file reads the sentence (deterministic, every phrase it
// used is reported back) and picks the instruments and the comparison series. Drawing is the
// page's job (src/pages/Tiles.jsx); the chart maths is engine/analyst.js.
import { knownCountries } from "./geography.js";

const COUNTRY_ALIASES = { us: "United States", usa: "United States", "u.s.": "United States", america: "United States", american: "United States", uk: "United Kingdom", britain: "United Kingdom",
  japanese: "Japan", indian: "India", chinese: "China", german: "Germany", korea: "South Korea", korean: "South Korea", "hong kong": "Hong Kong", swiss: "Switzerland", taiwanese: "Taiwan" };
const NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const TF_WORDS = [[/\b(half[- ]?yearly|half[- ]?year|6[- ]?month(ly)?)\b/, "H"], [/\b(quarterly|quarter)\b/, "Q"], [/\b(yearly|annual|year)\b/, "Y"], [/\b(monthly|month)\b/, "M"], [/\b(weekly|week)\b/, "W"], [/\b(daily|day)\b/, "D"]];
const STOP = new Set(["and", "the", "of", "for", "with", "in", "on", "&", "services", "equipment", "products", "other", "group", "industry", "sector"]);
const stem = (w) => w.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/(ies)$/, "y").replace(/s$/, "");
const words = (s) => String(s || "").toLowerCase().split(/[^a-z0-9.&]+/).filter(Boolean);
const sig = (name) => [...new Set(words(name).filter((w) => !STOP.has(w) && w.length >= 3).map(stem))];

/** Best matching group name among candidates, scored by significant words found in the text. */
function bestGroup(textStems, candidates) {
  let best = null;
  for (const c of candidates) {
    const toks = sig(c.name);
    if (!toks.length) continue;
    const hit = toks.filter((t) => textStems.has(t)).length;
    if (!hit) continue;
    const score = hit / toks.length + hit; // more words matched first, then the tighter name
    if (!best || score > best.score || (score === best.score && c.rank < best.rank)) best = { ...c, score, matched: toks.filter((t) => textStems.has(t)) };
  }
  return best;
}

/**
 * text -> { country, group: {level, name}, n, relative, benchName, tf, format, understood: [...] }
 * ctx: { secs } (security master: country, sector, industryGroup, industry)
 */
export function parseTilesCommand(text, ctx = {}) {
  const t = ` ${String(text || "").toLowerCase()} `;
  const understood = [];
  const out = { country: null, group: null, n: 8, relative: false, benchName: null, tf: null, format: "MMA", understood };
  // country
  const countries = [...knownCountries(), ...Object.keys(COUNTRY_ALIASES)];
  for (const c of countries.sort((a, b) => b.length - a.length)) {
    const re = new RegExp(`[^a-z]${c.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^a-z]`);
    if (re.test(t)) { out.country = COUNTRY_ALIASES[c.toLowerCase()] || c; understood.push(`country: ${out.country}`); break; }
  }
  // how many
  const mN = t.match(/\btop\s+(\d{1,2}|[a-z]+)\b/) || t.match(/\b(\d{1,2}|[a-z]+)\s+(largest|biggest|top|companies|stocks|charts|tiles)\b/);
  if (mN) { const n = /^\d+$/.test(mN[1]) ? +mN[1] : NUM_WORDS[mN[1]]; if (n >= 1 && n <= 12) { out.n = n; understood.push(`${n} instruments`); } }
  // timeframe and format
  for (const [re, tf] of TF_WORDS) if (re.test(t)) { out.tf = tf; understood.push(`timeframe: ${tf}`); break; }
  if (/\bacc\b|accumulation/.test(t)) out.format = "ACC";
  else if (/\bmma\b|moving average|yellow|red averages/.test(t)) out.format = "MMA";
  else if (/\bplain\b|\bprice only\b/.test(t)) out.format = "PLAIN";
  understood.push(`format: ${out.format}`);
  // relative or absolute
  const rel = t.match(/\b(relative to|vs\.?|versus|against|compared to|rsc)\b(.*?)(,|\.|\bdaily\b|\bweekly\b|\bmonthly\b|\bquarterly\b|\bin (mma|acc)\b|$)/);
  if (rel && !/\babsolute\b/.test(t)) {
    out.relative = true;
    out.benchName = (rel[2] || "").replace(/\b(the|a|an)\b/g, " ").replace(/\s+/g, " ").trim() || null;
    understood.push(`relative to: ${out.benchName || "the group's index"}`);
  } else understood.push("absolute price");
  // which group: the words before "relative to" (so the benchmark's own words do not pick it)
  const head = rel ? t.slice(0, rel.index) : t;
  const stems = new Set(words(head).map(stem));
  const secs = ctx.secs || [];
  const seen = new Map();
  const add = (level, name, rank) => { if (name && name !== "Others" && !seen.has(`${level}|${name}`)) seen.set(`${level}|${name}`, { level, name, rank }); };
  for (const s of secs) { add("industry", s.industry, 0); add("industryGroup", s.industryGroup, 1); add("sector", s.sector, 2); }
  const g = bestGroup(stems, [...seen.values()]);
  if (g) { out.group = { level: g.level, name: g.name }; understood.push(`${g.level === "industryGroup" ? "industry group" : g.level}: ${g.name}`); }
  return out;
}

/** The n largest instruments (stocks) of a country and group, by current USD market cap. */
export function selectTiles(secs, { country, group, n = 8 }) {
  const pool = secs.filter((s) => (s.assetClass || "Stock") === "Stock" && (!country || s.country === country) && (!group || s[group.level] === group.name));
  pool.sort((a, b) => (b.capUsdNow || b.capUsd || 0) - (a.capUsdNow || a.capUsd || 0));
  return pool.slice(0, n);
}

/**
 * The comparison series for a group: a listed index of the same country whose name carries the
 * group's words (PHLX Semiconductor for US semiconductors), else the house country-sector CW
 * index, else the country's CW index. Returns a chart ref and why it was chosen.
 */
export function pickBenchmark(secs, indices, { country, group, benchName }) {
  const want = new Set([...sig(benchName || ""), ...(group ? sig(group.name) : [])].filter((w) => !["index", "composite"].includes(w)));
  const listed = secs.filter((s) => s.assetClass === "Index" && (!country || s.country === country));
  let best = null;
  for (const s of listed) {
    const toks = sig(s.name);
    const hit = toks.filter((x) => want.has(x)).length;
    if (hit && (!best || hit > best.hit || (hit === best.hit && (s.name || "").length < (best.s.name || "").length))) best = { s, hit };
  }
  if (best) return { ref: { kind: "sec", id: best.s.id, label: `${best.s.symbol} · ${best.s.name}` }, why: `listed index matching "${[...want].join(" ")}"` };
  const sector = group ? (group.level === "sector" ? group.name : secs.find((s) => s[group.level] === group.name)?.sector) : null;
  const has = (k) => (indices || []).some((x) => x.key === k);
  if (country && sector && has(`CW|LCL|C:${country}|S:${sector}`)) return { ref: { kind: "index", key: `CW|LCL|C:${country}|S:${sector}`, label: `${country} ${sector} CW` }, why: "house country-sector index (no listed index carries the group's name)" };
  if (country && has(`CW|LCL|C:${country}`)) return { ref: { kind: "index", key: `CW|LCL|C:${country}`, label: `${country} CW` }, why: "house country index" };
  return { ref: { kind: "index", key: "CW|USD|G", label: "Global CW (USD)" }, why: "house global index" };
}

/** True when a typed command asks for a set of charts rather than a screen or a page. */
export const isTilesCommand = (text) => /\b(tiles?|charts?|show (me|us))\b/i.test(text) && /\b(top\s+\w+|\d+\s+(companies|stocks|charts)|largest|biggest)\b/i.test(text);
