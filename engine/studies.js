// Standard technical studies (owner's additional feature list, item 1). Every function takes
// candle arrays of ONE timeframe (the caller aggregates first: weekly studies are computed on
// weekly candles, never on resampled daily values) and returns arrays aligned to them, null
// where the study is not yet defined. Conventions follow the original authors (Wilder for
// ATR / ADX / Parabolic SAR, Lane for Stochastics, Hosoda for Ichimoku, Chaikin for CMF / A-D).
// Tests: tests/studies.test.mjs.
import { sma, ema } from "./indicators.js";

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

/** Catalogue for the UI: key, label, where it is drawn, default parameters. */
export const STUDIES = [
  { key: "ichimoku", label: "Ichimoku cloud", pane: "price", params: { tenkan: 9, kijun: 26, spanB: 52 } },
  { key: "psar", label: "Parabolic SAR", pane: "price", params: { step: 0.02, max: 0.2 } },
  { key: "supertrend", label: "Supertrend", pane: "price", params: { n: 10, m: 3 } },
  { key: "pivots", label: "Pivot points", pane: "price", params: { kind: "standard" } },
  { key: "vwap", label: "VWAP (monthly session)", pane: "price", params: {} },
  { key: "avwap", label: "Anchored VWAP ± bands", pane: "price", params: { anchor: null } },
  { key: "stoch", label: "Stochastic (slow)", pane: "own", params: { k: 14, d: 3, smooth: 3 } },
  { key: "stochFast", label: "Stochastic (fast)", pane: "own", params: { k: 14, d: 3 } },
  { key: "adx", label: "ADX + DI", pane: "own", params: { n: 14 } },
  { key: "atr", label: "ATR", pane: "own", params: { n: 14 } },
  { key: "obv", label: "On-Balance Volume", pane: "own", params: {} },
  { key: "cmf", label: "Chaikin Money Flow", pane: "own", params: { n: 20 } },
  { key: "ad", label: "Accumulation / Distribution", pane: "own", params: {} },
  { key: "roc", label: "ROC (rate of change %)", pane: "own", params: { n: 12 } },
  { key: "volosc", label: "Volume oscillator", pane: "own", params: { fast: 5, slow: 10 } },
];
