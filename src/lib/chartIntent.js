// Turns "make it candlesticks", "open RSIMMA", "switch to weekly", "RSCACC monthly and quarterly" into a change of
// the chart that is OPEN (Alok Sir, 2026-11-26: the agent must change the open chart, not send a new link).
// Pure: returns {style, screen, tf, tf2} or null. null = the sentence is about something else (another stock,
// a question), and the GQ agent answers it.

export const STYLE_WORDS = [
  [/\bheikin[\s-]?ashi\b|\bha\b/, "ha"],
  [/\bcandle(stick)?s?\b/, "candles"],
  [/\bline( chart| graph)?\b/, "line"],
  [/\b(ohlc )?bars?( chart)?\b/, "bar"],
  [/\brenko\b/, "renko"],
  [/\bkagi\b/, "kagi"],
  [/\bpoint (and|&) figure\b|\bp&f\b|\bpnf\b/, "pnf"],
  [/\bmarket profile\b|\btpo\b/, "tpo"],
];
const SCREEN = /\b(rsimma|rsiacc|rscmma|rscacc)\b/;
const TF_WORDS = [
  [/\b(daily|day)\b/, "D"], [/\b(weekly|week)\b/, "W"], [/\b(monthly|month)\b/, "M"], [/\b(quarterly|quarter)\b/, "Q"],
  [/\b(half[\s-]?yearly|half[\s-]?year)\b/, "H"], [/\b(9[\s-]?months?|nine[\s-]?months?)\b/, "N"], [/\b(yearly|annual|year)\b/, "Y"],
];
// every word a pure "change the open chart" sentence may contain; anything else (a ticker, a question) goes to the agent
const FILLER = new Set(("open show switch change convert make turn set put view display go use apply please pls can could you me my to the a an it this "
  + "that chart charts graph screen screens view type style in into as on with and for timeframe time frame period periods candle candles candlestick "
  + "candlesticks line bar bars ohlc heikin ashi ha renko kagi point figure pnf p&f market profile tpo daily day weekly week monthly month quarterly "
  + "quarter half yearly year annual nine 9 months left right side window instead now same stock also both one other "
  + "rsimma rsiacc rscmma rscacc d w m q h n y").split(/\s+/));

export function parseChartIntent(text) {
  const t = String(text || "").toLowerCase().replace(/[^a-z0-9&\s-]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  const words = t.split(/[\s-]+/).filter(Boolean);
  if (words.some((w) => !FILLER.has(w))) return null;
  const out = {};
  for (const [re, s] of STYLE_WORDS) if (re.test(t)) { out.style = s; break; }
  const sc = t.match(SCREEN);
  if (sc) out.screen = sc[1].toUpperCase();
  // periods in the order written: the first is the left window, the second the right one
  const hits = [];
  for (const [re, tf] of TF_WORDS) { const g = new RegExp(re.source, "g"); let m; while ((m = g.exec(t))) hits.push([m.index, tf]); }
  const single = t.match(/(?:^|\s)([dwmqhny])(?:\s|$)/);
  if (single) hits.push([single.index, single[1].toUpperCase()]);
  hits.sort((a, b) => a[0] - b[0]);
  const tfs = [...new Set(hits.map((h) => h[1]))];
  if (tfs[0]) out.tf = tfs[0];
  if (tfs[1]) out.tf2 = tfs[1];
  // a screen keeps its own price display; candle styles belong to the Chart lab
  if (out.screen && out.style) delete out.style;
  return Object.keys(out).length ? out : null;
}

const QUESTION = new Set("why what how when where who which is are was were does do did will would should can could has have had than if because".split(" "));
const NOISE = new Set(["for", "of", "on", "to", "the", "a", "an", "please", "pls", "me", "my"]);
/**
 * "show candlestick chart for TSLA", "weekly line chart of apple": a chart request that also names the instrument.
 * Returns {intent, query} (query = the words that are not chart vocabulary) or null. The caller must resolve `query` to
 * exactly one instrument; if it cannot, the sentence is left to the GQ agent. Questions are never taken as commands.
 */
export function parseChartRequest(text) {
  const t = String(text || "").toLowerCase().replace(/[^a-z0-9&\s.-]/g, " ").replace(/\s+/g, " ").trim();
  const words = t.split(/\s+/).filter(Boolean);
  const extra = words.filter((w) => !FILLER.has(w.replace(/-/g, "")) && !NOISE.has(w));
  if (!extra.length || extra.length > 3 || extra.some((w) => QUESTION.has(w))) return null;
  const rest = words.filter((w) => !extra.includes(w)).join(" ");
  const intent = parseChartIntent(rest);
  if (!intent || (!intent.style && !intent.screen)) return null;
  return { intent, query: extra.join(" ") };
}

/**
 * Where the open chart goes for an intent. ctx = {page, instrumentId, instKey, tf, mode, left, right} from the page.
 * Returns {path, query, style, label} or null when the open page cannot take this change.
 */
export function applyChartIntent(intent, ctx) {
  if (!intent || !ctx) return null;
  const key = ctx.instKey || (ctx.instrumentId ? `s:${ctx.instrumentId}` : null);
  if (!key) return null;
  const secId = key.startsWith("s:") ? key.slice(2) : null;
  const screen = intent.screen || (ctx.page === "screens" && !intent.style ? ctx.mode : null);
  if (screen) {
    const q = {};
    if (intent.tf) q.l = intent.tf; else if (ctx.keepTf && ctx.left) q.l = ctx.left;
    if (intent.tf2) q.r = intent.tf2; else if (ctx.keepTf && ctx.right) q.r = ctx.right;
    return { path: `screens/${screen}/${encodeURIComponent(key)}`, query: q, label: `${screen}${intent.tf ? ` · ${intent.tf}${intent.tf2 ? ` | ${intent.tf2}` : ""}` : ""}` };
  }
  if (!secId) return null; // house indices / extras have no Chart lab
  const q = {};
  if (intent.tf) q.tf = intent.tf;
  else if (ctx.keepTf && ctx.tf) q.tf = ctx.tf;      // another instrument on the same chart keeps the period in force
  if (intent.style) q.style = intent.style;
  return { path: `chart/${secId}`, query: q, style: intent.style || null, label: [intent.style && STYLE_LABEL[intent.style], intent.tf].filter(Boolean).join(" · ") || "chart" };
}

export const STYLE_LABEL = { candles: "Candles", ha: "Heikin-Ashi", line: "Line", bar: "Bars", renko: "Renko", kagi: "Kagi", pnf: "Point & Figure", tpo: "Market profile" };

/** The single in-app link of an agent answer, when the person asked to open / show / switch something. */
export function linkToFollow(question, answer, origin) {
  if (!/\b(open|show|switch|change|convert|make|turn|display|go to|bring up|pull up|load)\b/i.test(question || "")) return null;
  const re = /\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s)<]+)/g;
  const own = new Set();
  let m;
  while ((m = re.exec(answer || ""))) { const u = m[1] || m[2]; if (origin && u.startsWith(`${origin}/#/`)) own.add(u.slice(origin.length + 3)); }
  return own.size === 1 ? [...own][0] : null;
}
