// Turns everything the chart lab can lay on a chart (studies, drawings, custom formulas,
// projections, the seasonal path, anchored VWAP / volume profile) into series specs:
//   { price: [spec], panes: [{ key, title, specs: [spec] }], notes: [string] }
// spec = { type: "line"|"histogram", data, options, priceLines?, markers? }. All maths is in engine/.
import { ichimoku, parabolicSar, supertrend, pivots, vwap, stochastic, adx, atrW, obv, cmf, adLine, volumeOscillator, roc } from "../../engine/studies.js";
import { geometry } from "../../engine/drawings.js";
import { evalFormula, isCondition } from "../../engine/formula.js";
import { computeProjection } from "../../engine/projection.js";
import { volumeProfile, valueArea } from "../../engine/chartTools.js";
import { addSessions } from "../../engine/projection.js";

const num = (v) => typeof v === "number" && Number.isFinite(v);
const L = (time, vals, n = time.length) => { const out = []; for (let i = 0; i < n; i++) if (num(vals[i])) out.push({ time: time[i], value: vals[i] }); return out; };
const line = (data, color, extra = {}) => ({ type: "line", data, options: { color, lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false, ...extra } });

/** Index of the candle at or before a date. */
export function indexAt(time, t) {
  let lo = 0, hi = time.length - 1, k = 0;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (time[m] <= t) { k = m; lo = m + 1; } else hi = m - 1; }
  return k;
}

export function studyOverlays(b, studies = {}, tf = "D") {
  const out = { price: [], panes: [], notes: [], levels: [] };
  const t = b.time, { high: h, low: l, close: c, open: o } = b, v = b.volume || c.map(() => 0);
  const colored = (vals, dir) => { const d = []; for (let i = 0; i < t.length; i++) if (num(vals[i])) d.push({ time: t[i], value: vals[i], color: dir[i] > 0 ? "#16a34a" : "#dc2626" }); return d; };
  const on = (k) => studies[k]?.on;
  const P = (k) => studies[k]?.params || {};
  const col = (k, d) => studies[k]?.color || d;
  if (on("ichimoku")) {
    const ic = ichimoku(h, l, c, { tenkan: +P("ichimoku").tenkan || 9, kijun: +P("ichimoku").kijun || 26, spanB: +P("ichimoku").spanB || 52 });
    const ext = [...t]; for (let k = 1; k <= ic.shift; k++) ext.push(addSessions(t[t.length - 1], k, tf));
    out.price.push(line(L(t, ic.tenkan), "#38bdf8", { title: "Tenkan" }), line(L(t, ic.kijun), "#f43f5e", { title: "Kijun" }),
      line(L(ext, ic.spanA, ext.length), "#22c55e", { title: "Span A" }), line(L(ext, ic.spanB, ext.length), "#ef4444", { title: "Span B" }),
      line(L(t, ic.chikou), "#a3a3a3", { title: "Chikou", lineStyle: 2 }));
    out.notes.push("Ichimoku: cloud = Span A (green) / Span B (red), drawn 26 candles ahead; Chikou = close drawn 26 back.");
  }
  if (on("psar")) {
    const p = parabolicSar(h, l, +P("psar").step || 0.02, +P("psar").max || 0.2);
    out.price.push({ type: "line", data: colored(p.sar, p.dir), options: { lineWidth: 1, lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 1.5, lastValueVisible: false, priceLineVisible: false, title: "SAR" } });
  }
  if (on("supertrend")) {
    const s = supertrend(h, l, c, +P("supertrend").n || 10, +P("supertrend").m || 3);
    out.price.push({ type: "line", data: colored(s.line, s.dir), options: { lineWidth: 2, lastValueVisible: false, priceLineVisible: false, title: "Supertrend" } });
  }
  if (on("pivots")) {
    const pv = pivots(h, l, c, o, P("pivots").kind || "standard").at(-1);
    if (pv) out.levels.push(...Object.entries(pv).map(([k, val]) => ({ price: val, color: k === "P" ? "#e5e7eb" : k.startsWith("R") ? "#f87171" : "#4ade80", title: `${k} ${val.toFixed(2)}` })));
    out.notes.push(`Pivot points (${P("pivots").kind || "standard"}) for the next candle, from the last completed one.`);
  }
  if (on("vwap")) { const w = vwap(t, h, l, c, v, { session: tf === "D" ? "M" : "Y" }); out.price.push(line(L(t, w.vwap), col("vwap", "#f59e0b"), { title: "VWAP", lineWidth: 2 })); }
  const pane = (key, title, specs) => out.panes.push({ key, title, specs });
  if (on("stoch") || on("stochFast")) {
    const s = stochastic(h, l, c, +P("stoch").k || 14, +P("stoch").d || 3, +P("stoch").smooth || 3);
    const lv = [{ price: 80, color: "#dc2626" }, { price: 20, color: "#16a34a" }];
    if (on("stoch")) pane("stoch", "Stochastic slow", [{ ...line(L(t, s.slowK), "#38bdf8", { title: "%K", lineWidth: 2 }), priceLines: lv }, line(L(t, s.slowD), "#f59e0b", { title: "%D" })]);
    if (on("stochFast")) pane("stochFast", "Stochastic fast", [{ ...line(L(t, s.fastK), "#38bdf8", { title: "%K", lineWidth: 2 }), priceLines: lv }, line(L(t, s.fastD), "#f59e0b", { title: "%D" })]);
  }
  if (on("adx")) { const a = adx(h, l, c, +P("adx").n || 14); pane("adx", "ADX", [{ ...line(L(t, a.adx), "#e5e7eb", { title: "ADX", lineWidth: 2 }), priceLines: [{ price: 25, color: "#6b7280" }] }, line(L(t, a.plusDI), "#16a34a", { title: "+DI" }), line(L(t, a.minusDI), "#dc2626", { title: "-DI" })]); }
  if (on("atr")) pane("atr", "ATR", [line(L(t, atrW(h, l, c, +P("atr").n || 14)), "#a78bfa", { title: "ATR", lineWidth: 2 })]);
  if (on("roc")) pane("roc", "ROC", [{ ...line(L(t, roc(c, +P("roc").n || 12)), "#22d3ee", { title: "ROC %", lineWidth: 2 }), priceLines: [{ price: 0, color: "#6b7280" }] }]);
  if (on("obv")) pane("obv", "OBV", [line(L(t, obv(c, v)), "#38bdf8", { title: "OBV", lineWidth: 2, priceFormat: { type: "volume" } })]);
  if (on("cmf")) pane("cmf", "CMF", [{ type: "histogram", data: L(t, cmf(h, l, c, v, +P("cmf").n || 20)).map((x) => ({ ...x, color: x.value >= 0 ? "#16a34a" : "#dc2626" })), options: { title: "CMF" } }]);
  if (on("ad")) pane("ad", "A/D line", [line(L(t, adLine(h, l, c, v)), "#f59e0b", { title: "A/D", lineWidth: 2, priceFormat: { type: "volume" } })]);
  if (on("volosc")) pane("volosc", "Volume oscillator", [{ type: "histogram", data: L(t, volumeOscillator(v, +P("volosc").fast || 5, +P("volosc").slow || 10)).map((x) => ({ ...x, color: x.value >= 0 ? "#16a34a" : "#dc2626" })), options: { title: "Vol osc %" } }]);
  return out;
}

/** Drawings (stored with dates) -> series specs; the anchored VWAP / profile tools too. */
export function drawingOverlays(b, drawings = []) {
  const out = { price: [], markers: [], levels: [], notes: [] };
  const t = b.time, last = t.length - 1;
  const at = (p) => (p ? { i: indexAt(t, p.time), price: p.price } : null);
  const tAt = (i) => (i <= last ? t[Math.max(0, Math.round(i))] : null);
  for (const dw of drawings) {
    if (dw.hidden) continue;
    if (dw.type === "avwap") {
      const k = indexAt(t, dw.a.time);
      const w = vwap(t, b.high, b.low, b.close, b.volume || t.map(() => 0), { anchor: k, bands: [1, 2] });
      out.price.push(line(L(t, w.vwap), "#f59e0b", { lineWidth: 2, title: "AVWAP" }));
      w.upper.forEach((u, j) => { out.price.push(line(L(t, u), "#f59e0b", { lineStyle: 2, title: `+${w.bands[j]}σ` })); out.price.push(line(L(t, w.lower[j]), "#f59e0b", { lineStyle: 2, title: `-${w.bands[j]}σ` })); });
      out.markers.push({ time: t[k], position: "belowBar", shape: "arrowUp", color: "#f59e0b", text: "AVWAP" });
      continue;
    }
    if (dw.type === "avp") {
      const k = indexAt(t, dw.a.time);
      const vp = volumeProfile(b, { bins: 30, from: k }), va = valueArea(vp);
      if (va) out.levels.push({ price: va.poc, color: "#f59e0b", title: "POC" }, { price: va.vah, color: "#38bdf8", title: "VAH" }, { price: va.val, color: "#38bdf8", title: "VAL" });
      out.markers.push({ time: t[k], position: "belowBar", shape: "arrowUp", color: "#38bdf8", text: "profile from here" });
      if (va) out.notes.push(`Anchored volume profile from ${t[k]}: POC ${va.poc.toFixed(2)}, value area ${va.val.toFixed(2)} – ${va.vah.toFixed(2)}`);
      continue;
    }
    if (["trend", "hline", "channel", "note", "callout"].includes(dw.type)) continue; // drawn by the chart lab itself
    const g = geometry({ ...dw, a: at(dw.a), b: at(dw.b), c: at(dw.c) }, last);
    for (const ln of g.lines) {
      const data = [];
      for (const [i, p] of ln.pts) { const tm = tAt(i); if (tm && (!data.length || tm > data[data.length - 1].time)) data.push({ time: tm, value: p }); }
      if (data.length >= 2) out.price.push(line(data, ln.color, { lineStyle: ln.dash ? 2 : 0, title: ln.title || "" }));
    }
    for (const m of g.marks) { const tm = tAt(m.i); if (tm) out.markers.push({ time: tm, position: "aboveBar", shape: "square", color: "#facc15", text: m.text }); }
    if (g.info) out.notes.push(g.info);
  }
  return out;
}

/** Custom formula indicators: a value formula draws a line (on the price or its own pane); a condition marks the candles where it holds. */
export function formulaOverlays(b, list = []) {
  const out = { price: [], panes: [], markers: [], errors: [] };
  for (const f of list) {
    if (!f.on) continue;
    let vals;
    try { vals = evalFormula(f.formula, b); } catch (e) { out.errors.push(`${f.name}: ${e.message}`); continue; }
    if (isCondition(f.formula)) {
      for (let i = 1; i < vals.length; i++) if (vals[i] === 1 && vals[i - 1] !== 1) out.markers.push({ time: b.time[i], position: "belowBar", shape: "arrowUp", color: f.color || "#22d3ee", text: f.name });
    } else if (f.pane === "price") out.price.push(line(L(b.time, vals), f.color || "#22d3ee", { lineWidth: 2, title: f.name }));
    else out.panes.push({ key: `f:${f.id}`, title: f.name, specs: [line(L(b.time, vals), f.color || "#22d3ee", { lineWidth: 2, title: f.name })] });
  }
  return out;
}

const STATUS_COLOR = { pending: "#9ca3af", active: "#3b82f6", reached: "#16a34a", invalidated: "#dc2626", error: "#9ca3af" };
/** Projections -> a solid line over elapsed candles and a dashed one into the future. */
export function projectionOverlays(b, list = [], tf = "D") {
  const out = { price: [], levels: [], results: [] };
  for (const p of list) {
    if (p.hidden) continue;
    const r = computeProjection(b, p, tf);
    out.results.push({ id: p.id, ...r });
    if (!r.path) continue;
    if (r.status === "invalidated" && p.onInvalid === "remove") continue;
    const color = p.color || STATUS_COLOR[r.status];
    const past = r.path.filter((x) => !x.future).map(({ time, value }) => ({ time, value }));
    const fut = r.path.filter((x, i, all) => x.future || (i + 1 < all.length && all[i + 1].future)).map(({ time, value }) => ({ time, value }));
    if (past.length >= 2) out.price.push(line(past, color, { lineWidth: 2, title: "" }));
    if (fut.length >= 2) out.price.push(line(fut, color, { lineWidth: 2, lineStyle: 2, title: `${p.name || "projection"} ${r.target.toFixed(2)}` }));
    if (r.invalidation != null && r.status !== "reached") out.levels.push({ price: r.invalidation, color: STATUS_COLOR.invalidated, title: `invalidation ${p.name || ""}` });
  }
  return out;
}
