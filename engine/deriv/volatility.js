// Realised volatility, IV rank / percentile, volatility cones, the volatility
// risk premium and regime classification. Bars are column arrays
// {time, open, high, low, close}; volatilities are annualised with 252 sessions.

const ANN = 252;
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

/** Realised volatility on the last `n` sessions ending at index `end` (inclusive). */
export function realisedVol(b, n = 20, method = "cc", end = b.close.length - 1) {
  const s = end - n + 1;
  if (s < 1) return null;
  const O = b.open, H = b.high, L = b.low, C = b.close;
  const ln = Math.log;
  if (method === "cc") {
    const r = []; for (let i = s; i <= end; i++) r.push(ln(C[i] / C[i - 1]));
    const m = mean(r); return Math.sqrt((r.reduce((a, x) => a + (x - m) ** 2, 0) / (r.length - 1)) * ANN);
  }
  if (method === "parkinson") {
    let a = 0; for (let i = s; i <= end; i++) a += ln(H[i] / L[i]) ** 2;
    return Math.sqrt((a / (4 * Math.log(2) * n)) * ANN);
  }
  if (method === "gk") {
    let a = 0; for (let i = s; i <= end; i++) a += 0.5 * ln(H[i] / L[i]) ** 2 - (2 * Math.log(2) - 1) * ln(C[i] / O[i]) ** 2;
    return a > 0 ? Math.sqrt((a / n) * ANN) : null;
  }
  if (method === "yz") {
    const k = 0.34 / (1.34 + (n + 1) / (n - 1));
    const on = [], oc = []; let rs = 0;
    for (let i = s; i <= end; i++) {
      on.push(ln(O[i] / C[i - 1])); oc.push(ln(C[i] / O[i]));
      rs += ln(H[i] / C[i]) * ln(H[i] / O[i]) + ln(L[i] / C[i]) * ln(L[i] / O[i]);
    }
    const v = (xs) => { const m = mean(xs); return xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1); };
    const vv = v(on) + k * v(oc) + (1 - k) * (rs / n);
    return vv > 0 ? Math.sqrt(vv * ANN) : null;
  }
  return null;
}

export const RV_METHODS = { cc: "Close-to-close", parkinson: "Parkinson (high-low)", gk: "Garman-Klass", yz: "Yang-Zhang" };

/** Rolling realised volatility series. */
export function rvSeries(b, n = 20, method = "cc") {
  const out = new Array(b.close.length).fill(null);
  for (let i = n; i < b.close.length; i++) out[i] = realisedVol(b, n, method, i);
  return out;
}

/** IV rank and IV percentile of the latest value over a look-back (disclosed). */
export function ivRank(series, lookback = 252) {
  const xs = series.filter((x) => Number.isFinite(x));
  if (xs.length < 20) return { rank: null, percentile: null, n: xs.length, lookback };
  const win = xs.slice(-lookback), cur = win[win.length - 1];
  const lo = Math.min(...win), hi = Math.max(...win);
  return { rank: hi > lo ? (cur - lo) / (hi - lo) : null, percentile: win.filter((x) => x < cur).length / (win.length - 1 || 1), n: win.length, lookback, lo, hi, cur };
}

/** Volatility cone: percentile bands of realised vol at several horizons, with the current value. */
export function volCone(b, horizons = [10, 20, 40, 60, 120, 252], method = "cc", pcts = [0.05, 0.25, 0.5, 0.75, 0.95]) {
  return horizons.map((n) => {
    const s = rvSeries(b, n, method).filter((x) => x != null);
    if (s.length < 30) return { n, current: null, bands: null };
    const sorted = [...s].sort((a, c) => a - c);
    const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
    return { n, current: s[s.length - 1], bands: Object.fromEntries(pcts.map((p) => [p, q(p)])) };
  });
}

/**
 * Volatility risk premium: implied minus realised.
 * trailing   = IV today - RV over the last n sessions
 * subsequent = IV on a past date - RV realised over the n sessions after it (needs history)
 */
export function vrp(ivSeries, dates, b, n = 20) {
  const idx = new Map(b.time.map((t, i) => [t, i]));
  const rows = [];
  for (let k = 0; k < dates.length; k++) {
    const i = idx.get(dates[k]); const iv = ivSeries[k];
    if (i == null || !(iv > 0)) continue;
    const trailing = realisedVol(b, n, "cc", i);
    const subsequent = i + n < b.close.length ? realisedVol(b, n, "cc", i + n) : null;
    rows.push({ date: dates[k], iv, rvTrailing: trailing, rvSubsequent: subsequent, vrpTrailing: trailing != null ? iv - trailing : null, vrpSubsequent: subsequent != null ? iv - subsequent : null });
  }
  const done = rows.filter((r) => r.vrpSubsequent != null);
  const avg = done.length ? mean(done.map((r) => r.vrpSubsequent)) : null;
  return { rows, avgSubsequent: avg, sellerRegime: avg == null ? null : avg > 0.01 ? "Implied vol has tended to exceed what was realised (option sellers were paid)" : avg < -0.01 ? "Realised vol has tended to exceed implied (option buyers were paid)" : "Implied and realised have been close" };
}

/** Regime by the instrument's own IV percentile. */
export function volRegime(percentile) {
  if (percentile == null) return { key: "unknown", label: "Not enough history" };
  if (percentile < 0.2) return { key: "low", label: "Low / compressed" };
  if (percentile < 0.8) return { key: "normal", label: "Normal" };
  if (percentile < 0.95) return { key: "elevated", label: "Elevated" };
  return { key: "extreme", label: "Extreme / crisis" };
}

/** IV expansion / contraction and mean-reversion alerts from a daily ATM IV series. */
export function ivAlerts(series) {
  const xs = series.filter((x) => Number.isFinite(x));
  if (xs.length < 25) return [];
  const cur = xs[xs.length - 1], prev5 = xs[xs.length - 6], med = [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const out = [];
  if (prev5 && cur / prev5 - 1 > 0.2) out.push(`IV expanded ${((cur / prev5 - 1) * 100).toFixed(0)}% in 5 sessions`);
  if (prev5 && cur / prev5 - 1 < -0.2) out.push(`IV contracted ${((1 - cur / prev5) * 100).toFixed(0)}% in 5 sessions`);
  if (cur > med * 1.5) out.push("IV is far above its median: historically it has tended to fall back");
  if (cur < med * 0.67) out.push("IV is far below its median: historically it has tended to rise back");
  return out;
}

/**
 * Short-term IV forecast: an AR(1) mean-reversion fit on log IV over the
 * stored history, projected h sessions ahead with a one-sd band. A statistical
 * projection, shown with its half-life and fit; not a prediction of events.
 */
export function ivForecast(series, h = 5) {
  const xs = series.filter((x) => x > 0).map(Math.log);
  if (xs.length < 30) return null;
  const x0 = xs.slice(0, -1), x1 = xs.slice(1);
  const mx = mean(x0), my = mean(x1);
  let sxy = 0, sxx = 0; for (let i = 0; i < x0.length; i++) { sxy += (x0[i] - mx) * (x1[i] - my); sxx += (x0[i] - mx) ** 2; }
  const phi = Math.max(-0.99, Math.min(0.995, sxx > 0 ? sxy / sxx : 0)), c = my - phi * mx;
  const resid = x1.map((y, i) => y - (c + phi * x0[i])), sd = Math.sqrt(resid.reduce((a, e) => a + e * e, 0) / (resid.length - 2));
  const longRun = c / (1 - phi);
  const path = []; let x = xs[xs.length - 1], v = 0;
  for (let k = 1; k <= h; k++) { x = c + phi * x; v = v * phi * phi + sd * sd; path.push({ step: k, iv: Math.exp(x), lo: Math.exp(x - Math.sqrt(v)), hi: Math.exp(x + Math.sqrt(v)) }); }
  return { path, longRun: Math.exp(longRun), halfLife: phi > 0 ? Math.log(0.5) / Math.log(phi) : null, phi, n: xs.length };
}

/** Event IV crush: ATM IV on the session before each event vs the first session after it. */
export function eventCrush(dates, ivSeries, eventDates) {
  const out = [];
  for (const e of eventDates) {
    const i = dates.findIndex((d) => d >= e);
    if (i < 1) continue;
    const j = dates[i] === e ? i + 1 : i;
    const a = ivSeries[i - 1], b = ivSeries[j];
    if (a > 0 && b > 0) out.push({ event: e, before: a, after: b, change: b / a - 1 });
  }
  return out;
}
