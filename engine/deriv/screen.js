// Derivatives screen fields, preset scanners, technical + derivatives
// confluence, and a plain-English query parser for the derivatives screener.
//
// A screen row: { und, kind, s (latest tas_fo_stats summary with history fields),
//                 mw (MWPL row or null), banned (bool), tech (technical flat row or null),
//                 sec (security master record or null) }

import { BUILDUP } from "./positioning.js";

const F = [];
const add = (key, label, group, type, value, extra = {}) => F.push({ key, label, group, type, value, ...extra });
add("kind", "Type", "Identity", "cat", (r) => (r.kind === "index" ? "Index" : "Stock"), { values: ["Index", "Stock"] });
add("sector", "Sector", "Identity", "cat", (r) => r.sec?.sector ?? null);
add("spotChg", "Underlying 1D %", "Price", "pct", (r) => r.s.spotChg);
add("buildup", "Futures positioning", "OI & MWPL", "cat", (r) => r.s.buildup, { values: Object.keys(BUILDUP), labels: Object.fromEntries(Object.entries(BUILDUP).map(([k, v]) => [k, v.label])) });
add("buildupConf", "Positioning confidence", "OI & MWPL", "num", (r) => r.s.buildupConf);
add("futOiChgPct", "Futures OI change %", "OI & MWPL", "pct", (r) => r.s.futOiChgPct);
add("oiPercentile", "Futures OI percentile (1y)", "OI & MWPL", "pct", (r) => r.s.oiPercentile);
add("mwplPct", "MWPL used %", "OI & MWPL", "pct", (r) => r.mw?.pct ?? null);
add("banned", "In F&O ban", "OI & MWPL", "bool", (r) => !!r.banned);
add("optVolZ", "Option volume z-score", "Volume & flow", "num", (r) => r.s.optVolZ);
add("futVolRatio", "Futures volume vs 20d avg", "Volume & flow", "num", (r) => r.s.futVolRatio);
add("optTurnover", "Option premium traded (₹ crore)", "Volume & flow", "num", (r) => (r.s.optTurnover != null ? r.s.optTurnover / 1e7 : null));
add("atmIv", "ATM IV %", "Volatility & skew", "pct", (r) => r.s.atmIv);
add("ivRank", "IV rank", "Volatility & skew", "pct", (r) => r.s.ivRank);
add("ivPct", "IV percentile", "Volatility & skew", "pct", (r) => r.s.ivPct);
add("ivHv", "IV minus 20d realised", "Volatility & skew", "pct", (r) => (r.s.atmIv != null && r.s.rv20 != null ? r.s.atmIv - r.s.rv20 : null));
add("skew25", "25-delta skew (put - call)", "Volatility & skew", "pct", (r) => r.s.skew25);
add("termInverted", "Term structure inverted", "Volatility & skew", "bool", (r) => !!r.s.termInverted);
add("basisPct", "Near futures basis %", "Futures & rollover", "pct", (r) => r.s.fut?.basisPct ?? null);
add("carry", "Annualised carry %", "Futures & rollover", "pct", (r) => r.s.fut?.carry ?? null);
add("rolloverPct", "Rollover %", "Futures & rollover", "pct", (r) => r.s.rolloverPct);
add("rollAnnual", "Roll cost, annualised %", "Futures & rollover", "pct", (r) => r.s.rollAnnual);
add("pcrOi", "PCR (OI)", "Options positioning", "num", (r) => r.s.pcrOi);
add("pcrZ", "PCR z-score (60d)", "Options positioning", "num", (r) => r.s.pcrZ);
add("callWriting", "Fresh OTM call writing (contracts)", "Options positioning", "num", (r) => r.s.otmCallWrite);
add("putWriting", "Fresh OTM put writing (contracts)", "Options positioning", "num", (r) => r.s.otmPutWrite);
add("wallShift", "Call / put wall moved today", "Options positioning", "bool", (r) => (r.s.callWallPrev != null && r.s.callWall !== r.s.callWallPrev) || (r.s.putWallPrev != null && r.s.putWall !== r.s.putWallPrev));
add("maxPainDistPct", "Distance to max pain %", "Expiry & gamma", "pct", (r) => r.s.maxPainDistPct);
add("nearDte", "Days to near expiry", "Expiry & gamma", "num", (r) => r.s.nearDte);
add("expMovePct", "Expected move to expiry %", "Expiry & gamma", "pct", (r) => r.s.expMovePct);
add("flipDistPct", "Distance to gamma flip %", "Expiry & gamma", "pct", (r) => (r.s.gammaFlip && r.s.spot ? r.s.gammaFlip / r.s.spot - 1 : null));
add("mmaBullD", "Daily MMA bullish", "Technical", "bool", (r) => r.tech?.mmaBullD ?? null);
add("compressionD", "Daily MMA compression", "Technical", "bool", (r) => r.tech?.compressionD ?? null);
add("breakoutD", "Daily breakout", "Technical", "bool", (r) => r.tech?.breakoutD ?? null);
add("rsiD", "RSI (daily)", "Technical", "num", (r) => r.tech?.rsiD ?? null);
add("rsi2D", "RSI of RSI (daily)", "Technical", "num", (r) => r.tech?.rsi2D ?? null);
add("rscRising", "RSC vs market rising", "Technical", "bool", (r) => r.tech?.rscRising_country_D ?? null);
add("wwTrend", "Weight Watcher trend", "Technical", "cat", (r) => r.tech?.wwTrend ?? null);
add("confluence", "Confluence score", "Confluence", "num", (r) => r.conf?.score ?? null);
export const DERIV_FIELDS = F;
export const DERIV_FIELD = Object.fromEntries(F.map((f) => [f.key, f]));
export const DERIV_GROUPS = [...new Set(F.map((f) => f.group))];

/** conditions: [{field, op: > >= < <= = != is true/false in, value}] */
export function matches(row, conds) {
  for (const c of conds) {
    const f = DERIV_FIELD[c.field]; if (!f) return false;
    const v = f.value(row);
    if (c.op === "true") { if (v !== true) return false; continue; }
    if (c.op === "false") { if (v !== false) return false; continue; }
    if (v == null) return false;
    const x = c.value;
    if (c.op === ">" && !(v > x)) return false;
    if (c.op === ">=" && !(v >= x)) return false;
    if (c.op === "<" && !(v < x)) return false;
    if (c.op === "<=" && !(v <= x)) return false;
    if (c.op === "=" && v !== x) return false;
    if (c.op === "!=" && v === x) return false;
    if (c.op === "in" && !(Array.isArray(x) && x.includes(v))) return false;
  }
  return true;
}

const c = (field, op, value) => ({ field, op, value });
/** Preset scanners (the groups of the feature list), each a list of conditions and a ranking field. */
export const DERIV_PRESETS = [
  { group: "OI & MWPL", name: "Long build-up", conds: [c("buildup", "=", "long_buildup")], rank: "futOiChgPct" },
  { group: "OI & MWPL", name: "Short build-up", conds: [c("buildup", "=", "short_buildup")], rank: "futOiChgPct" },
  { group: "OI & MWPL", name: "Short covering", conds: [c("buildup", "=", "short_covering")], rank: "spotChg" },
  { group: "OI & MWPL", name: "Long unwinding", conds: [c("buildup", "=", "long_unwinding")], rank: "futOiChgPct", asc: true },
  { group: "OI & MWPL", name: "Near F&O ban (MWPL 80%+)", conds: [c("mwplPct", ">=", 0.8)], rank: "mwplPct" },
  { group: "OI & MWPL", name: "Biggest OI change", conds: [c("futOiChgPct", ">=", 0.05)], rank: "futOiChgPct" },
  { group: "Volume & flow", name: "Unusual option volume", conds: [c("optVolZ", ">=", 2.5)], rank: "optVolZ" },
  { group: "Volume & flow", name: "Futures volume surge", conds: [c("futVolRatio", ">=", 2)], rank: "futVolRatio" },
  { group: "Volatility & skew", name: "IV rank high (sell premium screens)", conds: [c("ivRank", ">=", 0.7)], rank: "ivRank" },
  { group: "Volatility & skew", name: "IV rank low (buy premium screens)", conds: [c("ivRank", "<=", 0.2)], rank: "ivRank", asc: true },
  { group: "Volatility & skew", name: "IV well above realised (VRP rich)", conds: [c("ivHv", ">=", 0.05)], rank: "ivHv" },
  { group: "Volatility & skew", name: "Steep put skew", conds: [c("skew25", ">=", 0.05)], rank: "skew25" },
  { group: "Volatility & skew", name: "Inverted term structure", conds: [c("termInverted", "true")], rank: "atmIv" },
  { group: "Futures & rollover", name: "Rich futures premium", conds: [c("carry", ">=", 0.12)], rank: "carry" },
  { group: "Futures & rollover", name: "Futures at a discount", conds: [c("basisPct", "<", 0)], rank: "basisPct", asc: true },
  { group: "Futures & rollover", name: "High rollover (expiry week)", conds: [c("nearDte", "<=", 5), c("rolloverPct", ">=", 0.7)], rank: "rolloverPct" },
  { group: "Options positioning", name: "Fresh put writing", conds: [c("putWriting", ">", 0), c("pcrOi", ">=", 1)], rank: "putWriting" },
  { group: "Options positioning", name: "Fresh call writing", conds: [c("callWriting", ">", 0), c("pcrOi", "<=", 0.8)], rank: "callWriting" },
  { group: "Options positioning", name: "PCR extreme", conds: [c("pcrZ", ">=", 2)], rank: "pcrZ" },
  { group: "Options positioning", name: "OI wall moved", conds: [c("wallShift", "true")], rank: "optTurnover" },
  { group: "Technical + derivatives", name: "MMA compression + OI surge", conds: [c("compressionD", "true"), c("futOiChgPct", ">=", 0.05)], rank: "futOiChgPct" },
  { group: "Technical + derivatives", name: "Breakout backed by long build-up", conds: [c("breakoutD", "true"), c("buildup", "=", "long_buildup")], rank: "confluence" },
  { group: "Technical + derivatives", name: "Rising RSC + long build-up", conds: [c("rscRising", "true"), c("buildup", "=", "long_buildup")], rank: "confluence" },
  { group: "Technical + derivatives", name: "High confluence", conds: [c("confluence", ">=", 60)], rank: "confluence" },
  { group: "Expiry & gamma", name: "Far from max pain near expiry", conds: [c("nearDte", "<=", 3)], rank: "maxPainDistPct" },
  { group: "Expiry & gamma", name: "Close to the gamma flip", conds: [c("flipDistPct", ">=", -0.01), c("flipDistPct", "<=", 0.01)], rank: "flipDistPct" },
];

/**
 * Technical + derivatives confluence for one underlying: each technical signal
 * is checked against what positioning says, and agreements / conflicts are
 * listed with a 0-100 score (50 = no information either way).
 */
export function confluence(row) {
  const s = row.s, t = row.tech;
  const dir = s.buildup ? BUILDUP[s.buildup]?.dir ?? 0 : 0;
  const items = [];
  const push = (area, agree, text) => items.push({ area, agree, text });
  if (t) {
    if (t.mmaBullD != null && dir) push("MMA", (t.mmaBullD ? 1 : -1) === dir, `Daily MMA ${t.mmaBullD ? "bullish" : "not bullish"}; futures show ${BUILDUP[s.buildup].label.toLowerCase()}`);
    if (t.compressionD && Math.abs(s.futOiChgPct || 0) >= 0.03) push("MMA", true, "MMA compression with a meaningful OI change: positions are being set ahead of a range break");
    if (t.rsiD != null && dir) push("RSI", (t.rsiD >= 50 ? 1 : -1) === dir, `RSI ${t.rsiD.toFixed(0)} ${t.rsiD >= 50 ? "above" : "below"} 50`);
    if (t.rsi2D != null && t.rsiD != null && dir) push("RSI of RSI", (t.rsi2D >= 50 ? 1 : -1) === dir, `RSI of RSI ${t.rsi2D.toFixed(0)} (momentum ${t.rsi2D >= 50 ? "accelerating" : "fading"})`);
    if (t.rscRising_country_D != null && dir) push("RSC", (t.rscRising_country_D ? 1 : -1) === dir, `Relative strength vs the market ${t.rscRising_country_D ? "rising" : "falling"}`);
    if (t.wwTrend && dir) push("WW", ((t.wwTrend === "rising" || t.wwTrend === "turn_up_from_low") ? 1 : (t.wwTrend === "falling" || t.wwTrend === "turn_down_from_high") ? -1 : 0) === dir, `Index weight ${String(t.wwTrend).replace(/_/g, " ")} (a weight change is a relative market-cap move, not a flow)`);
    if (t.breakoutD && dir) push("Price pattern", dir > 0, `Daily breakout with ${BUILDUP[s.buildup].label.toLowerCase()}`);
    if (t.breakdownD && dir) push("Price pattern", dir < 0, `Daily breakdown with ${BUILDUP[s.buildup].label.toLowerCase()}`);
  }
  if (s.pcrOi != null && dir) push("Options", (s.pcrOi >= 1 ? 1 : -1) === dir, `Put-call ratio ${s.pcrOi.toFixed(2)} (${s.pcrOi >= 1 ? "put writing heavier" : "call writing heavier"})`);
  if (s.putWall && s.callWall && s.spot) push("Support / resistance", true, `Put OI wall ${s.putWall} below and call OI wall ${s.callWall} above spot ${s.spot.toFixed(1)}`);
  const scored = items.filter((x) => x.area !== "Support / resistance");
  const agree = scored.filter((x) => x.agree).length, n = scored.length;
  return { score: n ? Math.round((agree / n) * 100) : null, agree, n, items, conflicts: scored.filter((x) => !x.agree).map((x) => x.text) };
}

/** Plain-English derivatives query -> conditions. Shows how the sentence was read. */
export function parseDerivQuery(text) {
  const q = ` ${String(text).toLowerCase()} `;
  const conds = [], read = [];
  const num = (re) => { const m = q.match(re); return m ? parseFloat(m[1]) : null; };
  const pick = (re, cond, label) => { if (re.test(q)) { conds.push(cond); read.push(label); } };
  pick(/long build ?-?up/, c("buildup", "=", "long_buildup"), "long build-up");
  pick(/short build ?-?up/, c("buildup", "=", "short_buildup"), "short build-up");
  pick(/short covering/, c("buildup", "=", "short_covering"), "short covering");
  pick(/long unwinding/, c("buildup", "=", "long_unwinding"), "long unwinding");
  pick(/\bindex|indices\b/, c("kind", "=", "Index"), "indices only");
  pick(/\bstocks?\b/, c("kind", "=", "Stock"), "stocks only");
  pick(/put writing/, c("putWriting", ">", 0), "fresh put writing");
  pick(/call writing/, c("callWriting", ">", 0), "fresh call writing");
  pick(/unusual|spike/, c("optVolZ", ">=", 2.5), "unusual option volume");
  pick(/invert/, c("termInverted", "true"), "inverted IV term structure");
  pick(/\bban\b|mwpl/, c("mwplPct", ">=", num(/mwpl (?:above|over|>) ?(\d+)/) ? num(/mwpl (?:above|over|>) ?(\d+)/) / 100 : 0.8), "near the F&O ban");
  pick(/breakout/, c("breakoutD", "true"), "daily breakout");
  pick(/compression/, c("compressionD", "true"), "MMA compression");
  pick(/rising (?:rsc|relative strength)/, c("rscRising", "true"), "rising relative strength");
  const ivr = num(/iv ?rank (?:above|over|>|of at least) ?(\d+)/); if (ivr != null) { conds.push(c("ivRank", ">=", ivr / 100)); read.push(`IV rank ≥ ${ivr}`); }
  const ivrb = num(/iv ?rank (?:below|under|<) ?(\d+)/); if (ivrb != null) { conds.push(c("ivRank", "<=", ivrb / 100)); read.push(`IV rank ≤ ${ivrb}`); }
  if (ivr == null && ivrb == null) { pick(/high iv|iv (?:is )?high/, c("ivRank", ">=", 0.7), "IV rank ≥ 70"); pick(/low iv|iv (?:is )?low/, c("ivRank", "<=", 0.2), "IV rank ≤ 20"); }
  const pa = num(/pcr (?:above|over|>) ?(\d*\.?\d+)/); if (pa != null) { conds.push(c("pcrOi", ">=", pa)); read.push(`PCR ≥ ${pa}`); }
  const pb = num(/pcr (?:below|under|<) ?(\d*\.?\d+)/); if (pb != null) { conds.push(c("pcrOi", "<=", pb)); read.push(`PCR ≤ ${pb}`); }
  const ro = num(/rollover (?:above|over|>) ?(\d+)/); if (ro != null) { conds.push(c("rolloverPct", ">=", ro / 100)); read.push(`rollover ≥ ${ro}%`); }
  pick(/discount/, c("basisPct", "<", 0), "futures at a discount");
  pick(/premium rich|rich premium|high carry/, c("carry", ">=", 0.12), "rich futures carry");
  return { conds, read };
}
