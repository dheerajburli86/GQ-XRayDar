// Natural-language command parser (typed or spoken). Deterministic and
// explainable: it returns the structured query it built AND a list of the
// phrases it understood, so the user can see exactly how a sentence was read.
// Nothing is guessed silently -- unmatched words are reported back.
//
// The parser is a rules engine over the field registry, not a language model;
// the GQ agent can later sit in front of it and emit the same structure.

import { SECTORS, INDUSTRY_GROUPS } from "./reference/gics.js";
import { knownCountries, REGIONS, CLASSIFICATIONS } from "./geography.js";

const SECTOR_ALIASES = {
  it: "Information Technology", tech: "Information Technology", technology: "Information Technology", software: "Information Technology", semiconductor: "Information Technology", semis: "Information Technology",
  bank: "Financials", banks: "Financials", banking: "Financials", financial: "Financials", financials: "Financials", finance: "Financials", insurance: "Financials",
  pharma: "Health Care", healthcare: "Health Care", "health care": "Health Care", biotech: "Health Care",
  energy: "Energy", oil: "Energy", utilities: "Utilities", utility: "Utilities", power: "Utilities",
  materials: "Materials", metals: "Materials", chemicals: "Materials", mining: "Materials",
  industrials: "Industrials", industrial: "Industrials", capital: null, defence: "Industrials", defense: "Industrials",
  "real estate": "Real Estate", realty: "Real Estate", reit: "Real Estate", reits: "Real Estate",
  telecom: "Communication Services", media: "Communication Services", communication: "Communication Services",
  consumer: null, staples: "Consumer Staples", fmcg: "Consumer Staples", discretionary: "Consumer Discretionary", auto: "Consumer Discretionary", autos: "Consumer Discretionary", retail: "Consumer Discretionary",
};
const COUNTRY_ALIASES = { us: "United States", usa: "United States", america: "United States", american: "United States", uk: "United Kingdom", britain: "United Kingdom", british: "United Kingdom", japanese: "Japan", indian: "India", chinese: "China", german: "Germany", korea: "South Korea", korean: "South Korea", "hong kong": "Hong Kong", swiss: "Switzerland", brazilian: "Brazil", canadian: "Canada", australian: "Australia", taiwanese: "Taiwan" };
const REGION_ALIASES = { asia: "Asia", asian: "Asia", europe: "Europe", european: "Europe", africa: "Africa", african: "Africa", latam: "LATAM", "latin america": "LATAM" };
const CLASS_ALIASES = { "emerging markets": "Emerging Markets", emerging: "Emerging Markets", em: "Emerging Markets", "developed europe": "European Developed Markets", "other developed": "Other Developed Markets" };

const PAGES = {
  "command centre": "market", "command center": "market", home: "home", dashboard: "market",
  explorer: "explorer", navigate: "explorer", heatmap: "heatmap", "heat map": "heatmap",
  indices: "indices", index: "indices", ewcw: "ewcw", "ew cw": "ewcw", participation: "ewcw",
  "weight watcher": "ww", weights: "ww", ww: "ww", rsiacc: "screens/RSIACC", rscacc: "screens/RSCACC", rsimma: "screens/RSIMMA", rscmma: "screens/RSCMMA",
  workspace: "workspace", "relative strength": "rs", rotation: "rotation", "sector rotation": "rotation", breadth: "breadth", "market breadth": "breadth",
  screener: "screener", scanner: "screener", "early stage": "early", funnel: "funnel", backtest: "backtest", "pattern library": "backtest",
  scores: "scores", scoring: "scores", assistant: "assistant", briefs: "briefs", brief: "briefs", alerts: "alerts", watchlists: "watchlists", watchlist: "watchlists", portfolio: "watchlists",
  notes: "notes", data: "data", "data health": "data", methodology: "data", "security master": "data",
};

// signal phrases -> conditions; `{tf}` is replaced by the parsed timeframe (default W)
const SIGNALS = [
  [/improving relative strength|rising relative strength|relative strength (rising|improving)|rsc (rising|improving)|outperforming/, (tf) => [{ field: `rscRising_country_${tf}`, op: "is true" }], "relative strength vs country rising"],
  [/relative strength turn|rsc turn|turn(ing)? up in relative|inflection/, () => [{ field: "rscTurnUp_country_W", op: "is true" }], "weekly RSC upward inflection"],
  [/relative strength (at )?(a )?(new )?high|rsc high/, (tf) => [{ field: `rscHigh_country_${tf}`, op: "is true" }], "RSC at a 52-bar high"],
  [/all[- ]time high/, () => [{ field: "athBreak", op: "is true" }], "all-time high break"],
  [/all[- ]time low/, () => [{ field: "atlBreak", op: "is true" }], "all-time low break"],
  [/near (the |their |a )?52[- ]?w(ee)?k high/, () => [{ field: "nearHigh52", op: "is true" }], "within 5% of the 52-week high"],
  [/52[- ]?w(ee)?k high|new high/, () => [{ field: "atHigh52", op: "is true" }], "at a 52-week high"],
  [/52[- ]?w(ee)?k low|new low/, () => [{ field: "atLow52", op: "is true" }], "at a 52-week low"],
  [/oversold/, (tf) => [{ field: `rsi${tf}`, op: "<", value: 30 }], "RSI below 30"],
  [/overbought/, (tf) => [{ field: `rsi${tf}`, op: ">", value: 70 }], "RSI above 70"],
  [/compression|squeeze|coiling/, (tf) => [{ field: `compression${tf}`, op: "is true" }], "MMA compression"],
  [/expansion/, (tf) => [{ field: `expansion${tf}`, op: "is true" }], "MMA expansion"],
  [/bullish (mma|alignment)|mma bullish|uptrend|up trend/, (tf) => [{ field: `mmaBull${tf}`, op: "is true" }], "bullish MMA alignment"],
  [/bearish (mma|alignment)|mma bearish|downtrend|down trend/, (tf) => [{ field: `mmaBear${tf}`, op: "is true" }], "bearish MMA alignment"],
  [/(breakout|break out)s? (on|with) volume|volume[- ](supported|confirmed) breakout/, () => [{ field: "breakoutVolume", op: "is true" }], "volume-supported breakout"],
  [/breakout|breaking out/, (tf) => [{ field: `breakout${tf}`, op: "is true" }], "breakout in the last 5 bars"],
  [/breakdown|breaking down/, (tf) => [{ field: `breakdown${tf}`, op: "is true" }], "breakdown"],
  [/consolidat/, (tf) => [{ field: `consolidation${tf}`, op: "is true" }], "consolidation"],
  [/unusual volume|volume spike|high volume/, () => [{ field: "unusualVolume", op: "is true" }], "volume >= 2x average"],
  [/accumulation/, () => [{ field: "accumulation", op: "is true" }], "accumulation"],
  [/distribution/, () => [{ field: "distribution", op: "is true" }], "distribution"],
  [/golden cross/, () => [{ field: "goldenCross", op: "is", value: "bull" }], "50/200 golden cross"],
  [/death cross/, () => [{ field: "goldenCross", op: "is", value: "bear" }], "50/200 death cross"],
  [/macd (bullish )?cross|macd turn(ing)? up/, (tf) => [{ field: `macdCross${tf}`, op: "is", value: "bull" }], "MACD bullish cross"],
  [/reversal/, (tf) => [{ field: `reversalUp${tf}`, op: "is true" }], "trend reversal up"],
  [/improving fundamentals|fundamentals improving|earnings (growth|momentum)/, () => [{ field: "fundImproving", op: "is true" }], "improving fundamentals"],
  [/(gaining|rising|increasing) weight|weight (rising|gaining|increasing)/, () => [{ field: "wwTrend", op: "in", value: "rising,turn_up_from_low" }], "Weight Watcher weight rising"],
  [/early[- ]stage|emerging setup|basing/, () => [{ field: "stageId", op: "between", value: 2, value2: 6 }], "early-stage setup (stage 2-6)"],
  [/above (the )?200/, () => [{ field: "above200", op: "is true" }], "above the 200-day EMA"],
  [/above (the )?50/, () => [{ field: "above50", op: "is true" }], "above the 50-day EMA"],
  [/below (the )?200/, () => [{ field: "above200", op: "is false" }], "below the 200-day EMA"],
  [/divergence/, () => [{ field: "rscDivergence", op: "is set" }], "price-RSC divergence"],
];

// comparison words: ">" family and "<" family (and "between a and b")
const GT = "(?:above|over|greater than|more than|higher than|at least|>=|>|exceeding|exceeds|min(?:imum)?)";
const LT = "(?:below|under|less than|lower than|at most|<=|<|max(?:imum)?)";
const NUM = "(-?\\d+(?:\\.\\d+)?)";
const UNIT = { t: 1e12, tn: 1e12, trillion: 1e12, b: 1e9, bn: 1e9, billion: 1e9, m: 1e6, mn: 1e6, mm: 1e6, million: 1e6, k: 1e3, thousand: 1e3 };
const money = (n, u) => +n * (UNIT[(u || "").toLowerCase()] || 1);
const UNITRE = "\\s?(t|tn|trillion|b|bn|billion|m|mn|mm|million|k|thousand)?\\b";
// score words -> field ("fundamental score above 50", "technical score > 60")
const SCORE_KIND = [["fundamentals?|fundamental|funda", "score_fundamentals", "fundamentals score"], ["technicals?|technical|tech", "score_technical", "technical score"],
  ["relative(?: strength)?|rs", "score_relative", "relative-strength score"], ["participation|volume", "score_participation", "participation score"], ["timeframes?|time frame|alignment", "score_timeframe", "timeframe score"],
  ["ai|setup|overall|total|ai setup", "score", "AI setup score"]];
const RET_H = { "1d": "1D", "1 day": "1D", "1w": "1W", "1 week": "1W", "weekly": "1W", "1m": "1M", "1 month": "1M", "monthly": "1M", "3m": "3M", "3 month": "3M", "3 months": "3M", "6m": "6M", "6 month": "6M", "6 months": "6M", "12m": "12M", "1y": "12M", "1 year": "12M", "12 months": "12M", "yearly": "12M", "annual": "12M", "ytd": "YTD" };

const NUMERIC = [
  [new RegExp(`(?:weekly |daily |monthly )?rsi ${GT} ${NUM}`), (m, tf) => ({ field: `rsi${tf}`, op: ">", value: +m[1] }), (m) => `RSI above ${m[1]}`],
  [new RegExp(`(?:weekly |daily |monthly )?rsi ${LT} ${NUM}`), (m, tf) => ({ field: `rsi${tf}`, op: "<", value: +m[1] }), (m) => `RSI below ${m[1]}`],
  [new RegExp(`revenue growth ${GT} ${NUM}%?`), (m) => ({ field: "revenueGrowthYoY", op: ">", value: +m[1] }), (m) => `revenue growth above ${m[1]}%`],
  [new RegExp(`eps growth ${GT} ${NUM}%?`), (m) => ({ field: "epsGrowthYoY", op: ">", value: +m[1] }), (m) => `EPS growth above ${m[1]}%`],
  [new RegExp(`(?:pe|p/e|pe ratio) ${LT} ${NUM}`), (m) => ({ field: "pe", op: "<", value: +m[1] }), (m) => `P/E below ${m[1]}`],
  [new RegExp(`(?:pe|p/e|pe ratio) ${GT} ${NUM}`), (m) => ({ field: "pe", op: ">", value: +m[1] }), (m) => `P/E above ${m[1]}`],
  [new RegExp(`roe ${GT} ${NUM}%?`), (m) => ({ field: "roe", op: ">", value: +m[1] }), (m) => `ROE above ${m[1]}%`],
  [new RegExp(`market cap (?:between|from) \\$?${NUM}${UNITRE} (?:and|to|-) \\$?${NUM}${UNITRE}`), (m) => ({ field: "capUsd", op: "between", value: money(m[1], m[2] || m[4]), value2: money(m[3], m[4]) }), (m) => `market cap between $${m[1]}${m[2] || m[4] || ""} and $${m[3]}${m[4] || ""}`],
  [new RegExp(`market cap ${GT} (?:of )?\\$?${NUM}${UNITRE}`), (m) => ({ field: "capUsd", op: ">", value: money(m[1], m[2]) }), (m) => `market cap above $${m[1]}${(m[2] || "").toUpperCase()}`],
  [new RegExp(`market cap ${LT} (?:of )?\\$?${NUM}${UNITRE}`), (m) => ({ field: "capUsd", op: "<", value: money(m[1], m[2]) }), (m) => `market cap below $${m[1]}${(m[2] || "").toUpperCase()}`],
  [new RegExp(`(?:traded value|turnover|liquidity) ${GT} \\$?${NUM}${UNITRE}`), (m) => ({ field: "tradedValueUsd", op: ">", value: money(m[1], m[2]) }), (m) => `traded value above $${m[1]}${(m[2] || "").toUpperCase()}`],
  ...SCORE_KIND.flatMap(([w, field, label]) => [
    [new RegExp(`(?:${w}) scores? ${GT} ${NUM}`), (m) => ({ field, op: ">", value: +m[1] }), (m) => `${label} above ${m[1]}`],
    [new RegExp(`(?:${w}) scores? ${LT} ${NUM}`), (m) => ({ field, op: "<", value: +m[1] }), (m) => `${label} below ${m[1]}`],
  ]),
  [new RegExp(`scores? ${GT} ${NUM}`), (m) => ({ field: "score", op: ">", value: +m[1] }), (m) => `AI setup score above ${m[1]}`],
  [new RegExp(`scores? ${LT} ${NUM}`), (m) => ({ field: "score", op: "<", value: +m[1] }), (m) => `AI setup score below ${m[1]}`],
  [new RegExp(`(${Object.keys(RET_H).join("|")}) (?:return|returns|performance|change|gain) ${GT} ${NUM}%?`), (m) => ({ field: `ret${RET_H[m[1]]}`, op: ">", value: +m[2] }), (m) => `${RET_H[m[1]]} return above ${m[2]}%`],
  [new RegExp(`(${Object.keys(RET_H).join("|")}) (?:return|returns|performance|change) ${LT} ${NUM}%?`), (m) => ({ field: `ret${RET_H[m[1]]}`, op: "<", value: +m[2] }), (m) => `${RET_H[m[1]]} return below ${m[2]}%`],
  [new RegExp(`(?:up|gained|rallied) (?:more than |over |at least )?${NUM}% (?:in|over) (?:the )?(?:last |past )?(1 week|1 month|3 months|6 months|1 year|week|month|year|ytd)`), (m) => ({ field: `ret${RET_H[m[2].replace(/^(week|month|year)$/, "1 $1")] || "1M"}`, op: ">", value: +m[1] }), (m) => `up more than ${m[1]}% over ${m[2]}`],
];

/** Typos and spellings people actually type, folded before parsing. */
function normalise(t) {
  return t
    .replace(/\b(m(ar)?k(e)?t|makret|marekt|mrkt|mkt)[ -]?(cap(italization|italisation)?|caps)\b/g, "market cap")
    .replace(/\bmarket[ -]?capitali[sz]ation\b|\bmarketcap\b|\bm[ -]?cap\b|\bmcap\b/g, "market cap")
    .replace(/\bfund[ae]?m[ae]?n?t[ae]?ls?\b|\bfundamnetal\b/g, "fundamental")
    .replace(/\btechincal\b|\btechnial\b|\btechnicals\b/g, "technical")
    .replace(/\$\s?(\d)/g, "$$$1")
    .replace(/(\d)\s?(bn|b|billion|mn|million|tn|trillion)\b/g, "$1 $2")
    .replace(/ (is |are |of )?(greater than or equal to|more than or equal to) /g, " at least ")
    .replace(/ score of (above|over|more than|greater than|below|under|less than) /g, " score $1 ")
    .replace(/ scores? (is |are )?(should be |must be )?(also )?/g, " score ")
    .replace(/ score (\d)/g, " score above $1");
}

const HORIZON_WORDS = [[/(this|1|one|past|last) week|weekly (return|performance)/, "1W"], [/(1|one|past|last) month|this month/, "1M"], [/(3|three) months?|quarter/, "3M"], [/(6|six) months?|half[- ]year/, "6M"], [/(12|twelve) months?|(1|one|past|last) year|this year|annual/, "12M"], [/ytd|year to date/, "YTD"]];

// Tokens that are vocabulary here, never a ticker ("IT stocks" is a sector, not Gartner).
const STOP = new Set([...Object.keys(SECTOR_ALIASES), ...Object.keys(COUNTRY_ALIASES), ...Object.keys(REGION_ALIASES), ...Object.keys(CLASS_ALIASES),
  "a", "an", "the", "all", "on", "in", "of", "for", "and", "or", "by", "to", "is", "are", "with", "show", "find", "top", "best", "rsi", "mma", "rsc", "macd", "ema", "dma", "pe", "roe", "eps", "ww", "ew", "cw", "usd", "go", "open", "me", "my", "now", "today", "week", "weekly", "daily", "monthly", "cap", "large", "mid", "small", "high", "low", "new", "stocks", "stock"]);

export function parseCommand(text, ctx = {}) {
  const raw = String(text || "").trim();
  const t = normalise(` ${raw.toLowerCase().replace(/[?!,]/g, " ").replace(/\.(?!\d)/g, " ").replace(/\s+/g, " ")} `);
  const understood = [];
  const out = { raw, intent: null, page: null, conditions: [], scope: {}, sort: null, limit: null, tf: null, horizon: null, symbol: null, securityId: null, understood, theme: null };

  // timeframe
  if (/ daily | day /.test(t)) out.tf = "D"; else if (/ weekly | week /.test(t) && !/this week|1 week|one week|past week|last week/.test(t)) out.tf = "W"; else if (/ monthly /.test(t)) out.tf = "M";
  if (/ quarterly /.test(t)) out.tf = "Q"; if (/ yearly | annually /.test(t)) out.tf = "Y";
  const tf = out.tf && ["D", "W", "M"].includes(out.tf) ? out.tf : "W";
  if (out.tf) understood.push(`timeframe: ${{ D: "daily", W: "weekly", M: "monthly", Q: "quarterly", Y: "yearly" }[out.tf]}`);
  for (const [re, h] of HORIZON_WORDS) if (re.test(t)) { out.horizon = h; understood.push(`horizon: ${h}`); break; }

  // theme
  if (/dark (mode|theme)/.test(t)) { out.intent = "theme"; out.theme = "dark"; understood.push("switch to dark mode"); return out; }
  if (/light (mode|theme)/.test(t)) { out.intent = "theme"; out.theme = "light"; understood.push("switch to light mode"); return out; }
  if (/(system|device|auto(matic)?) (mode|theme)/.test(t)) { out.intent = "theme"; out.theme = "system"; understood.push("follow the device theme"); return out; }

  // security mention
  const secs = ctx.securities || [];
  if (secs.length) {
    const words = raw.split(/[^A-Za-z0-9.&-]+/).filter(Boolean);
    for (const w of words) {
      // a bare number is a value ("score above 50"), never a ticker, unless the whole question is that number
      if (w.length < 2 || STOP.has(w.toLowerCase()) || (/^\d+(\.\d+)?$/.test(w) && words.length > 1)) continue;
      const hit = secs.find((s) => s.symbol === w || s.symbol === w.toUpperCase() && w === w.toUpperCase());
      if (hit) { out.symbol = hit.symbol; out.securityId = hit.id; understood.push(`security: ${hit.symbol} (${hit.name})`); break; }
    }
    if (!out.securityId) {
      const lower = t.trim();
      const byName = secs.filter((s) => s.name && s.name.length > 4 && lower.includes(s.name.toLowerCase())).sort((a, b) => b.name.length - a.name.length)[0];
      if (byName) { out.symbol = byName.symbol; out.securityId = byName.id; understood.push(`security: ${byName.symbol} (${byName.name})`); }
    }
  }

  // geography
  const countries = ctx.countries || knownCountries();
  for (const c of [...countries].sort((a, b) => b.length - a.length)) if (t.includes(` ${c.toLowerCase()} `)) { out.scope.country = c; break; }
  if (!out.scope.country) for (const [a, c] of Object.entries(COUNTRY_ALIASES)) if (t.includes(` ${a} `) && countries.includes(c)) { out.scope.country = c; break; }
  if (!out.scope.country) {
    for (const r of REGIONS) if (t.includes(` ${r.toLowerCase()} `)) out.scope.region = r;
    for (const [a, r] of Object.entries(REGION_ALIASES)) if (t.includes(` ${a} `)) out.scope.region = r;
    for (const [a, c] of Object.entries(CLASS_ALIASES)) if (t.includes(` ${a} `)) { out.scope.classification = c; delete out.scope.region; }
    for (const c of CLASSIFICATIONS) if (t.includes(` ${c.toLowerCase()} `)) out.scope.classification = c;
  }
  if (out.scope.country) understood.push(`country: ${out.scope.country}`);
  if (out.scope.region) understood.push(`region: ${out.scope.region}`);
  if (out.scope.classification) understood.push(`market class: ${out.scope.classification}`);

  // sector / industry group
  for (const s of SECTORS) if (t.includes(` ${s.toLowerCase()} `)) { out.scope.sector = s; break; }
  if (!out.scope.sector) for (const g of INDUSTRY_GROUPS) if (g.length > 4 && t.includes(` ${g.toLowerCase()} `)) { out.scope.industryGroup = g; break; }
  if (!out.scope.sector && !out.scope.industryGroup) for (const [a, s] of Object.entries(SECTOR_ALIASES)) if (s && t.includes(` ${a} `)) { out.scope.sector = s; break; }
  if (/consumer staples/.test(t)) out.scope.sector = "Consumer Staples";
  if (/consumer discretionary/.test(t)) out.scope.sector = "Consumer Discretionary";
  if (out.scope.sector) understood.push(`sector: ${out.scope.sector}`);
  if (out.scope.industryGroup) understood.push(`industry group: ${out.scope.industryGroup}`);
  if (/large[- ]?cap/.test(t)) out.scope.cap = "Large"; else if (/mid[- ]?cap/.test(t)) out.scope.cap = "Mid"; else if (/small[- ]?cap/.test(t)) out.scope.cap = "Small";
  if (out.scope.cap) understood.push(`cap segment: ${out.scope.cap}`);

  // numeric conditions then phrase signals
  let rest = t;
  for (const [re, mk, label] of NUMERIC) { let m; while ((m = rest.match(re))) { out.conditions.push(mk(m, tf)); understood.push(label(m)); rest = rest.replace(m[0], " "); } }
  for (const [re, mk, label] of SIGNALS) { if (re.test(rest)) { out.conditions.push(...mk(tf)); understood.push(label); rest = rest.replace(re, " "); } }

  // ranking
  const top = t.match(/ (top|best|first|biggest|largest|smallest|bottom|last) (\d+) /) || t.match(/ (\d+) (biggest|largest|smallest|top|best) /);
  if (top) { out.limit = +(/^\d+$/.test(top[1]) ? top[1] : top[2]); understood.push(`limit: ${out.limit}`); }
  // "by / based on market cap", "biggest", "largest": rank by size, not by the AI score
  const bySize = /(by|on|based on|in terms of|ranked by|sorted by|order by) (market cap|marketcap|mcap|market capitali[sz]ation|size|cap) |\b(biggest|largest|most valuable|mega)\b/.test(t);
  const smallFirst = /\b(smallest|tiniest)\b/.test(t);
  if (/strongest|best|leaders|leading|top/.test(t)) out.sort = { field: out.horizon ? `ret${out.horizon}` : out.conditions.some((c) => c.field.startsWith("rsc")) ? "rscChg_country_3M" : "score", dir: "desc" };
  if (/weakest|worst|laggards|lagging/.test(t)) out.sort = { field: out.horizon ? `ret${out.horizon}` : "score", dir: "asc" };
  if (/gainers|best perform|top perform/.test(t)) out.sort = { field: `ret${out.horizon || "1M"}`, dir: "desc" };
  if (/losers|worst perform/.test(t)) out.sort = { field: `ret${out.horizon || "1M"}`, dir: "asc" };
  if (bySize || smallFirst) out.sort = { field: "capUsd", dir: smallFirst ? "asc" : "desc" };
  if (out.sort) understood.push(`sorted by ${out.sort.field} ${out.sort.dir === "desc" ? "high to low" : "low to high"}`);

  // intent
  const pageHit = Object.entries(PAGES).sort((a, b) => b[0].length - a[0].length).find(([k]) => t.includes(` ${k} `));
  const wantsChart = /chart|rsiacc|rscacc|rsimma|rscmma|open/.test(t);
  const question = /^ (why|how|what|which|is|are|explain|tell me|describe|compare)/.test(t);
  // a list question with conditions is a screen even if a word happened to look like a ticker or a name
  const listy = /\b(list|show|find|screen|scan|give|which|stocks|companies|names|shares|etfs?)\b/.test(t);
  if (out.securityId && out.conditions.length && listy && !/\b(explain|analy[sz]e|tell me about)\b/.test(t)) {
    const k = understood.findIndex((u) => u.startsWith("security:")); if (k >= 0) understood.splice(k, 1);
    out.securityId = null; out.symbol = null;
  }
  if (/\betfs?\b|exchange traded fund/.test(t)) { out.scope.assetClass = "ETF"; understood.push("asset class: ETF"); }
  else if (/\b(stocks?|companies|shares|equities|names)\b/.test(t) || out.conditions.some((c) => /^score|^cap|^pe$|^roe$|growth/.test(c.field))) { out.scope.assetClass = "Stock"; understood.push("asset class: stocks"); }
  if (out.securityId && (question || /explain|analy[sz]e|about/.test(t))) out.intent = "explain";
  else if (out.securityId && wantsChart) { out.intent = "chart"; out.page = (pageHit && pageHit[1].startsWith("screens/")) ? pageHit[1] : "screens/RSIMMA"; }
  else if (out.securityId) out.intent = "stock";
  else if (/rotation|leading sector|sectors? (are )?(leading|lagging)|which sectors/.test(t)) out.intent = "rotation";
  else if (/breadth|participation|advance|decline/.test(t) && !out.conditions.length) out.intent = "breadth";
  else if (/regime|trending|volatil/.test(t) && !out.conditions.length) out.intent = "regime";
  else if (out.conditions.length || out.sort || /show|find|list|screen|scan|stocks|companies|names/.test(t)) out.intent = "screen";
  else if (pageHit) { out.intent = "navigate"; out.page = pageHit[1]; }
  if (out.sort && out.intent !== "screen") { const k = understood.findIndex((u) => u.startsWith("sorted by")); if (k >= 0) understood.splice(k, 1); out.sort = null; }
  if (out.intent === "navigate" || out.intent === "chart") understood.push(`open ${out.page}`);
  if (!out.intent) out.intent = "unknown";
  return out;
}
