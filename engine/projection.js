// Conditional price projection (owner's feature list: "Conditional Price Projection Engine with
// Dynamic Chart Overlay"). A projection = a condition (a formula, or none = from now), a side
// (up / down), an optional target and a method. It is recomputed from the candles every time
// they change, so a new candle, a timeframe switch or a met / failed condition updates it.
//
//   condition   formula (engine/formula.js), e.g. "close > 2380 and rsi(close, 14) > 55"
//   target      { kind: "price" | "pct" | "atr", value } or null
//   method      used when there is no target: measured | atr | pct | analogue | slope
//   horizon     candles the path runs over
//   invalidate  price that kills a long (below) / short (above) projection once triggered
// Every result says which method was used, and an analogue says how many past cases it rests on.
import { evalFormula } from "./formula.js";
import { atrW } from "./studies.js";

export const METHODS = [
  { value: "measured", label: "Measured move (last swing repeated)" },
  { value: "atr", label: "ATR multiple" },
  { value: "pct", label: "Percent" },
  { value: "analogue", label: "Historical analogue (average after past signals)" },
  { value: "slope", label: "Fixed slope (% per candle)" },
];

const num = (v) => typeof v === "number" && Number.isFinite(v);

/** Add n trading days (Mon-Fri) after an ISO date. */
export function addSessions(date, n, tf = "D") {
  const d = new Date(`${date}T00:00:00Z`);
  const stepDays = tf === "W" ? 7 : tf === "M" ? 30.44 : tf === "Q" ? 91.3 : tf === "H" ? 182.6 : tf === "Y" ? 365.25 : 0;
  if (stepDays) { d.setUTCDate(d.getUTCDate() + Math.round(stepDays * n)); return d.toISOString().slice(0, 10); }
  let k = 0;
  while (k < n) { d.setUTCDate(d.getUTCDate() + 1); const w = d.getUTCDay(); if (w !== 0 && w !== 6) k++; }
  return d.toISOString().slice(0, 10);
}

/**
 * bars: {time, open, high, low, close}; p: projection spec; tf for future dates.
 * Returns { status, statusText, method, methodNote, start, target, path: [{time, value, future}],
 *           invalidation, stats? }
 */
export function computeProjection(bars, p, tf = "D") {
  const n = bars.close.length;
  if (n < 30) return { status: "error", statusText: "Not enough candles" };
  const bull = p.side !== "down";
  const H = Math.max(2, Math.min(500, Math.round(p.horizon || 20)));
  let cond = null;
  if (p.condition?.trim()) {
    try { cond = evalFormula(p.condition, bars); } catch (e) { return { status: "error", statusText: `Condition: ${e.message}` }; }
  }
  // the first candle on or after the projection's start date where the condition holds
  const from = p.since ? Math.max(0, bars.time.findIndex((t) => t >= p.since)) : n - 1;
  let trig = null;
  if (!cond) trig = from < 0 ? n - 1 : from;
  else for (let i = Math.max(0, from); i < n; i++) if (cond[i] === 1) { trig = i; break; }
  const s = trig ?? n - 1; // pending: drawn from the last candle "if it triggers now"
  const s0 = bars.close[s];
  const a = atrW(bars.high, bars.low, bars.close, 14);
  // target price
  let target = null, method = p.target ? "target" : p.method || "atr", note = "", stats = null, pathRel = null;
  const sign = bull ? 1 : -1;
  if (p.target && num(+p.target.value)) {
    const v = +p.target.value;
    target = p.target.kind === "pct" ? s0 * (1 + (sign * v) / 100) : p.target.kind === "atr" ? s0 + sign * v * (a[s] || 0) : v;
    note = p.target.kind === "price" ? `target ${v}` : p.target.kind === "pct" ? `target ${v}% ${bull ? "up" : "down"}` : `target ${v} x ATR`;
  } else if (method === "measured") {
    const lb = Math.max(0, s - 40);
    const hi = Math.max(...bars.high.slice(lb, s + 1)), lo = Math.min(...bars.low.slice(lb, s + 1));
    target = s0 + sign * (hi - lo); note = `measured move: the last 40-candle range (${(hi - lo).toFixed(2)}) added from the trigger`;
  } else if (method === "pct") {
    const v = num(+p.methodValue) ? +p.methodValue : 5;
    target = s0 * (1 + (sign * v) / 100); note = `${v}% from the trigger`;
  } else if (method === "slope") {
    const v = num(+p.methodValue) ? +p.methodValue : 0.25;
    pathRel = Array.from({ length: H + 1 }, (_, k) => (1 + (sign * v) / 100) ** k - 1);
    target = s0 * (1 + pathRel[H]); note = `${v}% per candle`;
  } else if (method === "analogue" && cond) {
    // every earlier start of the condition (a 0 -> 1 change) with H candles after it
    const starts = [];
    for (let i = 1; i < n - H; i++) if (cond[i] === 1 && cond[i - 1] !== 1 && i < s) starts.push(i);
    if (starts.length >= 3) {
      pathRel = Array.from({ length: H + 1 }, (_, k) => starts.reduce((acc, i) => acc + bars.close[i + k] / bars.close[i] - 1, 0) / starts.length);
      const ends = starts.map((i) => bars.close[i + H] / bars.close[i] - 1);
      const hit = ends.filter((x) => (bull ? x > 0 : x < 0)).length / ends.length;
      target = s0 * (1 + pathRel[H]);
      stats = { cases: starts.length, hitRate: hit, avg: pathRel[H], best: Math.max(...ends), worst: Math.min(...ends) };
      note = `average of ${starts.length} past signals over ${H} candles; ${Math.round(hit * 100)}% went ${bull ? "up" : "down"}`;
    } else { method = "atr"; note = `only ${starts.length} past signal(s): fell back to 2 x ATR`; }
  } else if (method === "analogue") { method = "atr"; note = "analogue needs a condition: fell back to 2 x ATR"; }
  if (target == null) {
    const k = method === "atr" && num(+p.methodValue) ? +p.methodValue : 2;
    target = s0 + sign * k * (a[s] || s0 * 0.02); method = "atr"; note ||= `${k} x ATR(14) = ${(k * (a[s] || 0)).toFixed(2)}`;
  }
  // the path: straight from the trigger close to the target (or the analogue / slope curve)
  const rel = pathRel || Array.from({ length: H + 1 }, (_, k) => ((target / s0 - 1) * k) / H);
  const path = rel.map((r, k) => {
    const i = s + k;
    return { time: i < n ? bars.time[i] : addSessions(bars.time[n - 1], i - n + 1, tf), value: k === H && !pathRel ? target : s0 * (1 + r), future: i >= n };
  });
  // status after the trigger: target reached, invalidated, or running
  let status = trig == null ? "pending" : "active", when = trig != null ? bars.time[trig] : null;
  const inv = num(+p.invalidate) && p.invalidate !== "" ? +p.invalidate : null;
  if (trig != null) {
    for (let i = trig + 1; i < n; i++) {
      if (inv != null && (bull ? bars.close[i] < inv : bars.close[i] > inv)) { status = "invalidated"; when = bars.time[i]; break; }
      if (bull ? bars.high[i] >= target : bars.low[i] <= target) { status = "reached"; when = bars.time[i]; break; }
    }
  }
  const T = target.toFixed(2);
  const statusText = status === "pending" ? `Waiting for the condition — if it triggers on the last candle, the projection is ${T}`
    : status === "active" ? `Condition triggered on ${when} — projecting to ${T}`
    : status === "reached" ? `Target ${T} reached on ${when}` : `Invalidated on ${when} (close beyond ${inv})`;
  return { status, statusText, method, methodNote: note, start: { time: bars.time[s], price: s0, triggered: trig != null }, target, invalidation: inv, path, stats };
}

/**
 * A projection from a sentence (the GQ Agent and the chart lab's box share this), e.g.
 *   "Project price to 2450 if weekly RSC turns up and price breaks 2380"
 *   "down 8% if close falls below 410, invalid above 432, 30 candles"
 * Returns a spec for computeProjection plus the phrases it understood; nothing is guessed.
 */
export function parseProjectionText(text) {
  const t = ` ${String(text || "").toLowerCase().replace(/,/g, " , ")} `;
  const understood = [], conds = [];
  const p = { side: /\b(down|fall|short|bear)/.test(t) && !/\bbreaks? above\b/.test(t) ? "down" : "up", method: "atr", horizon: 20 };
  const nums = (re) => { const m = t.match(re); return m ? +m[1] : null; };
  const to = nums(/\bto\s+([0-9]+(?:\.[0-9]+)?)\b(?!\s*%)/);
  const pctT = nums(/\b(?:up|down|by|target)\s+([0-9]+(?:\.[0-9]+)?)\s*%/);
  const atrT = nums(/\b([0-9]+(?:\.[0-9]+)?)\s*(?:x\s*)?atr\b/);
  if (to != null) { p.target = { kind: "price", value: to }; understood.push(`target ${to}`); }
  else if (pctT != null) { p.target = { kind: "pct", value: pctT }; understood.push(`target ${pctT}%`); }
  else if (atrT != null) { p.target = { kind: "atr", value: atrT }; understood.push(`target ${atrT} x ATR`); }
  const brk = nums(/\b(?:breaks?|crosses|above|over)\s+(?:above\s+)?([0-9]+(?:\.[0-9]+)?)\b/);
  const below = nums(/\b(?:falls?|drops?|breaks?)\s+below\s+([0-9]+(?:\.[0-9]+)?)\b/);
  if (below != null) { conds.push(`close < ${below}`); understood.push(`condition: close below ${below}`); }
  else if (brk != null && !(to != null && brk === to)) { conds.push(`close > ${brk}`); understood.push(`condition: close above ${brk}`); }
  if (/\brsc\s+(turns?|turning)\s+up\b/.test(t)) { conds.push("rsc > ref(rsc, 1) and ref(rsc, 1) <= ref(rsc, 2)"); understood.push("condition: RSC turns up"); }
  if (/\brsc\s+(turns?|turning)\s+down\b/.test(t)) { conds.push("rsc < ref(rsc, 1) and ref(rsc, 1) >= ref(rsc, 2)"); understood.push("condition: RSC turns down"); }
  const rsiAbove = nums(/\brsi\s*(?:>|above|over)\s*([0-9]+)/);
  if (rsiAbove != null) { conds.push(`rsi(close, 14) > ${rsiAbove}`); understood.push(`condition: RSI above ${rsiAbove}`); }
  const inv = nums(/\binvalid(?:ated|ation)?\s+(?:if\s+)?(?:above|below|at)?\s*([0-9]+(?:\.[0-9]+)?)/) ?? nums(/\bstop\s+(?:at\s+)?([0-9]+(?:\.[0-9]+)?)/);
  if (inv != null) { p.invalidate = inv; understood.push(`invalidation ${inv}`); }
  const hz = nums(/\b([0-9]+)\s*(?:candles|bars|sessions|days|weeks|months)\b/);
  if (hz) { p.horizon = hz; understood.push(`${hz} candles`); }
  if (/\banalog|\bhistor/.test(t)) { p.method = "analogue"; understood.push("method: historical analogue"); }
  else if (/\bmeasured\b/.test(t)) { p.method = "measured"; understood.push("method: measured move"); }
  const tf = /\bweekly\b/.test(t) ? "W" : /\bmonthly\b/.test(t) ? "M" : /\bdaily\b/.test(t) ? "D" : null;
  if (tf) understood.push(`timeframe: ${tf}`);
  p.condition = conds.join(" and ");
  understood.unshift(p.side === "down" ? "down" : "up");
  return { spec: p, tf, understood };
}
