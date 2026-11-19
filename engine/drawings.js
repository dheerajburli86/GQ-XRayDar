// Chart drawing geometry (owner's additional feature list, item 2): Fibonacci retracement,
// extension, fan, arcs and time zones, Andrews pitchfork (standard, Schiff, modified Schiff),
// Gann fan and grid, risk / reward box and the price / percent / bar range measure.
// Points are {i, price} in bar-index space (i = candle number); the chart turns i into a date.
// Every function returns { lines: [{pts:[[i, price], ...], color, title, dash}], levels:
// [{price, color, title}], marks: [{i, text}], info } and never draws past `last` (the last bar):
// lines that run "to the right" stop at the latest candle.

export const FIB_RETRACE = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
export const FIB_EXT = [0.618, 1, 1.272, 1.618, 2, 2.618];
export const FIB_FAN = [0.382, 0.5, 0.618];
export const FIB_TIME = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144];
export const GANN = [[1, 8], [1, 4], [1, 3], [1, 2], [1, 1], [2, 1], [3, 1], [4, 1], [8, 1]]; // time x price

const C = { fib: "#38bdf8", ext: "#a78bfa", fork: "#f59e0b", gann: "#22c55e", rr: { stop: "#dc2626", target: "#16a34a", entry: "#e5e7eb" }, measure: "#facc15" };
const pct = (x) => `${(x * 100).toFixed(1)}%`;

/** A ray from p through q, cut at bar `last`. */
function ray(p, q, last) {
  if (q.i === p.i) return [[p.i, p.price], [q.i, q.price]];
  const slope = (q.price - p.price) / (q.i - p.i);
  const end = Math.max(q.i, last);
  return [[p.i, p.price], [end, p.price + slope * (end - p.i)]];
}

export function geometry(dw, last) {
  const out = { lines: [], levels: [], marks: [], info: null };
  const [a, b, c] = [dw.a, dw.b, dw.c];
  const right = Math.max(last, a?.i ?? 0, b?.i ?? 0);
  switch (dw.type) {
    case "fib": { // retracement of the move a -> b
      const r = b.price - a.price;
      for (const k of FIB_RETRACE) { const p = b.price - k * r; out.lines.push({ pts: [[Math.min(a.i, b.i), p], [right, p]], color: C.fib, title: `${pct(k)} ${p.toFixed(2)}`, dash: k !== 0 && k !== 1 }); }
      out.info = `Retracement of ${a.price.toFixed(2)} → ${b.price.toFixed(2)}`;
      break;
    }
    case "fibext": { // extension of a -> b projected from c
      if (!c) break;
      const r = b.price - a.price;
      for (const k of FIB_EXT) { const p = c.price + k * r; out.lines.push({ pts: [[c.i, p], [right, p]], color: C.ext, title: `${pct(k)} ${p.toFixed(2)}`, dash: true }); }
      out.lines.push({ pts: [[a.i, a.price], [b.i, b.price], [c.i, c.price]], color: C.ext });
      out.info = `Extension of ${a.price.toFixed(2)} → ${b.price.toFixed(2)} from ${c.price.toFixed(2)}`;
      break;
    }
    case "fibfan": {
      const r = b.price - a.price;
      for (const k of FIB_FAN) out.lines.push({ pts: ray(a, { i: b.i, price: b.price - k * r }, last), color: C.fib, title: pct(k), dash: true });
      out.lines.push({ pts: [[a.i, a.price], [b.i, b.price]], color: C.fib });
      break;
    }
    case "fibarc": { // arcs around b with radii = fib x |a-b|, drawn in bar / price units scaled by the move
      const di = b.i - a.i, dp = b.price - a.price;
      if (!di) break;
      for (const k of [0.382, 0.5, 0.618]) {
        const pts = [];
        for (let s = 0; s <= 24; s++) {
          const th = (Math.PI * s) / 24; // half circle on the far side of b
          const x = b.i + Math.sign(di) * Math.sin(th) * k * Math.abs(di);
          const y = b.price - Math.sign(dp || 1) * Math.cos(th) * k * Math.abs(dp);
          if (x <= right + 0.001) pts.push([x, y]);
        }
        if (pts.length > 1) out.lines.push({ pts: pts.map(([x, y]) => [Math.round(x), y]).filter((p, j, all) => j === 0 || p[0] !== all[j - 1][0]), color: C.fib, title: pct(k) });
      }
      break;
    }
    case "fibtime": { // time zones: Fibonacci counts of the a -> b bar distance from a
      const unit = Math.max(1, Math.abs(b.i - a.i));
      for (const k of FIB_TIME) { const i = a.i + k * unit; if (i <= last) out.marks.push({ i, text: `TZ ${k}` }); }
      break;
    }
    case "pitchfork": case "schiff": case "modschiff": {
      if (!c) break;
      // handle: a (standard), a moved halfway to b in price (Schiff), or halfway in both (modified)
      const h = dw.type === "pitchfork" ? a : dw.type === "schiff" ? { i: a.i, price: (a.price + b.price) / 2 } : { i: (a.i + b.i) / 2, price: (a.price + b.price) / 2 };
      const mid = { i: (b.i + c.i) / 2, price: (b.price + c.price) / 2 };
      const slope = mid.i === h.i ? 0 : (mid.price - h.price) / (mid.i - h.i);
      const at = (p0, i) => p0.price + slope * (i - p0.i);
      out.lines.push({ pts: [[Math.round(h.i), h.price], [right, at(h, right)]], color: C.fork, title: "median" });
      for (const p of [b, c]) out.lines.push({ pts: [[p.i, p.price], [right, at(p, right)]], color: C.fork, dash: true });
      out.lines.push({ pts: [[b.i, b.price], [c.i, c.price]], color: C.fork, dash: true });
      break;
    }
    case "gannfan": { // a = origin; b sets the 1x1 (one price unit per bar)
      const unit = b.i === a.i ? 0 : (b.price - a.price) / (b.i - a.i);
      // t x p: t bars for p price units, so the slope is p / t times the 1x1
      for (const [t, p] of GANN) out.lines.push({ pts: ray(a, { i: a.i + t, price: a.price + unit * p }, last), color: C.gann, title: `${t}x${p}`, dash: !(t === 1 && p === 1) });
      break;
    }
    case "ganngrid": { // 1x1 lines up and down from every multiple of the a -> b span
      const span = Math.max(1, Math.abs(b.i - a.i)), unit = (b.price - a.price) / (b.i - a.i || 1);
      for (let k = 0; a.i + k * span <= last && k < 30; k++) {
        const o = { i: a.i + k * span, price: a.price };
        out.lines.push({ pts: ray(o, { i: o.i + 1, price: o.price + Math.abs(unit) }, last), color: C.gann, dash: true });
        out.lines.push({ pts: ray(o, { i: o.i + 1, price: o.price - Math.abs(unit) }, last), color: C.gann, dash: true });
      }
      break;
    }
    case "rr": { // a = entry, b = stop, c = target
      if (!c) break;
      const risk = Math.abs(a.price - b.price), reward = Math.abs(c.price - a.price);
      const x0 = a.i, x1 = right;
      out.lines.push({ pts: [[x0, a.price], [x1, a.price]], color: C.rr.entry, title: `entry ${a.price.toFixed(2)}` });
      out.lines.push({ pts: [[x0, b.price], [x1, b.price]], color: C.rr.stop, title: `stop ${b.price.toFixed(2)} (${pct(-risk / a.price)})` });
      out.lines.push({ pts: [[x0, c.price], [x1, c.price]], color: C.rr.target, title: `target ${c.price.toFixed(2)} (${pct(reward / a.price)})` });
      out.info = `Reward / risk ${risk > 0 ? (reward / risk).toFixed(2) : "—"} : 1 · risk ${risk.toFixed(2)} · reward ${reward.toFixed(2)}`;
      break;
    }
    case "measure": {
      const d = b.price - a.price;
      out.lines.push({ pts: [[a.i, a.price], [b.i, b.price]], color: C.measure, dash: true });
      out.marks.push({ i: b.i, text: `${d >= 0 ? "+" : ""}${d.toFixed(2)} (${pct(d / a.price)}) · ${Math.abs(b.i - a.i)} bars` });
      out.info = `${d >= 0 ? "+" : ""}${d.toFixed(2)} (${pct(d / a.price)}) over ${Math.abs(b.i - a.i)} bars`;
      break;
    }
    default: break;
  }
  return out;
}

/** Price levels a drawing defines on the latest bar (used to set alerts from a drawing). */
export function alertLevels(dw, last) {
  if (dw.type === "hline") return [{ price: dw.a.price, label: "horizontal line" }];
  const g = geometry(dw, last);
  if (["fib", "fibext", "rr"].includes(dw.type)) return g.lines.filter((l) => l.pts.length === 2 && l.pts[0][1] === l.pts[1][1]).map((l) => ({ price: l.pts[0][1], label: l.title }));
  return [];
}

/** Clicks each drawing type needs. */
export const DRAW_TOOLS = [
  { value: "trend", label: "Trend line", clicks: 2 }, { value: "hline", label: "Horizontal", clicks: 1 }, { value: "channel", label: "Channel", clicks: 3 },
  { value: "fib", label: "Fib retracement", clicks: 2 }, { value: "fibext", label: "Fib extension", clicks: 3 }, { value: "fibfan", label: "Fib fan", clicks: 2 },
  { value: "fibarc", label: "Fib arcs", clicks: 2 }, { value: "fibtime", label: "Fib time zones", clicks: 2 },
  { value: "pitchfork", label: "Pitchfork", clicks: 3 }, { value: "schiff", label: "Schiff pitchfork", clicks: 3 }, { value: "modschiff", label: "Modified Schiff", clicks: 3 },
  { value: "gannfan", label: "Gann fan", clicks: 2 }, { value: "ganngrid", label: "Gann grid", clicks: 2 },
  { value: "rr", label: "Risk / reward", clicks: 3 }, { value: "measure", label: "Measure", clicks: 2 }, { value: "note", label: "Note", clicks: 1 },
  { value: "avwap", label: "Anchored VWAP", clicks: 1 }, { value: "avp", label: "Anchored volume profile", clicks: 1 },
];
