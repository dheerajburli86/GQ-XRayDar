// Chart transforms on column bars {time[], open[], high[], low[], close[], volume[]}:
// Heikin-Ashi candles, support / resistance levels, Renko, Kagi, Point & Figure
// and the volume profile. Descriptive only: these show where the series has
// traded and turned, never a forecast.

export function heikinAshi(b) {
  const n = b.time.length, out = { time: b.time, open: new Array(n), high: new Array(n), low: new Array(n), close: new Array(n), volume: b.volume };
  for (let i = 0; i < n; i++) {
    const c = (b.open[i] + b.high[i] + b.low[i] + b.close[i]) / 4;
    const o = i === 0 ? (b.open[i] + b.close[i]) / 2 : (out.open[i - 1] + out.close[i - 1]) / 2;
    out.open[i] = o; out.close[i] = c; out.high[i] = Math.max(b.high[i], o, c); out.low[i] = Math.min(b.low[i], o, c);
  }
  return out;
}

/** Swing-pivot levels clustered within tolPct; strength = number of pivots in a level. */
export function supportResistance(b, { win = 5, tolPct = 1.5, lookback = 300, max = 3 } = {}) {
  const n = b.time.length;
  if (n < win * 2 + 3) return [];
  const piv = [];
  for (let i = Math.max(win, n - lookback); i < n - win; i++) {
    let isH = true, isL = true;
    for (let j = i - win; j <= i + win; j++) { if (j === i) continue; if (b.high[j] >= b.high[i]) isH = false; if (b.low[j] <= b.low[i]) isL = false; }
    if (isH) piv.push({ price: b.high[i], time: b.time[i] });
    if (isL) piv.push({ price: b.low[i], time: b.time[i] });
  }
  piv.sort((x, y) => x.price - y.price);
  const cl = [];
  for (const p of piv) { const c = cl[cl.length - 1]; if (c && ((p.price - c.lo) / c.lo) * 100 <= tolPct) { c.pts.push(p); } else cl.push({ lo: p.price, pts: [p] }); }
  const last = b.close[n - 1];
  const lv = cl.filter((c) => c.pts.length >= 2).map((c) => ({ price: c.pts.reduce((s, p) => s + p.price, 0) / c.pts.length, touches: c.pts.length, last: c.pts.reduce((m, p) => (p.time > m ? p.time : m), "") }));
  const sup = lv.filter((l) => l.price < last).sort((a, c) => c.touches - a.touches || c.price - a.price).slice(0, max).map((l) => ({ ...l, kind: "support" }));
  const res = lv.filter((l) => l.price >= last).sort((a, c) => c.touches - a.touches || a.price - c.price).slice(0, max).map((l) => ({ ...l, kind: "resistance" }));
  return [...res, ...sup];
}

/** Brick size default: 14-period ATR-ish = median absolute daily move x 2, rounded. */
export function defaultBox(b) {
  const moves = [];
  for (let i = Math.max(1, b.close.length - 250); i < b.close.length; i++) moves.push(Math.abs(b.close[i] - b.close[i - 1]));
  moves.sort((x, y) => x - y);
  const m = moves[Math.floor(moves.length / 2)] || b.close[b.close.length - 1] * 0.01;
  const raw = m * 2, mag = 10 ** Math.floor(Math.log10(raw));
  return Math.max(mag, Math.round(raw / mag) * mag);
}

/** Renko on closes: a brick each time price moves a full box beyond the last brick;
 *  a reversal needs a two-box move (one box to clear the last brick, one to draw). */
export function renko(b, box = defaultBox(b)) {
  const bricks = [];
  if (!b.close.length) return { box, bricks };
  let lo = Math.floor(b.close[0] / box) * box, hi = lo + box; // edges of the virtual last brick
  for (let i = 1; i < b.close.length; i++) {
    const c = b.close[i];
    while (c >= hi + box) { bricks.push({ time: b.time[i], open: hi, close: hi + box, high: hi + box, low: hi, up: true }); lo = hi; hi += box; }
    while (c <= lo - box) { bricks.push({ time: b.time[i], open: lo, close: lo - box, high: lo, low: lo - box, up: false }); hi = lo; lo -= box; }
  }
  return { box, bricks };
}

/** Kagi: line reverses when price moves `rev` percent against the current direction. */
export function kagi(b, revPct = 4) {
  const pts = [];
  if (!b.close.length) return pts;
  let dir = 0, ext = b.close[0], extTime = b.time[0];
  pts.push({ time: b.time[0], price: b.close[0] });
  for (let i = 1; i < b.close.length; i++) {
    const c = b.close[i];
    if (dir >= 0 && c > ext) { ext = c; extTime = b.time[i]; if (dir === 0) dir = 1; }
    else if (dir <= 0 && c < ext) { ext = c; extTime = b.time[i]; if (dir === 0) dir = -1; }
    const moved = dir > 0 ? (ext - c) / ext * 100 : (c - ext) / ext * 100;
    if (dir !== 0 && moved >= revPct) {
      pts.push({ time: extTime, price: ext });
      dir = -dir; ext = c; extTime = b.time[i];
    }
  }
  pts.push({ time: extTime, price: ext });
  // thick (yang) when the line breaks above the previous shoulder, thin (yin) when below the previous waist
  return pts.map((p, i) => ({ ...p, yang: i >= 2 ? p.price > pts[i - 2].price : null }));
}

/** Point & Figure (close method): X columns rise, O columns fall; reversal = `rev` boxes. */
export function pointFigure(b, box = defaultBox(b), rev = 3) {
  const cols = [];
  if (!b.close.length) return { box, rev, cols };
  const q = (v) => Math.floor(v / box) * box;
  let cur = null;
  for (let i = 0; i < b.close.length; i++) {
    const c = b.close[i];
    if (!cur) { cur = { kind: "X", from: q(c), to: q(c), start: b.time[i], end: b.time[i] }; continue; }
    if (cur.kind === "X") {
      if (c >= cur.to + box) { cur.to = q(c); cur.end = b.time[i]; }
      else if (c <= cur.to - rev * box) { cols.push(cur); cur = { kind: "O", from: cur.to - box, to: q(c) + box, start: b.time[i], end: b.time[i] }; }
    } else if (c <= cur.to - box) { cur.to = q(c) + box; cur.end = b.time[i]; }
    else if (c >= cur.to + rev * box) { cols.push(cur); cur = { kind: "X", from: cur.to + box, to: q(c), start: b.time[i], end: b.time[i] }; }
  }
  if (cur) cols.push(cur);
  return { box, rev, cols };
}

/** Volume traded at each price band over the window; also the point of control (busiest band). */
export function volumeProfile(b, { bins = 24, from = 0 } = {}) {
  let lo = Infinity, hi = -Infinity;
  for (let i = from; i < b.close.length; i++) { if (b.low[i] < lo) lo = b.low[i]; if (b.high[i] > hi) hi = b.high[i]; }
  if (!(hi > lo)) return { bins: [], poc: null };
  const w = (hi - lo) / bins, vol = new Array(bins).fill(0);
  for (let i = from; i < b.close.length; i++) {
    const v = b.volume ? b.volume[i] || 0 : 0;
    const a = Math.max(0, Math.floor((b.low[i] - lo) / w)), z = Math.min(bins - 1, Math.floor((b.high[i] - lo) / w));
    for (let k = a; k <= z; k++) vol[k] += v / (z - a + 1);
  }
  const out = vol.map((v, k) => ({ lo: lo + k * w, hi: lo + (k + 1) * w, volume: v }));
  const poc = out.reduce((m, x) => (x.volume > m.volume ? x : m), out[0]);
  return { bins: out, poc };
}

/**
 * Fibonacci retracement and extension levels between the highest high and
 * lowest low of the last `lookback` bars. Direction follows which extreme came
 * last: after a rise, retracements are measured down from the high.
 */
export const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.618];
export function fibonacci(b, { lookback = 250 } = {}) {
  const n = b.close.length;
  if (n < 10) return null;
  let hi = -Infinity, lo = Infinity, hiI = -1, loI = -1;
  for (let i = Math.max(0, n - lookback); i < n; i++) { if (b.high[i] > hi) { hi = b.high[i]; hiI = i; } if (b.low[i] < lo) { lo = b.low[i]; loI = i; } }
  const up = hiI > loI, range = hi - lo;
  const levels = FIB_RATIOS.map((r) => ({ ratio: r, price: up ? hi - r * range : lo + r * range, kind: r > 1 ? "extension" : "retracement" }));
  return { up, high: hi, low: lo, highTime: b.time[hiI], lowTime: b.time[loI], levels, note: `Measured ${up ? "down from the high after the rise" : "up from the low after the fall"} over the last ${Math.min(lookback, n)} candles.` };
}

/**
 * Value area of a volume profile (owner's feature list, item 6): starting at the point of
 * control, add the busier neighbouring band until `share` (70%) of the volume is covered.
 * Also the high / low volume nodes: bands that are local maxima / minima of volume.
 */
export function valueArea(vp, share = 0.7) {
  const bins = vp?.bins || [];
  if (!bins.length) return null;
  const total = bins.reduce((s, x) => s + x.volume, 0);
  let k = bins.indexOf(vp.poc), lo = k, hi = k, got = bins[k].volume;
  while (got < share * total && (lo > 0 || hi < bins.length - 1)) {
    const up = hi < bins.length - 1 ? bins[hi + 1].volume : -1, dn = lo > 0 ? bins[lo - 1].volume : -1;
    if (up >= dn) { hi++; got += up; } else { lo--; got += dn; }
  }
  const hvn = [], lvn = [];
  for (let i = 1; i < bins.length - 1; i++) {
    if (bins[i].volume > bins[i - 1].volume && bins[i].volume > bins[i + 1].volume && i !== k) hvn.push(bins[i]);
    if (bins[i].volume < bins[i - 1].volume && bins[i].volume < bins[i + 1].volume) lvn.push(bins[i]);
  }
  return { vah: bins[hi].hi, val: bins[lo].lo, poc: (vp.poc.lo + vp.poc.hi) / 2, share: total ? got / total : 0, hvn, lvn };
}

/**
 * Market profile (TPO) from end-of-day candles (feature list, item 7). There are no intraday
 * prices here, so each CANDLE is one time period ("letter") and the profile covers a block of
 * candles: a week, a month or a quarter of daily candles, or any fixed number of candles.
 * For every block: price rows of `tick`, the letters that traded at each row, point of control
 * (most letters), the 70% value area and single prints (rows touched by one letter only).
 */
export function tpoProfiles(b, { block = "M", rows = 30, from = 0, tick = null } = {}) {
  const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const keyOf = (t, i) => (typeof block === "number" ? Math.floor((i - from) / block) : block === "W" ? weekKey(t) : block === "Q" ? `${t.slice(0, 4)}Q${Math.floor((+t.slice(5, 7) - 1) / 3) + 1}` : t.slice(0, 7));
  const groups = [];
  for (let i = from; i < b.time.length; i++) {
    const k = keyOf(b.time[i], i);
    if (!groups.length || groups[groups.length - 1].key !== k) groups.push({ key: k, idx: [] });
    groups[groups.length - 1].idx.push(i);
  }
  return groups.map((g) => {
    let lo = Infinity, hi = -Infinity;
    for (const i of g.idx) { lo = Math.min(lo, b.low[i]); hi = Math.max(hi, b.high[i]); }
    // a fixed price step (shared by every profile on one chart) or `rows` rows per profile
    const step = tick > 0 ? tick : hi > lo ? (hi - lo) / rows : 1;
    const base = tick > 0 ? Math.floor(lo / step) * step : lo;
    const nRows = hi > lo ? Math.max(1, Math.ceil((hi - base) / step - 1e-9)) : 1;
    const prof = Array.from({ length: nRows }, (_, r) => ({ lo: base + r * step, hi: base + (r + 1) * step, letters: "" }));
    g.idx.forEach((i, j) => {
      const L = LETTERS[j % LETTERS.length];
      for (const row of prof) if ((b.low[i] < row.hi && b.high[i] > row.lo) || (b.low[i] === b.high[i] && b.low[i] >= row.lo && b.low[i] <= row.hi)) row.letters += L;
    });
    const vp = { bins: prof.map((r) => ({ lo: r.lo, hi: r.hi, volume: r.letters.length })), poc: null };
    vp.poc = vp.bins.reduce((m, x) => (x.volume > m.volume ? x : m), vp.bins[0]);
    const va = valueArea(vp);
    return { key: g.key, from: b.time[g.idx[0]], to: b.time[g.idx[g.idx.length - 1]], periods: g.idx.length, rows: prof,
      poc: va?.poc, vah: va?.vah, val: va?.val, singles: prof.filter((r) => r.letters.length === 1).map((r) => [r.lo, r.hi]),
      open: b.open[g.idx[0]], close: b.close[g.idx[g.idx.length - 1]] };
  });
}
function weekKey(t) {
  const d = new Date(`${t}T00:00:00Z`); const day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}
