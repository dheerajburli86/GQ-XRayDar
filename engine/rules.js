// Single-indicator alert rules (feature list 3.1-3.17). Each rule is a per-bar
// predicate on ONE timeframe's candles. An alert FIRES on an edge: the predicate
// was false on the previous candle and is true on the newest one, so a rule that
// already holds when it is created stays quiet until the condition clears and
// returns. Same rules run in the browser (preview) and on the server (delivery).

import { aggregate, ema, sma, rsi, macd, groupSpreadPct, emaStrict } from "./indicators.js";

const SHORT = [3, 5, 8, 10, 12, 15];

export const RULES = {
  rsi_cross_above: { label: (p) => `RSI(14) rises above ${p.level}`, need: 30, params: { level: [1, 99] }, group: "RSI" },
  rsi_cross_below: { label: (p) => `RSI(14) falls below ${p.level}`, need: 30, params: { level: [1, 99] }, group: "RSI" },
  macd_bull_cross: { label: () => "MACD crosses above its signal line", need: 40, params: {}, group: "MACD" },
  macd_bear_cross: { label: () => "MACD crosses below its signal line", need: 40, params: {}, group: "MACD" },
  price_cross_above_sma: { label: (p) => `Close crosses above its ${p.period}-period average`, need: (p) => p.period + 2, params: { period: [2, 400] }, group: "Moving averages" },
  price_cross_below_sma: { label: (p) => `Close crosses below its ${p.period}-period average`, need: (p) => p.period + 2, params: { period: [2, 400] }, group: "Moving averages" },
  price_cross_above_ema: { label: (p) => `Close crosses above its ${p.period}-period EMA`, need: (p) => p.period + 2, params: { period: [2, 400] }, group: "Moving averages" },
  price_cross_below_ema: { label: (p) => `Close crosses below its ${p.period}-period EMA`, need: (p) => p.period + 2, params: { period: [2, 400] }, group: "Moving averages" },
  price_above: { label: (p) => `Close rises above ${p.price}`, need: 2, params: { price: [0, 1e12] }, group: "Price" },
  price_below: { label: (p) => `Close falls below ${p.price}`, need: 2, params: { price: [0, 1e12] }, group: "Price" },
  golden_cross: { label: () => "Golden cross: 50-period average crosses above the 200", need: 202, params: {}, group: "Moving averages" },
  death_cross: { label: () => "Death cross: 50-period average crosses below the 200", need: 202, params: {}, group: "Moving averages" },
  bb_break_upper: { label: () => "Close breaks above the upper Bollinger band (20, 2)", need: 22, params: {}, group: "Volatility" },
  bb_break_lower: { label: () => "Close breaks below the lower Bollinger band (20, 2)", need: 22, params: {}, group: "Volatility" },
  new_high_n: { label: (p) => `Close makes a new ${p.bars}-candle high`, need: (p) => p.bars + 2, params: { bars: [5, 500] }, group: "Highs / lows" },
  new_low_n: { label: (p) => `Close makes a new ${p.bars}-candle low`, need: (p) => p.bars + 2, params: { bars: [5, 500] }, group: "Highs / lows" },
  mma_compression: { label: (p) => `Short-term MMA spread tightens below ${p.pct}%`, need: 40, params: { pct: [0.05, 20] }, group: "MMA" },
};
export const DEFAULT_PARAMS = {
  rsi_cross_above: { level: 70 }, rsi_cross_below: { level: 30 },
  price_cross_above_sma: { period: 50 }, price_cross_below_sma: { period: 50 },
  price_cross_above_ema: { period: 20 }, price_cross_below_ema: { period: 20 },
  price_above: { price: 0 }, price_below: { price: 0 },
  new_high_n: { bars: 52 }, new_low_n: { bars: 52 }, mma_compression: { pct: 1.0 },
};

export function normalizeParams(rule, params) {
  const def = RULES[rule];
  if (!def) return { error: `unknown rule ${rule}` };
  const out = { ...(DEFAULT_PARAMS[rule] || {}) };
  for (const [k, [lo, hi]] of Object.entries(def.params)) {
    const raw = params && params[k] !== undefined && params[k] !== "" ? Number(params[k]) : out[k];
    if (!Number.isFinite(raw)) return { error: `${k} is required` };
    if (raw < lo || raw > hi) return { error: `${k} must be between ${lo} and ${hi}` };
    out[k] = ["period", "bars"].includes(k) ? Math.round(raw) : raw;
  }
  return { params: out };
}
export const describeRule = (rule, params) => (RULES[rule] ? RULES[rule].label({ ...(DEFAULT_PARAMS[rule] || {}), ...(params || {}) }) : rule);

function bollinger(c, n = 20, k = 2) {
  const mid = sma(c, n), up = new Array(c.length).fill(null), lo = new Array(c.length).fill(null);
  for (let i = n - 1; i < c.length; i++) {
    if (mid[i] == null) continue;
    let v = 0; for (let j = i - n + 1; j <= i; j++) v += (c[j] - mid[i]) ** 2;
    const sd = Math.sqrt(v / n); up[i] = mid[i] + k * sd; lo[i] = mid[i] - k * sd;
  }
  return { mid, up, lo };
}

/** Predicate series (true / false / null per candle) and the value shown in the alert. */
export function predicate(rule, p, c) {
  switch (rule) {
    case "rsi_cross_above": case "rsi_cross_below": {
      const r = rsi(c, 14);
      return { pred: r.map((v) => (v == null ? null : rule === "rsi_cross_above" ? v > p.level : v < p.level)), value: r };
    }
    case "macd_bull_cross": case "macd_bear_cross": {
      const m = macd(c);
      return { pred: m.line.map((v, i) => (i < 33 || v == null ? null : rule === "macd_bull_cross" ? v > m.signal[i] : v < m.signal[i])), value: m.hist };
    }
    case "price_cross_above_sma": case "price_cross_below_sma": case "price_cross_above_ema": case "price_cross_below_ema": {
      const ma = rule.includes("sma") ? sma(c, p.period) : emaStrict(c, p.period);
      const up = rule.includes("above");
      return { pred: c.map((v, i) => (ma[i] == null ? null : up ? v > ma[i] : v < ma[i])), value: ma };
    }
    case "price_above": return { pred: c.map((v) => v > p.price), value: c };
    case "price_below": return { pred: c.map((v) => v < p.price), value: c };
    case "golden_cross": case "death_cross": {
      const a = sma(c, 50), b = sma(c, 200);
      return { pred: c.map((_, i) => (b[i] == null ? null : rule === "golden_cross" ? a[i] > b[i] : a[i] < b[i])), value: a };
    }
    case "bb_break_upper": case "bb_break_lower": {
      const bb = bollinger(c);
      return { pred: c.map((v, i) => (bb.mid[i] == null ? null : rule === "bb_break_upper" ? v > bb.up[i] : v < bb.lo[i])), value: rule === "bb_break_upper" ? bb.up : bb.lo };
    }
    case "new_high_n": case "new_low_n": {
      const hi = rule === "new_high_n";
      return { pred: c.map((v, i) => { if (i < p.bars) return null; let m = hi ? -Infinity : Infinity; for (let j = i - p.bars; j < i; j++) m = hi ? Math.max(m, c[j]) : Math.min(m, c[j]); return hi ? v > m : v < m; }), value: c };
    }
    case "mma_compression": {
      const lines = SHORT.map((n) => ema(c, n));
      const s = c.map((_, i) => (i < 30 ? null : groupSpreadPct(lines, i)));
      return { pred: s.map((v) => (v == null ? null : v < p.pct)), value: s };
    }
    default: return { pred: c.map(() => null), value: c };
  }
}

/**
 * Evaluate a rule on daily bars aggregated to `tf`.
 * -> { ok, fired, state, barTime, barKey, value, reason }
 */
export function evaluateRule(rule, params, daily, tf = "D") {
  const def = RULES[rule];
  if (!def) return { ok: false, reason: `unknown rule ${rule}` };
  const norm = normalizeParams(rule, params);
  if (norm.error) return { ok: false, reason: norm.error };
  const p = norm.params;
  const b = aggregate(daily, tf);
  const need = typeof def.need === "function" ? def.need(p) : def.need;
  if (!b.close || b.close.length < need) return { ok: false, reason: `needs ${need} candles, has ${b.close ? b.close.length : 0}` };
  const c = Array.from(b.close);
  const { pred, value } = predicate(rule, p, c);
  const n = c.length - 1;
  if (pred[n] == null || pred[n - 1] == null) return { ok: false, reason: "indicator still warming up" };
  return { ok: true, state: pred[n], fired: pred[n] === true && pred[n - 1] === false, barTime: b.time[n], barKey: (b.key || b.time)[n], value: value[n] ?? null, close: c[n] };
}

/** Every past firing of a rule (for the alert report card): [{index, time}] */
export function ruleHistory(rule, params, daily, tf = "D") {
  const norm = normalizeParams(rule, params);
  if (norm.error) return [];
  const b = aggregate(daily, tf);
  const c = Array.from(b.close);
  const { pred } = predicate(rule, norm.params, c);
  const out = [];
  for (let i = 1; i < c.length; i++) if (pred[i] === true && pred[i - 1] === false) out.push({ index: i, time: b.time[i] });
  return out;
}

/** Direction the rule implies, for scoring "was it followed by the expected move". */
export const RULE_DIRECTION = {
  rsi_cross_above: -1, rsi_cross_below: 1, macd_bull_cross: 1, macd_bear_cross: -1, price_cross_above_sma: 1, price_cross_below_sma: -1,
  price_cross_above_ema: 1, price_cross_below_ema: -1, price_above: 1, price_below: -1, golden_cross: 1, death_cross: -1,
  bb_break_upper: 1, bb_break_lower: -1, new_high_n: 1, new_low_n: -1, mma_compression: 0,
};
