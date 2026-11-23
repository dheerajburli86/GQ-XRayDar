// Standard technical studies (owner's additional feature list, item 1). Every function takes
// candle arrays of ONE timeframe (the caller aggregates first: weekly studies are computed on
// weekly candles, never on resampled daily values) and returns arrays aligned to them, null
// where the study is not yet defined. Conventions follow the original authors (Wilder for
// ATR / ADX / Parabolic SAR, Lane for Stochastics, Hosoda for Ichimoku, Chaikin for CMF / A-D).
// Tests: tests/studies.test.mjs.
import { sma, ema, emaStrict, rsi } from "./indicators.js";

const num = (v) => typeof v === "number" && Number.isFinite(v);
const nulls = (n) => new Array(n).fill(null);

/** True range. */
export function trueRange(h, l, c) {
  return c.map((_, i) => (i === 0 ? h[i] - l[i] : Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]))));
}

/** Wilder smoothing (RMA): first value = mean of the first n, then (prev*(n-1)+x)/n. */
export function wilder(xs, n) {
  const out = nulls(xs.length);
  let s = 0, k = 0, prev = null;
  for (let i = 0; i < xs.length; i++) {
    const v = xs[i];
    if (!num(v)) continue;
    if (prev == null) { s += v; k++; if (k === n) { prev = s / n; out[i] = prev; } }
    else { prev = (prev * (n - 1) + v) / n; out[i] = prev; }
  }
  return out;
}

/** Average True Range (Wilder). */
export const atrW = (h, l, c, n = 14) => wilder(trueRange(h, l, c), n);

/** Highest high / lowest low over n bars ending at i (null until n bars). */
function hhll(h, l, n) {
  const hh = nulls(h.length), ll = nulls(h.length);
  for (let i = n - 1; i < h.length; i++) {
    let a = -Infinity, b = Infinity;
    for (let j = i - n + 1; j <= i; j++) { if (h[j] > a) a = h[j]; if (l[j] < b) b = l[j]; }
    hh[i] = a; ll[i] = b;
  }
  return { hh, ll };
}

/** Stochastic oscillator. Fast %K raw over k bars; fast %D = SMA(%K, d). Slow %K = fast %D, slow %D = SMA(slow %K, d). */
export function stochastic(h, l, c, k = 14, d = 3, smooth = 3) {
  const { hh, ll } = hhll(h, l, k);
  const fastK = c.map((x, i) => (hh[i] == null ? null : hh[i] === ll[i] ? 50 : ((x - ll[i]) / (hh[i] - ll[i])) * 100));
  const fastD = sma(fastK, d);
  const slowK = sma(fastK, smooth);
  const slowD = sma(slowK, d);
  return { fastK, fastD, slowK, slowD };
}

/** ADX with +DI / -DI (Wilder, n = 14). */
export function adx(h, l, c, n = 14) {
  const len = c.length;
  const pdm = nulls(len), mdm = nulls(len);
  for (let i = 1; i < len; i++) {
    const up = h[i] - h[i - 1], dn = l[i - 1] - l[i];
    pdm[i] = up > dn && up > 0 ? up : 0;
    mdm[i] = dn > up && dn > 0 ? dn : 0;
  }
  const tr = trueRange(h, l, c); tr[0] = null;
  const atrS = wilder(tr, n), p = wilder(pdm, n), m = wilder(mdm, n);
  const plusDI = nulls(len), minusDI = nulls(len), dx = nulls(len);
  for (let i = 0; i < len; i++) {
    if (!num(atrS[i]) || atrS[i] === 0 || !num(p[i]) || !num(m[i])) continue;
    plusDI[i] = (p[i] / atrS[i]) * 100; minusDI[i] = (m[i] / atrS[i]) * 100;
    const s = plusDI[i] + minusDI[i];
    dx[i] = s === 0 ? 0 : (Math.abs(plusDI[i] - minusDI[i]) / s) * 100;
  }
  return { adx: wilder(dx, n), plusDI, minusDI };
}

/** Parabolic SAR (Wilder): step 0.02, max 0.2. Returns sar[] and dir[] (+1 long, -1 short). */
export function parabolicSar(h, l, step = 0.02, max = 0.2) {
  const len = h.length, sar = nulls(len), dir = nulls(len);
  if (len < 2) return { sar, dir };
  let long = h[1] + l[1] >= h[0] + l[0];
  let af = step, ep = long ? Math.max(h[0], h[1]) : Math.min(l[0], l[1]);
  let s = long ? Math.min(l[0], l[1]) : Math.max(h[0], h[1]);
  sar[1] = s; dir[1] = long ? 1 : -1;
  for (let i = 2; i < len; i++) {
    s = s + af * (ep - s);
    if (long) {
      s = Math.min(s, l[i - 1], l[i - 2]);
      if (l[i] < s) { long = false; s = ep; ep = l[i]; af = step; }
      else if (h[i] > ep) { ep = h[i]; af = Math.min(max, af + step); }
    } else {
      s = Math.max(s, h[i - 1], h[i - 2]);
      if (h[i] > s) { long = true; s = ep; ep = h[i]; af = step; }
      else if (l[i] < ep) { ep = l[i]; af = Math.min(max, af + step); }
    }
    sar[i] = s; dir[i] = long ? 1 : -1;
  }
  return { sar, dir };
}

/** Supertrend (ATR period n, multiplier m): line[] and dir[] (+1 up, -1 down). */
export function supertrend(h, l, c, n = 10, m = 3) {
  const a = atrW(h, l, c, n), len = c.length;
  const line = nulls(len), dir = nulls(len);
  let ub = null, lb = null, d = 1;
  for (let i = 0; i < len; i++) {
    if (!num(a[i])) continue;
    const mid = (h[i] + l[i]) / 2, bu = mid + m * a[i], bl = mid - m * a[i];
    const prevC = c[i - 1];
    ub = ub == null || bu < ub || prevC > ub ? bu : ub;
    lb = lb == null || bl > lb || prevC < lb ? bl : lb;
    if (line[i - 1] == null) d = c[i] >= mid ? 1 : -1;
    else if (d === 1 && c[i] < lb) d = -1;
    else if (d === -1 && c[i] > ub) d = 1;
    line[i] = d === 1 ? lb : ub; dir[i] = d;
  }
  return { line, dir };
}

/**
 * Ichimoku Kinko Hyo. Tenkan (9), Kijun (26), Senkou A = (Tenkan+Kijun)/2 and Senkou B (52)
 * plotted `shift` (26) bars ahead, Chikou = close plotted 26 bars back. Arrays here are aligned
 * to the bar they are DRAWN at: spanA/spanB carry `shift` extra future slots (futureBars).
 */
export function ichimoku(h, l, c, { tenkan = 9, kijun = 26, spanB = 52, shift = 26 } = {}) {
  const mid = (n) => { const { hh, ll } = hhll(h, l, n); return hh.map((x, i) => (x == null ? null : (x + ll[i]) / 2)); };
  const t = mid(tenkan), k = mid(kijun), b = mid(spanB);
  const len = c.length;
  const a = nulls(len + shift), bb = nulls(len + shift);
  for (let i = 0; i < len; i++) {
    if (num(t[i]) && num(k[i])) a[i + shift] = (t[i] + k[i]) / 2;
    if (num(b[i])) bb[i + shift] = b[i];
  }
  const chikou = nulls(len);
  for (let i = shift; i < len; i++) chikou[i - shift] = c[i];
  return { tenkan: t, kijun: k, spanA: a, spanB: bb, chikou, shift };
}

/** Pivot points from the PREVIOUS bar (daily pivots from yesterday, weekly from last week, ...). */
export function pivots(h, l, c, o, kind = "standard") {
  const out = [];
  for (let i = 0; i < c.length; i++) {
    if (i === 0) { out.push(null); continue; }
    const H = h[i - 1], L = l[i - 1], C = c[i - 1], O = o ? o[i] : c[i - 1], R = H - L;
    let p;
    switch (kind) {
      case "fibonacci": { const P = (H + L + C) / 3; p = { P, R1: P + 0.382 * R, R2: P + 0.618 * R, R3: P + R, S1: P - 0.382 * R, S2: P - 0.618 * R, S3: P - R }; break; }
      case "camarilla": p = { P: (H + L + C) / 3, R1: C + (R * 1.1) / 12, R2: C + (R * 1.1) / 6, R3: C + (R * 1.1) / 4, R4: C + (R * 1.1) / 2, S1: C - (R * 1.1) / 12, S2: C - (R * 1.1) / 6, S3: C - (R * 1.1) / 4, S4: C - (R * 1.1) / 2 }; break;
      case "woodie": { const P = (H + L + 2 * O) / 4; p = { P, R1: 2 * P - L, R2: P + R, S1: 2 * P - H, S2: P - R }; break; }
      case "demark": {
        const X = C < (o ? o[i - 1] : C) ? H + 2 * L + C : C > (o ? o[i - 1] : C) ? 2 * H + L + C : H + L + 2 * C;
        p = { P: X / 4, R1: X / 2 - L, S1: X / 2 - H }; break;
      }
      default: { const P = (H + L + C) / 3; p = { P, R1: 2 * P - L, R2: P + R, R3: H + 2 * (P - L), S1: 2 * P - H, S2: P - R, S3: L - 2 * (H - P) }; }
    }
    out.push(p);
  }
  return out;
}

/** On-Balance Volume. */
export function obv(c, v) {
  const out = nulls(c.length);
  let s = 0;
  for (let i = 0; i < c.length; i++) { if (i > 0) s += c[i] > c[i - 1] ? v[i] || 0 : c[i] < c[i - 1] ? -(v[i] || 0) : 0; out[i] = s; }
  return out;
}

const mfm = (h, l, c, i) => (h[i] === l[i] ? 0 : ((c[i] - l[i]) - (h[i] - c[i])) / (h[i] - l[i]));
/** Accumulation / Distribution line (Chaikin). */
export function adLine(h, l, c, v) {
  const out = nulls(c.length);
  let s = 0;
  for (let i = 0; i < c.length; i++) { s += mfm(h, l, c, i) * (v[i] || 0); out[i] = s; }
  return out;
}
/** Chaikin Money Flow over n bars. */
export function cmf(h, l, c, v, n = 20) {
  const out = nulls(c.length);
  for (let i = n - 1; i < c.length; i++) {
    let a = 0, b = 0;
    for (let j = i - n + 1; j <= i; j++) { a += mfm(h, l, c, j) * (v[j] || 0); b += v[j] || 0; }
    out[i] = b > 0 ? a / b : null;
  }
  return out;
}
/** Volume oscillator: (EMA fast - EMA slow) / EMA slow x 100 of volume. */
export function volumeOscillator(v, fast = 5, slow = 10) {
  const f = ema(v.map((x) => x || 0), fast), s = ema(v.map((x) => x || 0), slow);
  return f.map((x, i) => (num(x) && num(s[i]) && s[i] > 0 ? ((x - s[i]) / s[i]) * 100 : null));
}

/**
 * VWAP. With an anchor index: cumulative typical-price x volume from the anchor bar (anchored
 * VWAP) with optional standard-deviation bands. Without one on daily candles the "session" is
 * each calendar month (end-of-day data has no intraday sessions), and so on for other periods.
 */
export function vwap(time, h, l, c, v, { anchor = null, bands = [1, 2], session = "M" } = {}) {
  const len = c.length, out = nulls(len), up = bands.map(() => nulls(len)), dn = bands.map(() => nulls(len));
  let pv = 0, vv = 0, pv2 = 0, key = null;
  for (let i = 0; i < len; i++) {
    if (anchor != null && i < anchor) continue;
    if (anchor == null) {
      const k = session === "Y" ? time[i].slice(0, 4) : session === "W" ? null : time[i].slice(0, 7);
      if (k !== key) { key = k; pv = 0; vv = 0; pv2 = 0; }
    }
    const tp = (h[i] + l[i] + c[i]) / 3, vol = v[i] || 0;
    pv += tp * vol; vv += vol; pv2 += tp * tp * vol;
    if (vv <= 0) continue;
    const m = pv / vv, sd = Math.sqrt(Math.max(0, pv2 / vv - m * m));
    out[i] = m;
    bands.forEach((k, j) => { up[j][i] = m + k * sd; dn[j][i] = m - k * sd; });
  }
  return { vwap: out, upper: up, lower: dn, bands };
}

/** Rate of change: % change of the close over n bars (null until n bars exist or when the base is 0). */
export function roc(c, n = 12) {
  n = Math.max(1, Math.round(+n) || 12);
  return c.map((v, i) => { const p = c[i - n]; return num(v) && num(p) && p !== 0 ? (v / p - 1) * 100 : null; });
}

/**
 * KST, Know Sure Thing (Martin Pring): a weighted sum of four smoothed rates of change,
 *   KST = w1 SMA(ROC(r1), s1) + w2 SMA(ROC(r2), s2) + w3 SMA(ROC(r3), s3) + w4 SMA(ROC(r4), s4)
 * and a signal line = SMA(KST, sig). Pring's daily settings are ROC 10/15/20/30, SMA 10/10/10/15,
 * weights 1/2/3/4, signal 9; every one of them is a parameter. Null until all four legs exist.
 */
export const KST_PARAMS = { roc1: 10, roc2: 15, roc3: 20, roc4: 30, sma1: 10, sma2: 10, sma3: 10, sma4: 15, w1: 1, w2: 2, w3: 3, w4: 4, signal: 9 };
export function kst(c, p = {}) {
  const P = { ...KST_PARAMS };
  for (const [k, v] of Object.entries(p || {})) if (v !== "" && v != null && Number.isFinite(+v)) P[k] = +v;
  const per = (x) => Math.max(1, Math.round(x));
  const legs = [1, 2, 3, 4].map((j) => sma(roc(c, per(P[`roc${j}`])), per(P[`sma${j}`])));
  const line = c.map((_, i) => (legs.every((l) => num(l[i])) ? legs.reduce((a, l, j) => a + P[`w${j + 1}`] * l[i], 0) : null));
  return { kst: line, signal: sma(line, per(P.signal)), params: P };
}

// ── More studies (Shankar Sir, 23 Nov: "all major indicators ... everything changeable"). Every parameter is
// an argument; the values written here are only the authors' published settings a new chart starts from.

/** Weighted moving average (linear weights 1..n, newest heaviest); null until n values. */
export function wma(x, n) {
  n = Math.max(1, Math.round(n));
  const out = nulls(x.length), d = (n * (n + 1)) / 2;
  for (let i = n - 1; i < x.length; i++) {
    let s = 0, ok = true;
    for (let j = 0; j < n; j++) { const v = x[i - n + 1 + j]; if (!num(v)) { ok = false; break; } s += v * (j + 1); }
    if (ok) out[i] = s / d;
  }
  return out;
}
const emaS = (x, n) => emaStrict(x, Math.max(1, Math.round(n)));
/** Hull moving average: WMA(2 WMA(n/2) - WMA(n), sqrt n). */
export function hma(x, n) {
  n = Math.max(2, Math.round(n));
  const a = wma(x, Math.round(n / 2)), b = wma(x, n);
  return wma(a.map((v, i) => (num(v) && num(b[i]) ? 2 * v - b[i] : null)), Math.round(Math.sqrt(n)));
}
/** Double EMA (Mulloy): 2 E1 - E2. */
export function dema(x, n) { const e1 = emaS(x, n), e2 = emaS(e1, n); return e1.map((v, i) => (num(v) && num(e2[i]) ? 2 * v - e2[i] : null)); }
/** Triple EMA (Mulloy): 3 E1 - 3 E2 + E3. */
export function tema(x, n) { const e1 = emaS(x, n), e2 = emaS(e1, n), e3 = emaS(e2, n); return e1.map((v, i) => (num(v) && num(e2[i]) && num(e3[i]) ? 3 * v - 3 * e2[i] + e3[i] : null)); }
/** Any moving average by name: SMA, EMA, WMA, HMA, DEMA, TEMA. */
export function movingAverage(kind, x, n) {
  n = Math.max(1, Math.round(n));
  switch (String(kind).toUpperCase()) {
    case "SMA": return sma(x, n);
    case "WMA": return wma(x, n);
    case "HMA": return hma(x, n);
    case "DEMA": return dema(x, n);
    case "TEMA": return tema(x, n);
    default: return emaS(x, n);
  }
}
export const MA_KINDS = ["EMA", "SMA", "WMA", "HMA", "DEMA", "TEMA"];

/** Rolling population standard deviation over n (null until n values). */
function rstd(x, n) {
  const out = nulls(x.length);
  for (let i = n - 1; i < x.length; i++) {
    let s = 0, q = 0, ok = true;
    for (let j = i - n + 1; j <= i; j++) { if (!num(x[j])) { ok = false; break; } s += x[j]; q += x[j] * x[j]; }
    if (ok) out[i] = Math.sqrt(Math.max(0, q / n - (s / n) ** 2));
  }
  return out;
}
const rsum = (x, n) => { const out = nulls(x.length); for (let i = n - 1; i < x.length; i++) { let s = 0, ok = true; for (let j = i - n + 1; j <= i; j++) { if (!num(x[j])) { ok = false; break; } s += x[j]; } if (ok) out[i] = s; } return out; };

/** Bollinger Bands: SMA(n) +/- k standard deviations (population), %B and bandwidth %. */
export function bollinger(c, n = 20, k = 2) {
  n = Math.max(2, Math.round(n));
  const mid = sma(c, n), sd = rstd(c, n);
  const upper = mid.map((m, i) => (num(m) && num(sd[i]) ? m + k * sd[i] : null)), lower = mid.map((m, i) => (num(m) && num(sd[i]) ? m - k * sd[i] : null));
  return { mid, upper, lower,
    pctB: c.map((v, i) => (num(upper[i]) && upper[i] !== lower[i] ? (v - lower[i]) / (upper[i] - lower[i]) : null)),
    width: mid.map((m, i) => (num(m) && m !== 0 && num(upper[i]) ? ((upper[i] - lower[i]) / m) * 100 : null)) };
}

/** Commodity Channel Index (Lambert): (TP - SMA(TP)) / (c x mean deviation), c = 0.015. */
export function cci(h, l, c, n = 20, constant = 0.015) {
  n = Math.max(2, Math.round(n));
  const tp = c.map((v, i) => (h[i] + l[i] + v) / 3), m = sma(tp, n), out = nulls(c.length);
  for (let i = n - 1; i < c.length; i++) {
    if (!num(m[i])) continue;
    let md = 0; for (let j = i - n + 1; j <= i; j++) md += Math.abs(tp[j] - m[i]);
    md /= n;
    out[i] = md > 0 ? (tp[i] - m[i]) / (constant * md) : 0;
  }
  return out;
}

/** Williams %R: (highest high - close) / (highest high - lowest low) x -100. */
export function williamsR(h, l, c, n = 14) {
  n = Math.max(1, Math.round(n));
  const { hh, ll } = hhll(h, l, n);
  return c.map((v, i) => (num(hh[i]) && hh[i] !== ll[i] ? ((hh[i] - v) / (hh[i] - ll[i])) * -100 : null));
}

/** Money Flow Index (volume-weighted RSI on the typical price). */
export function mfi(h, l, c, v, n = 14) {
  n = Math.max(1, Math.round(n));
  const tp = c.map((x, i) => (h[i] + l[i] + x) / 3), out = nulls(c.length);
  for (let i = n; i < c.length; i++) {
    let p = 0, q = 0;
    for (let j = i - n + 1; j <= i; j++) { const f = tp[j] * (v[j] || 0); if (tp[j] > tp[j - 1]) p += f; else if (tp[j] < tp[j - 1]) q += f; }
    out[i] = q === 0 ? (p === 0 ? 50 : 100) : 100 - 100 / (1 + p / q);
  }
  return out;
}

/** Keltner Channels: EMA(n) +/- m x ATR(atrN) (Wilder ATR). */
export function keltner(h, l, c, n = 20, atrN = 10, m = 2) {
  const mid = emaS(c, n), a = atrW(h, l, c, Math.max(1, Math.round(atrN)));
  return { mid, upper: mid.map((x, i) => (num(x) && num(a[i]) ? x + m * a[i] : null)), lower: mid.map((x, i) => (num(x) && num(a[i]) ? x - m * a[i] : null)) };
}

/** Donchian Channels: highest high / lowest low over n and their midpoint. */
export function donchian(h, l, n = 20) {
  const { hh, ll } = hhll(h, l, Math.max(1, Math.round(n)));
  return { upper: hh, lower: ll, mid: hh.map((x, i) => (num(x) ? (x + ll[i]) / 2 : null)) };
}

/** Aroon (Chande): % of n since the n-bar high / low (window n + 1 bars), and up - down. */
export function aroon(h, l, n = 25) {
  n = Math.max(1, Math.round(n));
  const up = nulls(h.length), down = nulls(h.length);
  for (let i = n; i < h.length; i++) {
    let hi = i - n, lo = i - n;
    for (let j = i - n; j <= i; j++) { if (h[j] >= h[hi]) hi = j; if (l[j] <= l[lo]) lo = j; }
    up[i] = (100 * (n - (i - hi))) / n; down[i] = (100 * (n - (i - lo))) / n;
  }
  return { up, down, osc: up.map((x, i) => (num(x) ? x - down[i] : null)) };
}

/** TRIX (Hutson): 1-bar % change of a triple EMA, and its signal EMA. */
export function trix(c, n = 15, sig = 9) {
  const e3 = emaS(emaS(emaS(c, n), n), n);
  const line = e3.map((v, i) => (i > 0 && num(v) && num(e3[i - 1]) && e3[i - 1] !== 0 ? (v / e3[i - 1] - 1) * 100 : null));
  return { trix: line, signal: emaS(line, sig) };
}

/** Chande Momentum Oscillator: (sum of up moves - sum of down moves) / their total x 100 over n. */
export function cmo(c, n = 9) {
  n = Math.max(1, Math.round(n));
  const out = nulls(c.length);
  for (let i = n; i < c.length; i++) {
    let u = 0, d = 0;
    for (let j = i - n + 1; j <= i; j++) { const x = c[j] - c[j - 1]; if (x > 0) u += x; else d -= x; }
    out[i] = u + d > 0 ? ((u - d) / (u + d)) * 100 : 0;
  }
  return out;
}

/** Ultimate Oscillator (Williams): weighted average of buying pressure / true range over three windows. */
export function ultimateOscillator(h, l, c, s = 7, m = 14, lg = 28, ws = 4, wm = 2, wl = 1) {
  const bp = c.map((v, i) => (i ? v - Math.min(l[i], c[i - 1]) : null)), tr = c.map((v, i) => (i ? Math.max(h[i], c[i - 1]) - Math.min(l[i], c[i - 1]) : null));
  const avg = (n) => { n = Math.max(1, Math.round(n)); const a = rsum(bp, n), b = rsum(tr, n); return a.map((x, i) => (num(x) && b[i] > 0 ? x / b[i] : null)); };
  const A = avg(s), B = avg(m), C = avg(lg), W = ws + wm + wl;
  return c.map((_, i) => (num(A[i]) && num(B[i]) && num(C[i]) && W ? (100 * (ws * A[i] + wm * B[i] + wl * C[i])) / W : null));
}

/** Elder Ray: bull power = high - EMA(n), bear power = low - EMA(n). */
export function elderRay(h, l, c, n = 13) {
  const e = emaS(c, n);
  return { bull: h.map((x, i) => (num(e[i]) ? x - e[i] : null)), bear: l.map((x, i) => (num(e[i]) ? x - e[i] : null)) };
}

/** Force Index (Elder): EMA(n) of (close - previous close) x volume. */
export function forceIndex(c, v, n = 13) {
  return emaS(c.map((x, i) => (i ? (x - c[i - 1]) * (v[i] || 0) : null)), n);
}

/** Ease of Movement (Arms): SMA(n) of midpoint move / (volume / scale / range). */
export function easeOfMovement(h, l, v, n = 14, scale = 1e8) {
  const raw = h.map((x, i) => {
    if (!i || x === l[i] || !(v[i] > 0)) return null;
    const dm = (x + l[i]) / 2 - (h[i - 1] + l[i - 1]) / 2;
    return dm / ((v[i] / scale) / (x - l[i]));
  });
  return sma(raw, Math.max(1, Math.round(n)));
}

/** Chaikin Oscillator: EMA(fast) - EMA(slow) of the A/D line. */
export function chaikinOscillator(h, l, c, v, fast = 3, slow = 10) {
  const ad = adLine(h, l, c, v), f = emaS(ad, fast), s = emaS(ad, slow);
  return f.map((x, i) => (num(x) && num(s[i]) ? x - s[i] : null));
}

/** Percentage Price Oscillator: (EMA fast - EMA slow) / EMA slow x 100, signal EMA, histogram. */
export function ppo(c, fast = 12, slow = 26, sig = 9) {
  const f = emaS(c, fast), s = emaS(c, slow);
  const line = f.map((x, i) => (num(x) && num(s[i]) && s[i] !== 0 ? ((x - s[i]) / s[i]) * 100 : null));
  const signal = emaS(line, sig);
  return { ppo: line, signal, hist: line.map((x, i) => (num(x) && num(signal[i]) ? x - signal[i] : null)) };
}

/** Detrended Price Oscillator: close (n/2 + 1) bars ago minus the n-bar SMA (not centred, so it ends today). */
export function dpo(c, n = 20) {
  n = Math.max(2, Math.round(n));
  const m = sma(c, n), k = Math.floor(n / 2) + 1;
  return c.map((_, i) => (i - k >= 0 && num(m[i]) ? c[i - k] - m[i] : null));
}

/** Vortex (Botes / Siepman): VI+ and VI- over n. */
export function vortex(h, l, c, n = 14) {
  n = Math.max(1, Math.round(n));
  const vp = h.map((x, i) => (i ? Math.abs(x - l[i - 1]) : null)), vm = l.map((x, i) => (i ? Math.abs(x - h[i - 1]) : null));
  const tr = trueRange(h, l, c).map((x, i) => (i ? x : null));
  const P = rsum(vp, n), M = rsum(vm, n), T = rsum(tr, n);
  return { plus: P.map((x, i) => (num(x) && T[i] > 0 ? x / T[i] : null)), minus: M.map((x, i) => (num(x) && T[i] > 0 ? x / T[i] : null)) };
}

/** Mass Index (Dorsey): sum over sumN of EMA(range, n) / EMA(EMA(range, n), n). */
export function massIndex(h, l, n = 9, sumN = 25) {
  const e1 = emaS(h.map((x, i) => x - l[i]), n), e2 = emaS(e1, n);
  return rsum(e1.map((x, i) => (num(x) && num(e2[i]) && e2[i] !== 0 ? x / e2[i] : null)), Math.max(1, Math.round(sumN)));
}

/** Coppock Curve: WMA(w) of ROC(r1) + ROC(r2) (Coppock used monthly candles: 14, 11, 10). */
export function coppock(c, r1 = 14, r2 = 11, w = 10) {
  const a = roc(c, r1), b = roc(c, r2);
  return wma(a.map((x, i) => (num(x) && num(b[i]) ? x + b[i] : null)), w);
}

/** Stochastic RSI (Chande & Kroll): the stochastic of RSI over n, %K smoothed by k, %D = SMA(%K, d). 0-100. */
export function stochRsi(c, rsiN = 14, n = 14, k = 3, d = 3) {
  const r = rsi(c, Math.max(2, Math.round(rsiN)));
  n = Math.max(1, Math.round(n));
  const raw = nulls(c.length);
  for (let i = 0; i < c.length; i++) {
    if (i < n - 1) continue;
    let lo = Infinity, hi = -Infinity, ok = true;
    for (let j = i - n + 1; j <= i; j++) { if (!num(r[j])) { ok = false; break; } lo = Math.min(lo, r[j]); hi = Math.max(hi, r[j]); }
    if (ok) raw[i] = hi > lo ? ((r[i] - lo) / (hi - lo)) * 100 : 50;
  }
  const K = sma(raw, Math.max(1, Math.round(k)));
  return { k: K, d: sma(K, Math.max(1, Math.round(d))) };
}

/** Momentum: close minus the close n candles earlier (in price units). */
export function momentum(c, n = 10) {
  n = Math.max(1, Math.round(n));
  return c.map((v, i) => (i >= n && num(v) && num(c[i - n]) ? v - c[i - n] : null));
}

/** Awesome Oscillator (Williams): SMA(median price, fast) - SMA(median price, slow). */
export function awesomeOscillator(h, l, fast = 5, slow = 34) {
  const m = h.map((x, i) => (num(x) && num(l[i]) ? (x + l[i]) / 2 : null));
  const a = sma(m, Math.max(1, Math.round(fast))), b = sma(m, Math.max(1, Math.round(slow)));
  return a.map((x, i) => (num(x) && num(b[i]) ? x - b[i] : null));
}

/** True Strength Index (Blau): 100 x EMA(EMA(change, long), short) / EMA(EMA(|change|, long), short); signal = EMA(TSI, signal). */
export function tsi(c, long = 25, short = 13, signal = 13) {
  const ch = c.map((v, i) => (i && num(v) && num(c[i - 1]) ? v - c[i - 1] : null));
  const ab = ch.map((x) => (num(x) ? Math.abs(x) : null));
  const L = Math.max(1, Math.round(long)), S = Math.max(1, Math.round(short));
  const n1 = emaStrict(emaStrict(ch, L), S), d1 = emaStrict(emaStrict(ab, L), S);
  const t = n1.map((x, i) => (num(x) && num(d1[i]) && d1[i] !== 0 ? (100 * x) / d1[i] : null));
  return { tsi: t, signal: emaStrict(t, Math.max(1, Math.round(signal))) };
}

/** Historical volatility: annualised standard deviation of log returns over n, in percent. periodsPerYear 252 daily, 52 weekly, 12 monthly. */
export function historicalVolatility(c, n = 20, periodsPerYear = 252) {
  const r = c.map((v, i) => (i && num(v) && num(c[i - 1]) && v > 0 && c[i - 1] > 0 ? Math.log(v / c[i - 1]) : null));
  n = Math.max(2, Math.round(n));
  const out = nulls(c.length);
  for (let i = n; i < c.length; i++) {
    const w = r.slice(i - n + 1, i + 1);
    if (!w.every(num)) continue;
    const m = w.reduce((a, b) => a + b, 0) / n;
    const v = w.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1);
    out[i] = Math.sqrt(v) * Math.sqrt(periodsPerYear) * 100;
  }
  return out;
}

/** Rolling standard deviation of the close over n (population, as Bollinger uses). */
export function stdDev(c, n = 20) { return rstd(c, Math.max(2, Math.round(n))); }

/** Linear regression over the last n closes, for every candle: the fitted value at that candle, the slope per candle and R squared. */
export function linearRegression(c, n = 20) {
  n = Math.max(2, Math.round(n));
  const value = nulls(c.length), slope = nulls(c.length), r2 = nulls(c.length);
  const sx = (n * (n - 1)) / 2, sxx = ((n - 1) * n * (2 * n - 1)) / 6;
  for (let i = n - 1; i < c.length; i++) {
    let sy = 0, sxy = 0, syy = 0, ok = true;
    for (let j = 0; j < n; j++) { const y = c[i - n + 1 + j]; if (!num(y)) { ok = false; break; } sy += y; sxy += j * y; syy += y * y; }
    if (!ok) continue;
    const den = n * sxx - sx * sx;
    const b = (n * sxy - sx * sy) / den, a = (sy - b * sx) / n;
    value[i] = a + b * (n - 1); slope[i] = b;
    const vy = n * syy - sy * sy;
    r2[i] = vy > 0 ? ((n * sxy - sx * sy) ** 2) / (den * vy) : null;
  }
  return { value, slope, r2 };
}

/** Moving-average envelope: an n-candle average (EMA or SMA) with bands pct percent above and below. */
export function envelope(c, n = 20, pct = 2.5, kind = "SMA") {
  const mid = movingAverage(kind, c, Math.max(1, Math.round(n)));
  return { mid, upper: mid.map((m) => (num(m) ? m * (1 + pct / 100) : null)), lower: mid.map((m) => (num(m) ? m * (1 - pct / 100) : null)) };
}

/** Choppiness Index (Dreiss): 100 x log10(sum of TR over n / (highest high - lowest low)) / log10(n). High = choppy, low = trending. */
export function choppiness(h, l, c, n = 14) {
  n = Math.max(2, Math.round(n));
  const tr = c.map((v, i) => (i ? Math.max(h[i], c[i - 1]) - Math.min(l[i], c[i - 1]) : h[i] - l[i]));
  const out = nulls(c.length);
  for (let i = n; i < c.length; i++) {
    let sum = 0, hi = -Infinity, lo = Infinity, ok = true;
    for (let j = i - n + 1; j <= i; j++) { if (!num(tr[j]) || !num(h[j]) || !num(l[j])) { ok = false; break; } sum += tr[j]; hi = Math.max(hi, h[j]); lo = Math.min(lo, l[j]); }
    if (ok && hi > lo) out[i] = (100 * Math.log10(sum / (hi - lo))) / Math.log10(n);
  }
  return out;
}

/** Ulcer Index (Martin): root mean square of the percentage drawdown from the n-candle high. */
export function ulcerIndex(c, n = 14) {
  n = Math.max(2, Math.round(n));
  const dd = nulls(c.length);
  for (let i = n - 1; i < c.length; i++) {
    let hi = -Infinity; for (let j = i - n + 1; j <= i; j++) if (num(c[j])) hi = Math.max(hi, c[j]);
    if (num(c[i]) && hi > 0) dd[i] = ((c[i] - hi) / hi) * 100;
  }
  const out = nulls(c.length);
  for (let i = 2 * n - 2; i < c.length; i++) {
    const w = dd.slice(i - n + 1, i + 1);
    if (w.every(num)) out[i] = Math.sqrt(w.reduce((a, b) => a + b * b, 0) / n);
  }
  return out;
}

/** Catalogue for the UI: key, label, where it is drawn, default parameters. */
export const STUDIES = [
  { key: "ichimoku", label: "Ichimoku cloud", pane: "price", params: { tenkan: 9, kijun: 26, spanB: 52 } },
  { key: "psar", label: "Parabolic SAR", pane: "price", params: { step: 0.02, max: 0.2 } },
  { key: "supertrend", label: "Supertrend", pane: "price", params: { n: 10, m: 3 } },
  { key: "pivots", label: "Pivot points", pane: "price", params: { kind: "standard" } },
  { key: "vwap", label: "VWAP (monthly session)", pane: "price", params: {} },
  { key: "avwap", label: "Anchored VWAP ± bands", pane: "price", params: { anchor: null } },
  { key: "stoch", label: "Stochastic (slow)", pane: "own", params: { k: 14, d: 3, smooth: 3, hi: 80, lo: 20 } },
  { key: "stochFast", label: "Stochastic (fast)", pane: "own", params: { k: 14, d: 3, hi: 80, lo: 20 } },
  { key: "adx", label: "ADX + DI", pane: "own", params: { n: 14, level: 25 } },
  { key: "atr", label: "ATR", pane: "own", params: { n: 14 } },
  { key: "obv", label: "On-Balance Volume", pane: "own", params: {} },
  { key: "cmf", label: "Chaikin Money Flow", pane: "own", params: { n: 20 } },
  { key: "ad", label: "Accumulation / Distribution", pane: "own", params: {} },
  { key: "roc", label: "ROC (rate of change %)", pane: "own", params: { n: 12 } },
  { key: "kst", label: "KST (Know Sure Thing)", pane: "own", params: { roc1: 10, roc2: 15, roc3: 20, roc4: 30, sma1: 10, sma2: 10, sma3: 10, sma4: 15, w1: 1, w2: 2, w3: 3, w4: 4, signal: 9 } },
  { key: "bb", label: "Bollinger Bands", pane: "price", params: { n: 20, k: 2 } },
  { key: "keltner", label: "Keltner Channels", pane: "price", params: { n: 20, atr: 10, mult: 2 } },
  { key: "donchian", label: "Donchian Channels", pane: "price", params: { n: 20 } },
  { key: "bbpct", label: "Bollinger %B and bandwidth", pane: "own", params: { n: 20, k: 2 } },
  { key: "cci", label: "CCI (Commodity Channel Index)", pane: "own", params: { n: 20, constant: 0.015, hi: 100, lo: -100 } },
  { key: "willr", label: "Williams %R", pane: "own", params: { n: 14, hi: -20, lo: -80 } },
  { key: "mfi", label: "MFI (Money Flow Index)", pane: "own", params: { n: 14, hi: 80, lo: 20 } },
  { key: "aroon", label: "Aroon", pane: "own", params: { n: 25 } },
  { key: "trix", label: "TRIX", pane: "own", params: { n: 15, signal: 9 } },
  { key: "cmo", label: "CMO (Chande Momentum)", pane: "own", params: { n: 9, hi: 50, lo: -50 } },
  { key: "uo", label: "Ultimate Oscillator", pane: "own", params: { short: 7, mid: 14, long: 28, wShort: 4, wMid: 2, wLong: 1, hi: 70, lo: 30 } },
  { key: "elder", label: "Elder Ray (bull / bear power)", pane: "own", params: { n: 13 } },
  { key: "force", label: "Force Index", pane: "own", params: { n: 13 } },
  { key: "eom", label: "Ease of Movement", pane: "own", params: { n: 14, scale: 100000000 } },
  { key: "chaikinOsc", label: "Chaikin Oscillator", pane: "own", params: { fast: 3, slow: 10 } },
  { key: "ppo", label: "PPO (Percentage Price Oscillator)", pane: "own", params: { fast: 12, slow: 26, signal: 9 } },
  { key: "dpo", label: "DPO (Detrended Price Oscillator)", pane: "own", params: { n: 20 } },
  { key: "vortex", label: "Vortex", pane: "own", params: { n: 14 } },
  { key: "mass", label: "Mass Index", pane: "own", params: { n: 9, sum: 25, bulge: 27, trigger: 26.5 } },
  { key: "coppock", label: "Coppock Curve", pane: "own", params: { roc1: 14, roc2: 11, wma: 10 } },
  { key: "volosc", label: "Volume oscillator", pane: "own", params: { fast: 5, slow: 10 } },
  { key: "envelope", label: "Moving-average envelope", pane: "price", params: { n: 20, pct: 2.5, kind: "SMA" } },
  { key: "linreg", label: "Linear regression line", pane: "price", params: { n: 50 } },
  { key: "stochRsi", label: "Stochastic RSI", pane: "own", params: { rsi: 14, n: 14, k: 3, d: 3, hi: 80, lo: 20 } },
  { key: "momentum", label: "Momentum", pane: "own", params: { n: 10 } },
  { key: "ao", label: "Awesome Oscillator", pane: "own", params: { fast: 5, slow: 34 } },
  { key: "tsi", label: "TSI (True Strength Index)", pane: "own", params: { long: 25, short: 13, signal: 13, hi: 25, lo: -25 } },
  { key: "hv", label: "Historical volatility %", pane: "own", params: { n: 20 } },
  { key: "stddev", label: "Standard deviation", pane: "own", params: { n: 20 } },
  { key: "lrslope", label: "Linear regression slope and R²", pane: "own", params: { n: 50 } },
  { key: "chop", label: "Choppiness Index", pane: "own", params: { n: 14, hi: 61.8, lo: 38.2 } },
  { key: "ulcer", label: "Ulcer Index", pane: "own", params: { n: 14 } },
];
