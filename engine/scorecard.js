// Alert report card and "test an idea on past data": replay every past firing
// of a single-indicator rule and measure what followed. Entry is the close of
// the candle AFTER the signal (no look-ahead); returns are local-currency,
// split-adjusted. A "hit" is a move in the direction the rule implies;
// direction-neutral rules (a squeeze) report the size of the move only.
// It describes the past; it predicts nothing.
import { ruleHistory, RULE_DIRECTION, describeRule, RULES } from "./rules.js";
import { aggregate } from "./indicators.js";

export const SCORECARD_HORIZONS = { D: [[5, "1W"], [21, "1M"], [63, "3M"]], W: [[4, "1M"], [13, "3M"], [26, "6M"]], M: [[3, "3M"], [6, "6M"], [12, "12M"]] };

function stats(a, dir) {
  if (!a.length) return { n: 0, mean: null, median: null, hitRate: null, best: null, worst: null };
  const s = [...a].sort((x, y) => x - y);
  const r = (v) => Math.round(v * 100) / 100;
  return {
    n: a.length, mean: r(a.reduce((x, y) => x + y, 0) / a.length), median: r(s[Math.floor(s.length / 2)]),
    hitRate: dir === 0 ? null : r((a.filter((v) => (dir > 0 ? v > 0 : v < 0)).length / a.length) * 100),
    best: r(s.at(-1)), worst: r(s[0]),
  };
}

/**
 * barsById: Map(id -> daily column bars). Returns the card plus per-firing trades
 * (newest first, capped) so a page can list what happened each time.
 */
export function ruleScorecard(barsById, { rule, params = {}, tf = "D", maxTrades = 300, symbolOf = (id) => id }) {
  if (!RULES[rule]) throw new Error(`unknown rule ${rule}`);
  const hz = SCORECARD_HORIZONS[tf];
  if (!hz) throw new Error("tf must be D, W or M");
  const dir = RULE_DIRECTION[rule] ?? 0;
  const per = hz.map(() => []);
  const trades = [];
  let firings = 0, instrumentsFired = 0, tested = 0;
  for (const [id, b] of barsById) {
    if (!b?.close?.length) continue;
    tested++;
    const hist = ruleHistory(rule, params, b, tf);
    if (!hist.length) continue;
    instrumentsFired++; firings += hist.length;
    const ab = aggregate(b, tf);
    const c = ab.close;
    for (const f of hist) {
      const e = f.index + 1;
      if (e >= c.length) { trades.push({ id, symbol: symbolOf(id), date: f.time, entry: null, open: true, ret: {} }); continue; }
      const ret = {};
      hz.forEach(([h, label], k) => { if (e + h < c.length) { const v = (c[e + h] / c[e] - 1) * 100; per[k].push(v); ret[label] = Math.round(v * 100) / 100; } });
      trades.push({ id, symbol: symbolOf(id), date: f.time, entryDate: ab.time[e], entry: c[e], ret });
    }
  }
  trades.sort((x, y) => (x.date < y.date ? 1 : -1));
  return {
    rule, label: describeRule(rule, params), tf, direction: dir > 0 ? "up" : dir < 0 ? "down" : "neutral",
    instrumentsTested: tested, instrumentsFired, firings,
    summary: hz.map(([, label], k) => ({ horizon: label, ...stats(per[k], dir) })),
    trades: trades.slice(0, maxTrades),
    method: "Every past firing; entry at the close of the candle after the signal; local currency, split-adjusted. Hit = moved in the rule's direction.",
  };
}
