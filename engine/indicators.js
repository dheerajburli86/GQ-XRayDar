// Indicator maths. Pure functions over plain arrays; `null` marks "no value".
// Every function accepts a series that starts with nulls (an RSI of an RSI
// does) and starts its own calculation at the first real value, so nesting
// never smears a warm-up gap into the result.
//
// EMA convention: pandas ewm(span=n, adjust=False), seeded with the first
// value. Values before the n-th observation are WARM-UP and flagged by
// `warmupStart()`; charts hide them, screens ignore them.

import { periodKey } from "./calendar.js";

const isNum = (v) => v != null && Number.isFinite(v);
export const firstIndex = (xs) => { for (let i = 0; i < xs.length; i++) if (isNum(xs[i])) return i; return -1; };

export function ema(xs, n) {
  const out = new Array(xs.length).fill(null);
  const s = firstIndex(xs);
  if (s < 0) return out;
  const a = 2 / (n + 1);
  let prev = xs[s];
  out[s] = prev;
  for (let i = s + 1; i < xs.length; i++) {
    const v = xs[i];
    if (!isNum(v)) { out[i] = prev; continue; }
    prev = a * v + (1 - a) * prev;
    out[i] = prev;
  }
  return out;
}

/** EMA with warm-up removed: null until n observations exist. */
export function emaStrict(xs, n) {
  const e = ema(xs, n), s = firstIndex(xs);
  if (s < 0) return e;
  for (let i = s; i < Math.min(xs.length, s + n - 1); i++) e[i] = null;
  return e;
}

export function sma(xs, n) {
  const out = new Array(xs.length).fill(null);
  let sum = 0, cnt = 0;
  const q = [];
  for (let i = 0; i < xs.length; i++) {
    const v = xs[i];
    if (!isNum(v)) continue;
    q.push(v); sum += v; cnt++;
    if (cnt > n) { sum -= q.shift(); cnt--; }
    if (cnt === n) out[i] = sum / n;
  }
  return out;
}

/** RSI(n). method "house": ewm(alpha=1/n, adjust=False) of gains/losses seeded
 *  on the first change -- identical to the heatmap's calc_rsi14 / mmaSeries.
 *  method "wilder": first average is the SMA of n changes, then Wilder
 *  smoothing. Null until n changes exist. */
export function rsi(xs, n = 14, method = "house") {
  const out = new Array(xs.length).fill(null);
  const s = firstIndex(xs);
  if (s < 0) return out;
  const alpha = 1 / n;
  let ag = null, al = null, cnt = 0, sg = 0, sl = 0, prev = xs[s];
  for (let i = s + 1; i < xs.length; i++) {
    const v = xs[i];
    if (!isNum(v)) continue;
    const d = v - prev; prev = v;
    const g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
    cnt++;
    if (method === "wilder") {
      if (cnt <= n) { sg += g; sl += l; if (cnt === n) { ag = sg / n; al = sl / n; } }
      else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; }
    } else if (ag == null) { ag = g; al = l; }
    else { ag = alpha * g + (1 - alpha) * ag; al = alpha * l + (1 - alpha) * al; }
    if (cnt < n || ag == null) continue;
    out[i] = al === 0 && ag === 0 ? 50 : al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return out;
}

/** RSI applied `depth` times: depth 1 = RSI, 2 = RSI of RSI, 3 = RSI of RSI of RSI. */
export function nestedRsi(xs, depth, n = 14, method = "house") {
  let s = xs;
  for (let k = 0; k < depth; k++) s = rsi(s, n, method);
  return s;
}

export function macd(xs, fast = 12, slow = 26, sig = 9) {
  const f = ema(xs, fast), s = ema(xs, slow);
  const line = xs.map((_, i) => (isNum(f[i]) && isNum(s[i]) ? f[i] - s[i] : null));
  const signal = ema(line, sig);
  return { line, signal, hist: line.map((v, i) => (isNum(v) && isNum(signal[i]) ? v - signal[i] : null)) };
}

export function atr(highs, lows, closes, n = 14) {
  const out = new Array(closes.length).fill(null);
  let a = null, cnt = 0, sum = 0;
  for (let i = 0; i < closes.length; i++) {
    const tr = i === 0 ? highs[i] - lows[i]
      : Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
    cnt++;
    if (cnt <= n) { sum += tr; if (cnt === n) { a = sum / n; out[i] = a; } }
    else { a = (a * (n - 1) + tr) / n; out[i] = a; }
  }
  return out;
}

function rollingExtreme(xs, n, better) {
  // Monotonic deque: O(length) regardless of window size.
  const out = new Array(xs.length).fill(null);
  const dq = new Int32Array(xs.length);
  let head = 0, tail = 0;
  for (let i = 0; i < xs.length; i++) {
    while (head < tail && dq[head] <= i - n) head++;
    if (isNum(xs[i])) {
      while (head < tail && !better(xs[dq[tail - 1]], xs[i])) tail--;
      dq[tail++] = i;
    }
    out[i] = head < tail ? xs[dq[head]] : null;
  }
  return out;
}
export const rollingMax = (xs, n) => rollingExtreme(xs, n, (a, b) => a > b);
export const rollingMin = (xs, n) => rollingExtreme(xs, n, (a, b) => a < b);

/** Spread of an EMA group as % of its mean at index i. */
export function groupSpreadPct(lines, i) {
  let mn = Infinity, mx = -Infinity, sum = 0;
  for (let k = 0; k < lines.length; k++) {
    const x = lines[k][i];
    if (x == null || !Number.isFinite(x)) return null;
    if (x < mn) mn = x; if (x > mx) mx = x; sum += x;
  }
  const mean = sum / lines.length;
  return mean ? ((mx - mn) / Math.abs(mean)) * 100 : null;
}

function groupStats(lines, i) {
  let mn = Infinity, mx = -Infinity, desc = true, asc = true, prev = null;
  for (let k = 0; k < lines.length; k++) {
    const x = lines[k][i];
    if (x == null || !Number.isFinite(x)) return null;
    if (x < mn) mn = x; if (x > mx) mx = x;
    if (prev != null) { if (prev < x) desc = false; if (prev > x) asc = false; }
    prev = x;
  }
  return { mn, mx, desc, asc };
}

/** MMA state at index i given short/long EMA line sets.
 *  bull: every short EMA above every long EMA and both groups fanned in order
 *  (fastest on top); bear: the mirror. */
export function mmaState(shortLines, longLines, i) {
  const S = groupStats(shortLines, i), L = groupStats(longLines, i);
  if (!S || !L) return null;
  const bull = S.mn > L.mx && S.desc && L.desc;
  const bear = S.mx < L.mn && S.asc && L.asc;
  return {
    bull, bear,
    shortAboveLong: S.mn > L.mx, shortBelowLong: S.mx < L.mn,
    shortSpread: groupSpreadPct(shortLines, i), longSpread: groupSpreadPct(longLines, i),
    gapPct: ((S.mn + S.mx) / 2 / ((L.mn + L.mx) / 2) - 1) * 100,
  };
}

/** Efficiency ratio: |net move| / sum of |moves| over n bars (0..1). */
export function efficiencyRatio(xs, n, i = xs.length - 1) {
  if (i < n) return null;
  let path = 0;
  for (let j = i - n + 1; j <= i; j++) path += Math.abs(xs[j] - xs[j - 1]);
  return path ? Math.abs(xs[i] - xs[i - n]) / path : 0;
}

/** Annualised realised volatility of log returns over n bars ending at i. */
export function realisedVol(xs, n, i = xs.length - 1, periodsPerYear = 252) {
  if (i < n) return null;
  const r = [];
  for (let j = i - n + 1; j <= i; j++) if (xs[j] > 0 && xs[j - 1] > 0) r.push(Math.log(xs[j] / xs[j - 1]));
  if (r.length < 2) return null;
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  const v = r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1);
  return Math.sqrt(v * periodsPerYear) * 100;
}

/** Daily bars -> timeframe bars. Input: {time[],open[],high[],low[],close[],volume[]}
 *  (column arrays, ascending). Each output candle is stamped with the date of
 *  its LAST session, so a weekly candle ends on the Friday (or holiday-shortened
 *  last day) it actually covers. EMA N on the result is N candles of that
 *  timeframe -- never a daily EMA resampled. */
export function aggregate(b, tf, anchor = null) {
  if (tf === "D") return b;
  const out = { time: [], open: [], high: [], low: [], close: [], volume: [], key: [] };
  let cur = -1, lastKey = null;
  for (let i = 0; i < b.time.length; i++) {
    const k = periodKey(b.time[i], tf, anchor);
    if (k !== lastKey) {
      out.time.push(b.time[i]); out.open.push(b.open[i]); out.high.push(b.high[i]); out.low.push(b.low[i]);
      out.close.push(b.close[i]); out.volume.push(b.volume ? b.volume[i] || 0 : 0); out.key.push(k);
      cur++; lastKey = k;
    } else {
      out.time[cur] = b.time[i];
      if (b.high[i] > out.high[cur]) out.high[cur] = b.high[i];
      if (b.low[i] < out.low[cur]) out.low[cur] = b.low[i];
      out.close[cur] = b.close[i];
      out.volume[cur] += b.volume ? b.volume[i] || 0 : 0;
    }
  }
  return out;
}

/** Close-only series aggregated to a timeframe: [{key,time,close}] arrays. */
export function aggregateCloses(times, closes, tf, anchor = null) {
  const res = { time: [], close: [], key: [] };
  let last = null;
  for (let i = 0; i < times.length; i++) {
    if (!isNum(closes[i])) continue;
    const k = tf === "D" ? times[i] : periodKey(times[i], tf, anchor);
    if (k !== last) { res.time.push(times[i]); res.close.push(closes[i]); res.key.push(k); last = k; }
    else { res.time[res.time.length - 1] = times[i]; res.close[res.close.length - 1] = closes[i]; }
  }
  return res;
}

/** Relative strength comparison (RSC) of A against benchmark B on timeframe tf.
 *  Both are aggregated to tf FIRST, then joined on the candle key, so a weekly
 *  RSC is (A's weekly close / B's weekly close) for the same week. Rebased to
 *  `base` at the first common candle. Returns {time, value, key}. */
export function rsc(aTimes, aCloses, bTimes, bCloses, tf = "D", base = 100, anchor = null) {
  const A = aggregateCloses(aTimes, aCloses, tf, anchor), B = aggregateCloses(bTimes, bCloses, tf, anchor);
  const bMap = new Map(B.key.map((k, i) => [k, B.close[i]]));
  const out = { time: [], value: [], key: [] };
  let first = null;
  for (let i = 0; i < A.key.length; i++) {
    const bv = bMap.get(A.key[i]);
    if (!isNum(bv) || bv === 0 || !isNum(A.close[i])) continue;
    const r = A.close[i] / bv;
    if (first == null) first = r;
    out.time.push(A.time[i]); out.value.push((r / first) * base); out.key.push(A.key[i]);
  }
  return out;
}

/** Slope sign of a series over the last k bars ending at i (+1 / -1 / 0). */
export function slopeSign(xs, i, k = 5) {
  if (i - k < 0 || !isNum(xs[i]) || !isNum(xs[i - k])) return 0;
  const d = xs[i] - xs[i - k];
  return d > 0 ? 1 : d < 0 ? -1 : 0;
}

export const isFiniteNum = isNum;
