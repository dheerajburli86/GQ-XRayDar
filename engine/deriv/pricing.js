// Option pricing models, Greeks and implied volatility. Pure functions, no I/O.
//
// Models (each disclosed on every Greeks view through MODEL_INFO):
//   BSM       Black-Scholes-Merton, European, spot S with dividend yield q
//   BLACK76   options on a futures price F (index / commodity options priced off
//             the same-expiry future, which removes the dividend assumption)
//   BACHELIER normal model (absolute volatility), for near-zero or negative prices
//   CRR       Cox-Ross-Rubinstein binomial tree, European or American
//   TRINOMIAL Boyle trinomial tree, European or American
//   BAW       Barone-Adesi-Whaley approximation for American exercise
//
// Units: T in years, r / q / sigma as decimals (0.065, 0.20). Theta is per
// CALENDAR day, vega and vomma per 1 vol point (0.01), rho per 1% rate move.

const SQ2PI = Math.sqrt(2 * Math.PI);
export const npdf = (x) => Math.exp(-0.5 * x * x) / SQ2PI;
/** Normal CDF: Hart (1968) double-precision algorithm as given by West (2005), |err| < 1e-14. */
export function ncdf(x) {
  const ax = Math.abs(x);
  let c;
  if (ax > 37) c = 0;
  else {
    const e = Math.exp((-ax * ax) / 2);
    if (ax < 7.07106781186547) {
      let n = 3.52624965998911e-2 * ax + 0.700383064443688; n = n * ax + 6.37396220353165; n = n * ax + 33.912866078383; n = n * ax + 112.079291497871; n = n * ax + 221.213596169931; n = n * ax + 220.206867912376;
      let d = 8.83883476483184e-2 * ax + 1.75566716318264; d = d * ax + 16.064177579207; d = d * ax + 86.7807322029461; d = d * ax + 296.564248779674; d = d * ax + 637.333633378831; d = d * ax + 793.826512519948; d = d * ax + 440.413735824752;
      c = (e * n) / d;
    } else {
      let d = ax + 0.65; d = ax + 4 / d; d = ax + 3 / d; d = ax + 2 / d; d = ax + 1 / d;
      c = e / d / 2.506628274631;
    }
  }
  return x > 0 ? 1 - c : c;
}
/** Inverse normal CDF (Acklam), used for strike-at-delta and expected moves. */
export function ninv(p) {
  if (p <= 0) return -Infinity; if (p >= 1) return Infinity;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  let q, r;
  if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - pl) { q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  q = p - 0.5; r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

export const MODEL_INFO = {
  BSM: "Black-Scholes-Merton (European, spot with continuous dividend yield)",
  BLACK76: "Black-76 (European option on the same-expiry futures price)",
  BACHELIER: "Bachelier normal model (absolute volatility)",
  CRR: "Cox-Ross-Rubinstein binomial tree",
  TRINOMIAL: "Boyle trinomial tree",
  BAW: "Barone-Adesi-Whaley (American early exercise approximation)",
};

/**
 * Generalised Black-Scholes. For BLACK76 pass the futures price as S and b = 0;
 * for BSM b = r - q. Returns price and the full Greek set.
 * cp: +1 call, -1 put.
 */
export function gbs(cp, S, K, T, r, b, v) {
  if (!(S > 0 && K > 0)) return null;
  const df = Math.exp(-r * T), carry = Math.exp((b - r) * T);
  if (!(T > 0) || !(v > 0)) {
    const intrinsic = Math.max(0, cp * (S * carry - K * df));
    return { price: intrinsic, delta: intrinsic > 0 ? cp * carry : 0, gamma: 0, theta: 0, vega: 0, rho: 0, vanna: 0, charm: 0, vomma: 0, speed: 0, zomma: 0, color: 0 };
  }
  const sT = Math.sqrt(T), vs = v * sT;
  const d1 = (Math.log(S / K) + (b + 0.5 * v * v) * T) / vs, d2 = d1 - vs;
  const nd1 = npdf(d1);
  const price = cp * (S * carry * ncdf(cp * d1) - K * df * ncdf(cp * d2));
  const delta = cp * carry * ncdf(cp * d1);
  const gamma = (carry * nd1) / (S * vs);
  const vegaRaw = S * carry * nd1 * sT; // per 1.00 vol
  const thetaYr = (-S * carry * nd1 * v) / (2 * sT) - cp * (b - r) * S * carry * ncdf(cp * d1) - cp * r * K * df * ncdf(cp * d2);
  const rhoRaw = b === 0 ? -T * price : cp * K * T * df * ncdf(cp * d2);
  const vanna = (-carry * nd1 * d2) / v; // dDelta/dVol per 1.00 vol
  const charmYr = -carry * (nd1 * (b / vs - d2 / (2 * T)) + cp * (b - r) * ncdf(cp * d1)); // delta change per year of time passing
  const vomma = (vegaRaw * d1 * d2) / v;
  const speed = (-gamma / S) * (d1 / vs + 1);
  const zomma = (gamma * (d1 * d2 - 1)) / v;
  const colorYr = -gamma * (r - b + (b * d1) / vs + (1 - d1 * d2) / (2 * T));
  return {
    price, delta, gamma,
    theta: thetaYr / 365, vega: vegaRaw / 100, rho: rhoRaw / 100,
    vanna: vanna / 100, charm: charmYr / 365, vomma: vomma / 10000,
    speed, zomma: zomma / 100, color: -colorYr / 365,
  };
}

/** Price + Greeks under a named model. inp: {cp, S, F?, K, T, r, q, v, american?, steps?} */
export function priceOption(model, inp) {
  const { cp, S, F, K, T, r = 0, q = 0, v } = inp;
  if (model === "BLACK76") return gbs(cp, F ?? S, K, T, r, 0, v);
  if (model === "BACHELIER") return bachelier(cp, F ?? S, K, T, r, v);
  if (model === "CRR") return treeGreeks((vv, SS, TT) => crr(cp, SS, K, TT, r, q, vv, inp.american, inp.steps), S, T, v);
  if (model === "TRINOMIAL") return treeGreeks((vv, SS, TT) => trinomial(cp, SS, K, TT, r, q, vv, inp.american, inp.steps), S, T, v);
  if (model === "BAW") return treeGreeks((vv, SS, TT) => baw(cp, SS, K, TT, r, q, vv), S, T, v);
  return gbs(cp, S, K, T, r, r - q, v);
}

/** Bachelier (normal) model; v is an absolute price volatility per sqrt(year). */
export function bachelier(cp, F, K, T, r, v) {
  const df = Math.exp(-r * T);
  if (!(T > 0) || !(v > 0)) { const p = Math.max(0, cp * (F - K)) * df; return { price: p, delta: p > 0 ? cp * df : 0, gamma: 0, theta: 0, vega: 0, rho: 0 }; }
  const s = v * Math.sqrt(T), d = (F - K) / s;
  const price = df * (cp * (F - K) * ncdf(cp * d) + s * npdf(d));
  return { price, delta: cp * df * ncdf(cp * d), gamma: (df * npdf(d)) / s, vega: (df * Math.sqrt(T) * npdf(d)) / 100, theta: (-(df * v * npdf(d)) / (2 * Math.sqrt(T)) + r * price) / 365, rho: (-T * price) / 100 };
}

export function crr(cp, S, K, T, r, q, v, american = false, steps = 200) {
  if (!(T > 0)) return Math.max(0, cp * (S - K));
  const dt = T / steps, u = Math.exp(v * Math.sqrt(dt)), d = 1 / u, a = Math.exp((r - q) * dt), p = (a - d) / (u - d), disc = Math.exp(-r * dt);
  const val = new Float64Array(steps + 1);
  for (let i = 0; i <= steps; i++) val[i] = Math.max(0, cp * (S * u ** (steps - i) * d ** i - K));
  for (let n = steps - 1; n >= 0; n--) for (let i = 0; i <= n; i++) {
    let x = disc * (p * val[i] + (1 - p) * val[i + 1]);
    if (american) x = Math.max(x, cp * (S * u ** (n - i) * d ** i - K));
    val[i] = x;
  }
  return val[0];
}

export function trinomial(cp, S, K, T, r, q, v, american = false, steps = 150) {
  if (!(T > 0)) return Math.max(0, cp * (S - K));
  const dt = T / steps, u = Math.exp(v * Math.sqrt(2 * dt)), e1 = Math.exp(((r - q) * dt) / 2), e2 = Math.exp(v * Math.sqrt(dt / 2));
  const pu = ((e1 - 1 / e2) / (e2 - 1 / e2)) ** 2, pd = ((e2 - e1) / (e2 - 1 / e2)) ** 2, pm = 1 - pu - pd, disc = Math.exp(-r * dt);
  let val = new Float64Array(2 * steps + 1);
  for (let i = 0; i <= 2 * steps; i++) val[i] = Math.max(0, cp * (S * u ** (steps - i) - K));
  for (let n = steps - 1; n >= 0; n--) {
    const nv = new Float64Array(2 * n + 1);
    for (let i = 0; i <= 2 * n; i++) {
      let x = disc * (pu * val[i] + pm * val[i + 1] + pd * val[i + 2]);
      if (american) x = Math.max(x, cp * (S * u ** (n - i) - K));
      nv[i] = x;
    }
    val = nv;
  }
  return val[0];
}

/** Barone-Adesi-Whaley quadratic approximation for American options. */
export function baw(cp, S, K, T, r, q, v) {
  const euro = gbs(cp, S, K, T, r, r - q, v)?.price ?? 0;
  if (!(T > 0)) return Math.max(0, cp * (S - K));
  if (cp > 0 && q <= 0) return euro; // an American call on a non-dividend underlying is never exercised early
  const b = r - q, M = (2 * r) / (v * v), N = (2 * b) / (v * v), Kk = 1 - Math.exp(-r * T);
  const qq = cp > 0 ? (-(N - 1) + Math.sqrt((N - 1) ** 2 + (4 * M) / Kk)) / 2 : (-(N - 1) - Math.sqrt((N - 1) ** 2 + (4 * M) / Kk)) / 2;
  // critical price S* by Newton iteration on
  //   f(S) = cp(S-K) - euro(S) - cp(1 - e^{(b-r)T} N(cp d1)) S / q
  const e = Math.exp((b - r) * T), vs = v * Math.sqrt(T);
  let Sx = K;
  for (let it = 0; it < 200; it++) {
    const g = gbs(cp, Sx, K, T, r, b, v);
    const d1 = (Math.log(Sx / K) + (b + 0.5 * v * v) * T) / vs;
    const Nn = ncdf(cp * d1);
    const f = cp * (Sx - K) - g.price - (cp * (1 - e * Nn) * Sx) / qq;
    if (Math.abs(f) < 1e-9 * K) break;
    const fp = cp - g.delta - (cp / qq) * ((1 - e * Nn) - (cp * e * npdf(d1)) / vs);
    if (!(Math.abs(fp) > 1e-12)) break;
    Sx = Math.max(1e-6 * K, Sx - f / fp);
  }
  const d1x = (Math.log(Sx / K) + (b + 0.5 * v * v) * T) / (v * Math.sqrt(T));
  const A = (cp * (Sx / qq) * (1 - Math.exp((b - r) * T) * ncdf(cp * d1x)));
  if (cp * (S - Sx) >= 0) return cp * (S - K);
  return euro + A * (S / Sx) ** qq;
}

/** Greeks of a numeric pricer by central differences. */
function treeGreeks(fn, S, T, v) {
  const h = S * 1e-3, dv = 1e-3, dt = Math.min(1 / 365, T / 4);
  const p = fn(v, S, T), up = fn(v, S + h, T), dn = fn(v, S - h, T);
  const vu = fn(v + dv, S, T), vd = fn(v - dv, S, T);
  const pt = T > dt ? fn(v, S, T - dt) : p;
  return { price: p, delta: (up - dn) / (2 * h), gamma: (up - 2 * p + dn) / (h * h), vega: (vu - vd) / (2 * dv) / 100, theta: (pt - p) / (dt * 365), rho: null, numeric: true };
}

/**
 * Implied volatility from a market price. Newton on vega with a bisection
 * fallback; null when the price is outside no-arbitrage bounds.
 */
export function impliedVol(model, inp, price) {
  if (!(price > 0)) return null;
  const { cp, K, T } = inp;
  if (!(T > 0)) return null;
  const S = model === "BLACK76" ? inp.F ?? inp.S : inp.S;
  const r = inp.r ?? 0, q = inp.q ?? 0;
  const df = Math.exp(-r * T);
  const fwdDisc = model === "BLACK76" ? S * df : S * Math.exp(-q * T);
  const lower = Math.max(0, cp * (fwdDisc - K * df)), upper = cp > 0 ? fwdDisc : K * df;
  if (price < lower - 1e-9 || price >= upper) return null;
  const f = (v) => (priceOption(model, { ...inp, v })?.price ?? 0) - price;
  let v = 0.3;
  for (let i = 0; i < 30; i++) {
    const g = priceOption(model, { ...inp, v });
    const diff = g.price - price;
    if (Math.abs(diff) < 1e-7 * Math.max(1, price)) return v;
    const vega = g.vega * 100;
    if (!(vega > 1e-10)) break;
    const nv = v - diff / vega;
    if (!(nv > 0.0005 && nv < 6)) break;
    v = nv;
  }
  let lo = 0.0005, hi = 6;
  if (f(lo) > 0 || f(hi) < 0) return null;
  for (let i = 0; i < 100; i++) { const m = (lo + hi) / 2; if (f(m) > 0) hi = m; else lo = m; if (hi - lo < 1e-7) break; }
  return (lo + hi) / 2;
}

/** Year fraction between two ISO dates, calendar days / 365 (disclosed). */
export function yearFrac(from, to) {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return (b - a) / 86400000 / 365;
}

/** Strike whose option has the given delta (BSM / Black-76 forward delta). */
export function strikeForDelta(cp, F, T, v, delta) {
  const d1 = cp > 0 ? ninv(delta) : -ninv(-delta);
  return F * Math.exp(-d1 * v * Math.sqrt(T) + 0.5 * v * v * T);
}
