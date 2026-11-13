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
