// Classical chart patterns from swing pivots (a percentage zig-zag):
// head & shoulders (and inverse), double / triple tops and bottoms, ascending /
// descending / symmetrical triangles, rising / falling wedges, rectangles and
// bull / bear flags. Each result carries its pivot points, the breakout or
// neckline level, a measured-move target and whether price has confirmed it.
// Descriptive pattern labels on past prices, not forecasts.

/** Zig-zag pivots: a swing ends when price reverses by `pct` (fraction) from its extreme. */
export function zigzag(b, pct = 0.05, from = 0) {
  const n = b.close.length, out = [];
  if (n - from < 3) return out;
  let trend = 0, hiI = from, loI = from;
  for (let i = from + 1; i < n; i++) {
    if (trend === 0) {
      if (b.high[i] > b.high[hiI]) hiI = i;
      if (b.low[i] < b.low[loI]) loI = i;
      if (hiI > loI && b.high[hiI] >= b.low[loI] * (1 + pct)) { out.push({ i: loI, price: b.low[loI], type: "L" }); trend = 1; }
      else if (loI > hiI && b.low[loI] <= b.high[hiI] * (1 - pct)) { out.push({ i: hiI, price: b.high[hiI], type: "H" }); trend = -1; }
    } else if (trend > 0) {
      if (b.high[i] >= b.high[hiI]) hiI = i;
      else if (b.low[i] <= b.high[hiI] * (1 - pct)) { out.push({ i: hiI, price: b.high[hiI], type: "H" }); trend = -1; loI = i; }
    } else {
      if (b.low[i] <= b.low[loI]) loI = i;
      else if (b.high[i] >= b.low[loI] * (1 + pct)) { out.push({ i: loI, price: b.low[loI], type: "L" }); trend = 1; hiI = i; }
    }
  }
  // the unfinished swing: its extreme counts as a tentative pivot
  if (trend > 0) out.push({ i: hiI, price: b.high[hiI], type: "H", tentative: true });
  else if (trend < 0) out.push({ i: loI, price: b.low[loI], type: "L", tentative: true });
  return out;
}

const near = (a, b, tol) => Math.abs(a / b - 1) <= tol;
/** Least-squares line through points {i, price}. */
function fit(pts) { const n = pts.length, mx = pts.reduce((s, p) => s + p.i, 0) / n, my = pts.reduce((s, p) => s + p.price, 0) / n; let sxy = 0, sxx = 0; for (const p of pts) { sxy += (p.i - mx) * (p.price - my); sxx += (p.i - mx) ** 2; } const m = sxx ? sxy / sxx : 0; return { m, c: my - m * mx, at: (i) => my + m * (i - mx) }; }

const REVERSAL = new Set(["head_shoulders", "inv_head_shoulders", "double_top", "double_bottom", "triple_top", "triple_bottom"]);

export const PATTERN_INFO = {
  head_shoulders: { label: "Head and shoulders", dir: -1 }, inv_head_shoulders: { label: "Inverse head and shoulders", dir: 1 },
  double_top: { label: "Double top", dir: -1 }, double_bottom: { label: "Double bottom", dir: 1 },
  triple_top: { label: "Triple top", dir: -1 }, triple_bottom: { label: "Triple bottom", dir: 1 },
  asc_triangle: { label: "Ascending triangle", dir: 1 }, desc_triangle: { label: "Descending triangle", dir: -1 }, sym_triangle: { label: "Symmetrical triangle", dir: 0 },
  rising_wedge: { label: "Rising wedge", dir: -1 }, falling_wedge: { label: "Falling wedge", dir: 1 }, rectangle: { label: "Rectangle", dir: 0 },
  bull_flag: { label: "Bull flag", dir: 1 }, bear_flag: { label: "Bear flag", dir: -1 },
};

/**
 * Patterns that end within the last `recent` bars. opts.pct: zig-zag size
 * (default from the series' own volatility), tol: equality tolerance for peaks.
 */
export function chartPatterns(b, { pct = null, tol = 0.02, recent = 15, lookback = 300 } = {}) {
  const n = b.close?.length || 0;
  if (n < 40) return [];
  const from = Math.max(0, n - lookback);
  let p = pct;
  if (!p) { const r = []; for (let i = Math.max(from + 1, n - 120); i < n; i++) r.push(Math.abs(Math.log(b.close[i] / b.close[i - 1]))); const md = r.sort((x, y) => x - y)[Math.floor(r.length / 2)] || 0.01; p = Math.min(0.15, Math.max(0.03, md * 5)); }
  const pv = zigzag(b, p, from);
  const last = n - 1, close = b.close[last], out = [];
  const T = (pp) => ({ time: b.time[pp.i], price: pp.price });
  const add = (key, pts, level, target, extra = {}) => {
    const info = PATTERN_INFO[key], dir = info.dir;
    const end = pts[pts.length - 1].i;
    // a reversal pattern whose extreme has since been taken out is void
    if (REVERSAL.has(key)) { const ext = dir < 0 ? Math.max(...pts.map((q) => q.price)) : Math.min(...pts.map((q) => q.price)); if (dir < 0 ? close > ext * (1 + tol / 2) : close < ext * (1 - tol / 2)) return; }
    if (last - end > recent + 40) return;
    let status = "forming";
    if (level != null) { if (dir > 0 && close > level) status = "confirmed"; else if (dir < 0 && close < level) status = "confirmed"; else if (dir === 0 && extra.upper != null && (close > extra.upper || close < extra.lower)) status = close > extra.upper ? "broke up" : "broke down"; }
    if (status === "forming" && last - end > recent) return;
    out.push({ key, label: info.label, dir, status, points: pts.map(T), level, target, start: b.time[pts[0].i], end: b.time[end], ...extra });
  };
  const L = pv.length;
  // ---- five-pivot reversal shapes
  for (let k = Math.max(0, L - 7); k + 4 < L; k++) {
    const [a, s1, h, s2, c] = pv.slice(k, k + 5);
    // H L H L H : head and shoulders on the highs
    if (a.type === "H") {
      const [ls, n1, hd, n2, rs] = [a, s1, h, s2, c];
      if (hd.price > ls.price * (1 + tol) && hd.price > rs.price * (1 + tol) && near(ls.price, rs.price, tol * 2)) {
        const neck = fit([n1, n2]), lvl = neck.at(last);
        add("head_shoulders", [ls, n1, hd, n2, rs], lvl, lvl - (hd.price - neck.at(hd.i)));
      } else if (near(a.price, h.price, tol) && near(h.price, c.price, tol)) {
        const lvl = Math.min(s1.price, s2.price); add("triple_top", [a, s1, h, s2, c], lvl, lvl - (Math.max(a.price, h.price, c.price) - lvl));
      }
    } else {
      const [ls, n1, hd, n2, rs] = [a, s1, h, s2, c];
      if (hd.price < ls.price * (1 - tol) && hd.price < rs.price * (1 - tol) && near(ls.price, rs.price, tol * 2)) {
        const neck = fit([n1, n2]), lvl = neck.at(last);
        add("inv_head_shoulders", [ls, n1, hd, n2, rs], lvl, lvl + (neck.at(hd.i) - hd.price));
      } else if (near(a.price, h.price, tol) && near(h.price, c.price, tol)) {
        const lvl = Math.max(s1.price, s2.price); add("triple_bottom", [a, s1, h, s2, c], lvl, lvl + (lvl - Math.min(a.price, h.price, c.price)));
      }
    }
  }
  // ---- double tops / bottoms (three pivots)
  for (let k = Math.max(0, L - 4); k + 2 < L; k++) {
    const [x, m, y] = pv.slice(k, k + 3);
    if (x.type === "H" && near(x.price, y.price, tol) && m.price < Math.min(x.price, y.price) * (1 - 2 * tol)) add("double_top", [x, m, y], m.price, m.price - (Math.max(x.price, y.price) - m.price));
    if (x.type === "L" && near(x.price, y.price, tol) && m.price > Math.max(x.price, y.price) * (1 + 2 * tol)) add("double_bottom", [x, m, y], m.price, m.price + (m.price - Math.min(x.price, y.price)));
  }
  // ---- converging / parallel boundaries over the last 4-6 pivots
  if (L >= 4) {
    const seg = pv.slice(-Math.min(6, L));
    const hs = seg.filter((q) => q.type === "H"), ls = seg.filter((q) => q.type === "L");
    if (hs.length >= 2 && ls.length >= 2) {
      const up = fit(hs), dn = fit(ls), span = seg[seg.length - 1].i - seg[0].i || 1;
      const slopeH = (up.m * span) / up.at(seg[0].i), slopeL = (dn.m * span) / dn.at(seg[0].i);
      const flat = (s) => Math.abs(s) < tol, uH = up.at(last), uL = dn.at(last);
      const height = up.at(seg[0].i) - dn.at(seg[0].i);
      if (uH > uL) {
        const ext = { upper: uH, lower: uL };
        if (flat(slopeH) && slopeL > tol) add("asc_triangle", seg, uH, uH + height, ext);
        else if (flat(slopeL) && slopeH < -tol) add("desc_triangle", seg, uL, uL - height, ext);
        else if (slopeH < -tol && slopeL > tol) add("sym_triangle", seg, null, null, ext);
        else if (slopeH > tol && slopeL > slopeH + tol / 2) add("rising_wedge", seg, uL, dn.at(seg[0].i), ext);
        else if (slopeL < -tol && slopeH < slopeL - tol / 2) add("falling_wedge", seg, uH, up.at(seg[0].i), ext);
        else if (flat(slopeH) && flat(slopeL) && height / uL > 2 * tol) add("rectangle", seg, null, null, ext);
      }
    }
  }
  // ---- flags: a sharp pole, then a short shallow counter-move
  for (const lenPole of [10, 15, 20]) {
    for (let cons = 3; cons <= 15; cons++) {
      const pe = last - cons, ps = pe - lenPole;
      if (ps < from) break;
      const pole = b.close[pe] / b.close[ps] - 1;
      if (Math.abs(pole) < 3 * p) continue;
      let hi = -Infinity, lo = Infinity; for (let j = pe; j < last; j++) { hi = Math.max(hi, b.high[j]); lo = Math.min(lo, b.low[j]); }
      const rangeOk = (hi - lo) < 0.5 * Math.abs(b.close[pe] - b.close[ps]);
      if (!rangeOk) continue;
      const pts = [{ i: ps, price: b.close[ps] }, { i: pe, price: b.close[pe] }, { i: last - 1, price: pole > 0 ? lo : hi }];
      if (pole > 0) add("bull_flag", pts, hi, hi + (b.close[pe] - b.close[ps]));
      else add("bear_flag", pts, lo, lo - (b.close[ps] - b.close[pe]));
      break;
    }
    if (out.some((x) => x.key.endsWith("_flag"))) break;
  }
  // newest first, one of each key
  const seen = new Set();
  return out.sort((x, y) => (x.end < y.end ? 1 : -1)).filter((x) => (seen.has(x.key) ? false : seen.add(x.key)));
}
