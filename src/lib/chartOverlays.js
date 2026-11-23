// Turns everything the chart lab can lay on a chart (studies, drawings, custom formulas,
// projections, the seasonal path, anchored VWAP / volume profile) into series specs:
//   { price: [spec], panes: [{ key, title, specs: [spec] }], notes: [string] }
// spec = { type: "line"|"histogram", data, options, priceLines?, markers? }. All maths is in engine/.
import { ichimoku, parabolicSar, supertrend, pivots, vwap, stochastic, adx, atrW, obv, cmf, adLine, volumeOscillator, roc, kst, bollinger, keltner, donchian, cci, williamsR, mfi, aroon, trix, cmo, ultimateOscillator, elderRay, forceIndex, easeOfMovement, chaikinOscillator, ppo, dpo, vortex, massIndex, coppock, stochRsi, momentum, awesomeOscillator, tsi, historicalVolatility, stdDev, linearRegression, envelope, choppiness, ulcerIndex, kama, alligator, chandelierExit, zigzag, fisherTransform, rvi, klinger, pvt, balanceOfPower } from "../../engine/studies.js";
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
  const colored = (vals, dir, k) => { const up = studies[k]?.upColor || "#16a34a", dn = studies[k]?.downColor || "#dc2626"; const d = []; for (let i = 0; i < t.length; i++) if (num(vals[i])) d.push({ time: t[i], value: vals[i], color: dir[i] > 0 ? up : dn }); return d; };
  const on = (k) => studies[k]?.on;
  const P = (k) => studies[k]?.params || {};
  const col = (k, d) => studies[k]?.color || d;
  // every study's Style: line width for all its lines, colour for its main line (first line it draws)
  const style = (k, p0, q0) => {
    const w = +studies[k]?.width, c0 = studies[k]?.color;
    const specs = [...out.price.slice(p0), ...out.panes.slice(q0).flatMap((p) => p.specs)].filter((x) => x.type === "line");
    if (w > 0) for (const x of specs) x.options = { ...x.options, lineWidth: w };
    if (c0 && specs[0] && !["psar", "supertrend", "zigzag"].includes(k)) specs[0].options = { ...specs[0].options, color: c0 };
  };
  // price input ("source") for studies built on one series, as on TradingView
  const SRC = { close: c, open: o || c, high: h, low: l, hl2: h.map((x, i) => (x + l[i]) / 2), hlc3: h.map((x, i) => (x + l[i] + c[i]) / 3), ohlc4: h.map((x, i) => ((o ? o[i] : c[i]) + x + l[i] + c[i]) / 4) };
  const S = (k) => SRC[P(k).source] || c;
  if (on("ichimoku")) { const p0 = out.price.length, q0 = out.panes.length; {
    const ic = ichimoku(h, l, c, { tenkan: +P("ichimoku").tenkan || 9, kijun: +P("ichimoku").kijun || 26, spanB: +P("ichimoku").spanB || 52, shift: Math.max(0, Math.round(+P("ichimoku").shift || 26)) });
    const ext = [...t]; for (let k = 1; k <= ic.shift; k++) ext.push(addSessions(t[t.length - 1], k, tf));
    out.price.push(line(L(t, ic.tenkan), "#38bdf8", { title: "Tenkan" }), line(L(t, ic.kijun), "#f43f5e", { title: "Kijun" }),
      line(L(ext, ic.spanA, ext.length), "#22c55e", { title: "Span A" }), line(L(ext, ic.spanB, ext.length), "#ef4444", { title: "Span B" }),
      line(L(t, ic.chikou), "#a3a3a3", { title: "Chikou", lineStyle: 2 }));
    out.notes.push(`Ichimoku: cloud = Span A (green) / Span B (red), drawn ${ic.shift} candles ahead; Chikou = close drawn ${ic.shift} back.`);
  } style("ichimoku", p0, q0); }
  if (on("psar")) { const p0 = out.price.length, q0 = out.panes.length; {
    const p = parabolicSar(h, l, +P("psar").step || 0.02, +P("psar").max || 0.2);
    out.price.push({ type: "line", data: colored(p.sar, p.dir, "psar"), options: { lineWidth: 1, lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 1.5, lastValueVisible: false, priceLineVisible: false, title: "SAR" } });
  } style("psar", p0, q0); }
  if (on("supertrend")) { const p0 = out.price.length, q0 = out.panes.length; {
    const s = supertrend(h, l, c, +P("supertrend").n || 10, +P("supertrend").m || 3);
    out.price.push({ type: "line", data: colored(s.line, s.dir, "supertrend"), options: { lineWidth: 2, lastValueVisible: false, priceLineVisible: false, title: "Supertrend" } });
  } style("supertrend", p0, q0); }
  if (on("pivots")) { const p0 = out.price.length, q0 = out.panes.length; {
    const pv = pivots(h, l, c, o, P("pivots").kind || "standard").at(-1);
    if (pv) out.levels.push(...Object.entries(pv).map(([k, val]) => ({ price: val, color: k === "P" ? "#e5e7eb" : k.startsWith("R") ? "#f87171" : "#4ade80", title: `${k} ${val.toFixed(2)}` })));
    out.notes.push(`Pivot points (${P("pivots").kind || "standard"}) for the next candle, from the last completed one.`);
  } style("pivots", p0, q0); }
  if (on("vwap")) { const p0 = out.price.length, q0 = out.panes.length; { const w = vwap(t, h, l, c, v, { session: P("vwap").session && P("vwap").session !== "Auto" ? P("vwap").session : tf === "D" ? "M" : "Y" }); out.price.push(line(L(t, w.vwap), col("vwap", "#f59e0b"), { title: "VWAP", lineWidth: 2 })); } style("vwap", p0, q0); }
  // price-pane channels; every number comes from the study's own boxes
  const N = (k, f, d) => { const x = +P(k)[f]; return P(k)[f] !== "" && P(k)[f] != null && Number.isFinite(x) ? x : d; };
  if (on("bb")) { const p0 = out.price.length, q0 = out.panes.length; { const x = bollinger(S("bb"), N("bb", "n", 20), N("bb", "k", 2)); out.price.push(line(L(t, x.upper), col("bb", "#a78bfa"), { title: "BB upper" }), line(L(t, x.mid), col("bb", "#a78bfa"), { title: "BB mid", lineStyle: 2 }), line(L(t, x.lower), col("bb", "#a78bfa"), { title: "BB lower" })); } style("bb", p0, q0); }
  if (on("keltner")) { const p0 = out.price.length, q0 = out.panes.length; { const x = keltner(h, l, c, N("keltner", "n", 20), N("keltner", "atr", 10), N("keltner", "mult", 2)); out.price.push(line(L(t, x.upper), col("keltner", "#f472b6"), { title: "KC upper" }), line(L(t, x.mid), col("keltner", "#f472b6"), { title: "KC mid", lineStyle: 2 }), line(L(t, x.lower), col("keltner", "#f472b6"), { title: "KC lower" })); } style("keltner", p0, q0); }
  if (on("donchian")) { const p0 = out.price.length, q0 = out.panes.length; { const x = donchian(h, l, N("donchian", "n", 20)); out.price.push(line(L(t, x.upper), col("donchian", "#2dd4bf"), { title: "DC upper" }), line(L(t, x.mid), col("donchian", "#2dd4bf"), { title: "DC mid", lineStyle: 2 }), line(L(t, x.lower), col("donchian", "#2dd4bf"), { title: "DC lower" })); } style("donchian", p0, q0); }
  // a colour picked for the study recolours its main line
  const pane = (key, title, specs, sk = key) => {
    const c0 = studies[sk]?.color, s0 = c0 && specs.find((x) => x.type === "line");
    if (s0) s0.options = { ...s0.options, color: c0 };
    out.panes.push({ key, title, specs });
  };
  const lv = (k, hi, lo) => [{ price: N(k, "hi", hi), color: "#dc2626" }, { price: N(k, "lo", lo), color: "#16a34a" }];
  const zero = [{ price: 0, color: "#6b7280" }];
  const hist = (vals, title) => ({ type: "histogram", data: L(t, vals).map((x) => ({ ...x, color: x.value >= 0 ? "#16a34a" : "#dc2626" })), options: { title } });
  const main = (vals, color, title, priceLines) => ({ ...line(L(t, vals), color, { title, lineWidth: 2 }), ...(priceLines ? { priceLines } : {}) });
  if (on("bbpct")) { const p0 = out.price.length, q0 = out.panes.length; { const x = bollinger(S("bbpct"), N("bbpct", "n", 20), N("bbpct", "k", 2)); pane("bbpct", "Bollinger %B", [main(x.pctB, "#a78bfa", "%B", [{ price: 1, color: "#dc2626" }, { price: 0, color: "#16a34a" }])]); pane("bbw", "Bollinger bandwidth %", [main(x.width, "#a78bfa", "Width %")]); } style("bbpct", p0, q0); }
  if (on("cci")) { const p0 = out.price.length, q0 = out.panes.length; pane("cci", "CCI", [main(cci(h, l, c, N("cci", "n", 20), N("cci", "constant", 0.015)), "#38bdf8", "CCI", lv("cci", 100, -100))]); style("cci", p0, q0); }
  if (on("willr")) { const p0 = out.price.length, q0 = out.panes.length; pane("willr", "Williams %R", [main(williamsR(h, l, c, N("willr", "n", 14)), "#38bdf8", "%R", lv("willr", -20, -80))]); style("willr", p0, q0); }
  if (on("mfi")) { const p0 = out.price.length, q0 = out.panes.length; pane("mfi", "MFI", [main(mfi(h, l, c, v, N("mfi", "n", 14)), "#f59e0b", "MFI", lv("mfi", 80, 20))]); style("mfi", p0, q0); }
  if (on("aroon")) { const p0 = out.price.length, q0 = out.panes.length; { const x = aroon(h, l, N("aroon", "n", 25)); pane("aroon", "Aroon", [main(x.up, "#16a34a", "Up"), line(L(t, x.down), "#dc2626", { title: "Down", lineWidth: 2 })]); pane("aroonOsc", "Aroon oscillator", [main(x.osc, "#38bdf8", "Osc", zero)]); } style("aroon", p0, q0); }
  if (on("trix")) { const p0 = out.price.length, q0 = out.panes.length; { const x = trix(S("trix"), N("trix", "n", 15), N("trix", "signal", 9)); pane("trix", "TRIX", [main(x.trix, "#38bdf8", "TRIX", zero), line(L(t, x.signal), "#f59e0b", { title: "Signal" })]); } style("trix", p0, q0); }
  if (on("cmo")) { const p0 = out.price.length, q0 = out.panes.length; pane("cmo", "CMO", [main(cmo(S("cmo"), N("cmo", "n", 9)), "#38bdf8", "CMO", lv("cmo", 50, -50))]); style("cmo", p0, q0); }
  if (on("uo")) { const p0 = out.price.length, q0 = out.panes.length; pane("uo", "Ultimate Oscillator", [main(ultimateOscillator(h, l, c, N("uo", "short", 7), N("uo", "mid", 14), N("uo", "long", 28), N("uo", "wShort", 4), N("uo", "wMid", 2), N("uo", "wLong", 1)), "#38bdf8", "UO", lv("uo", 70, 30))]); style("uo", p0, q0); }
  if (on("elder")) { const p0 = out.price.length, q0 = out.panes.length; { const x = elderRay(h, l, c, N("elder", "n", 13)); pane("elderBull", "Elder Ray bull power", [hist(x.bull, "Bull")]); pane("elderBear", "Elder Ray bear power", [hist(x.bear, "Bear")]); } style("elder", p0, q0); }
  if (on("force")) { const p0 = out.price.length, q0 = out.panes.length; pane("force", "Force Index", [hist(forceIndex(c, v, N("force", "n", 13)), "Force")]); style("force", p0, q0); }
  if (on("eom")) { const p0 = out.price.length, q0 = out.panes.length; pane("eom", "Ease of Movement", [main(easeOfMovement(h, l, v, N("eom", "n", 14), N("eom", "scale", 1e8)), "#38bdf8", "EOM", zero)]); style("eom", p0, q0); }
  if (on("chaikinOsc")) { const p0 = out.price.length, q0 = out.panes.length; pane("chaikinOsc", "Chaikin Oscillator", [hist(chaikinOscillator(h, l, c, v, N("chaikinOsc", "fast", 3), N("chaikinOsc", "slow", 10)), "Chaikin")]); style("chaikinOsc", p0, q0); }
  if (on("ppo")) { const p0 = out.price.length, q0 = out.panes.length; { const x = ppo(S("ppo"), N("ppo", "fast", 12), N("ppo", "slow", 26), N("ppo", "signal", 9)); pane("ppo", "PPO", [hist(x.hist, "Hist"), main(x.ppo, "#14a44d", "PPO"), line(L(t, x.signal), "#d97706", { title: "Signal" })]); } style("ppo", p0, q0); }
  if (on("dpo")) { const p0 = out.price.length, q0 = out.panes.length; pane("dpo", "DPO", [main(dpo(S("dpo"), N("dpo", "n", 20), !!N("dpo", "centered", 0)), "#38bdf8", "DPO", zero)]); style("dpo", p0, q0); }
  if (on("vortex")) { const p0 = out.price.length, q0 = out.panes.length; { const x = vortex(h, l, c, N("vortex", "n", 14)); pane("vortex", "Vortex", [main(x.plus, "#16a34a", "VI+"), line(L(t, x.minus), "#dc2626", { title: "VI-", lineWidth: 2 })]); } style("vortex", p0, q0); }
  if (on("mass")) { const p0 = out.price.length, q0 = out.panes.length; pane("mass", "Mass Index", [main(massIndex(h, l, N("mass", "n", 9), N("mass", "sum", 25)), "#38bdf8", "Mass", [{ price: N("mass", "bulge", 27), color: "#dc2626" }, { price: N("mass", "trigger", 26.5), color: "#f59e0b" }])]); style("mass", p0, q0); }
  if (on("coppock")) { const p0 = out.price.length, q0 = out.panes.length; pane("coppock", "Coppock Curve", [hist(coppock(S("coppock"), N("coppock", "roc1", 14), N("coppock", "roc2", 11), N("coppock", "wma", 10)), "Coppock")]); style("coppock", p0, q0); }
  if (on("stoch")) { const p0 = out.price.length, q0 = out.panes.length; {
    const s = stochastic(h, l, c, N("stoch", "k", 14), N("stoch", "d", 3), N("stoch", "smooth", 3));
    pane("stoch", "Stochastic slow", [main(s.slowK, "#38bdf8", "%K", lv("stoch", 80, 20)), line(L(t, s.slowD), "#f59e0b", { title: "%D" })]);
  } style("stoch", p0, q0); }
  if (on("stochFast")) { const p0 = out.price.length, q0 = out.panes.length; {
    const s = stochastic(h, l, c, N("stochFast", "k", 14), N("stochFast", "d", 3), 1);
    pane("stochFast", "Stochastic fast", [main(s.fastK, "#38bdf8", "%K", lv("stochFast", 80, 20)), line(L(t, s.fastD), "#f59e0b", { title: "%D" })]);
  } style("stochFast", p0, q0); }
  if (on("adx")) { const p0 = out.price.length, q0 = out.panes.length; { const a = adx(h, l, c, N("adx", "n", 14)); pane("adx", "ADX", [main(a.adx, "#e5e7eb", "ADX", [{ price: N("adx", "level", 25), color: "#6b7280" }]), line(L(t, a.plusDI), "#16a34a", { title: "+DI" }), line(L(t, a.minusDI), "#dc2626", { title: "-DI" })]); } style("adx", p0, q0); }
  if (on("atr")) { const p0 = out.price.length, q0 = out.panes.length; pane("atr", "ATR", [line(L(t, atrW(h, l, c, +P("atr").n || 14)), "#a78bfa", { title: "ATR", lineWidth: 2 })]); style("atr", p0, q0); }
  if (on("roc")) { const p0 = out.price.length, q0 = out.panes.length; pane("roc", "ROC", [{ ...line(L(t, roc(S("roc"), +P("roc").n || 12)), "#22d3ee", { title: "ROC %", lineWidth: 2 }), priceLines: [{ price: 0, color: "#6b7280" }] }]); style("roc", p0, q0); }
  if (on("kst")) { const p0 = out.price.length, q0 = out.panes.length; { const k = kst(S("kst"), P("kst")); pane("kst", "KST", [{ ...line(L(t, k.kst), "#22d3ee", { title: "KST", lineWidth: 2 }), priceLines: [{ price: 0, color: "#6b7280" }] }, line(L(t, k.signal), "#f59e0b", { title: "Signal" })]); } style("kst", p0, q0); }
  if (on("obv")) { const p0 = out.price.length, q0 = out.panes.length; pane("obv", "OBV", [line(L(t, obv(c, v)), "#38bdf8", { title: "OBV", lineWidth: 2, priceFormat: { type: "volume" } })]); style("obv", p0, q0); }
  if (on("cmf")) { const p0 = out.price.length, q0 = out.panes.length; pane("cmf", "CMF", [{ type: "histogram", data: L(t, cmf(h, l, c, v, +P("cmf").n || 20)).map((x) => ({ ...x, color: x.value >= 0 ? "#16a34a" : "#dc2626" })), options: { title: "CMF" } }]); style("cmf", p0, q0); }
  if (on("ad")) { const p0 = out.price.length, q0 = out.panes.length; pane("ad", "A/D line", [line(L(t, adLine(h, l, c, v)), "#f59e0b", { title: "A/D", lineWidth: 2, priceFormat: { type: "volume" } })]); style("ad", p0, q0); }
  if (on("volosc")) { const p0 = out.price.length, q0 = out.panes.length; pane("volosc", "Volume oscillator", [{ type: "histogram", data: L(t, volumeOscillator(v, +P("volosc").fast || 5, +P("volosc").slow || 10)).map((x) => ({ ...x, color: x.value >= 0 ? "#16a34a" : "#dc2626" })), options: { title: "Vol osc %" } }]); style("volosc", p0, q0); }
  if (on("envelope")) { const p0 = out.price.length, q0 = out.panes.length; { const x = envelope(S("envelope"), N("envelope", "n", 20), N("envelope", "pct", 2.5), P("envelope").kind || "SMA"); out.price.push(line(L(t, x.upper), col("envelope", "#fb923c"), { title: "Env upper" }), line(L(t, x.mid), col("envelope", "#fb923c"), { title: "Env mid", lineStyle: 2 }), line(L(t, x.lower), col("envelope", "#fb923c"), { title: "Env lower" })); } style("envelope", p0, q0); }
  if (on("linreg")) { const p0 = out.price.length, q0 = out.panes.length; { const x = linearRegression(S("linreg"), N("linreg", "n", 50)); out.price.push(line(L(t, x.value), col("linreg", "#e879f9"), { title: "Lin reg", lineWidth: 2 })); } style("linreg", p0, q0); }
  if (on("stochRsi")) { const p0 = out.price.length, q0 = out.panes.length; { const x = stochRsi(S("stochRsi"), N("stochRsi", "rsi", 14), N("stochRsi", "n", 14), N("stochRsi", "k", 3), N("stochRsi", "d", 3)); pane("stochRsi", "Stochastic RSI", [main(x.k, "#38bdf8", "%K", lv("stochRsi", 80, 20)), line(L(t, x.d), "#f59e0b", { title: "%D" })]); } style("stochRsi", p0, q0); }
  if (on("momentum")) { const p0 = out.price.length, q0 = out.panes.length; pane("momentum", "Momentum", [main(momentum(S("momentum"), N("momentum", "n", 10)), "#22d3ee", "Mom", zero)]); style("momentum", p0, q0); }
  if (on("ao")) { const p0 = out.price.length, q0 = out.panes.length; pane("ao", "Awesome Oscillator", [hist(awesomeOscillator(h, l, N("ao", "fast", 5), N("ao", "slow", 34)), "AO")]); style("ao", p0, q0); }
  if (on("tsi")) { const p0 = out.price.length, q0 = out.panes.length; { const x = tsi(S("tsi"), N("tsi", "long", 25), N("tsi", "short", 13), N("tsi", "signal", 13)); pane("tsi", "TSI", [main(x.tsi, "#38bdf8", "TSI", [...lv("tsi", 25, -25), ...zero]), line(L(t, x.signal), "#f59e0b", { title: "Signal" })]); } style("tsi", p0, q0); }
  if (on("hv")) { const p0 = out.price.length, q0 = out.panes.length; pane("hv", "Historical volatility %", [main(historicalVolatility(S("hv"), N("hv", "n", 20), { D: 252, W: 52, M: 12, Q: 4, Y: 1 }[tf] || 252), "#a78bfa", "HV %")]); style("hv", p0, q0); }
  if (on("stddev")) { const p0 = out.price.length, q0 = out.panes.length; pane("stddev", "Standard deviation", [main(stdDev(S("stddev"), N("stddev", "n", 20)), "#a78bfa", "StdDev")]); style("stddev", p0, q0); }
  if (on("lrslope")) { const p0 = out.price.length, q0 = out.panes.length; { const x = linearRegression(S("lrslope"), N("lrslope", "n", 50)); pane("lrslope", "Linear regression slope", [main(x.slope, "#e879f9", "Slope", zero)]); pane("lrr2", "Linear regression R²", [main(x.r2, "#94a3b8", "R²")], "lrslope"); } style("lrslope", p0, q0); }
  if (on("chop")) { const p0 = out.price.length, q0 = out.panes.length; pane("chop", "Choppiness Index", [main(choppiness(h, l, c, N("chop", "n", 14)), "#38bdf8", "CHOP", lv("chop", 61.8, 38.2))]); style("chop", p0, q0); }
  if (on("ulcer")) { const p0 = out.price.length, q0 = out.panes.length; pane("ulcer", "Ulcer Index", [main(ulcerIndex(S("ulcer"), N("ulcer", "n", 14)), "#f87171", "Ulcer")]); style("ulcer", p0, q0); }
  if (on("kama")) { const p0 = out.price.length, q0 = out.panes.length; out.price.push(line(L(t, kama(S("kama"), N("kama", "n", 10), N("kama", "fast", 2), N("kama", "slow", 30))), "#fbbf24", { title: "KAMA", lineWidth: 2 })); style("kama", p0, q0); }
  if (on("alligator")) {
    const p0 = out.price.length, q0 = out.panes.length;
    const a = alligator(h, l, { jaw: N("alligator", "jaw", 13), jawShift: N("alligator", "jawShift", 8), teeth: N("alligator", "teeth", 8), teethShift: N("alligator", "teethShift", 5), lips: N("alligator", "lips", 5), lipsShift: N("alligator", "lipsShift", 3) });
    const fwd = (vals, k) => { const ext = [...t]; for (let j = 1; j <= k; j++) ext.push(addSessions(t[t.length - 1], j, tf)); const sh = new Array(k).fill(null).concat(vals); return L(ext, sh, ext.length); };
    out.price.push(line(fwd(a.jaw, a.shifts.jaw), "#3b82f6", { title: "Jaw", lineWidth: 2 }), line(fwd(a.teeth, a.shifts.teeth), "#ef4444", { title: "Teeth", lineWidth: 2 }), line(fwd(a.lips, a.shifts.lips), "#22c55e", { title: "Lips", lineWidth: 2 }));
    style("alligator", p0, q0);
  }
  if (on("chandelier")) { const p0 = out.price.length, q0 = out.panes.length; const x = chandelierExit(h, l, c, N("chandelier", "n", 22), N("chandelier", "mult", 3)); out.price.push(line(L(t, x.long), "#16a34a", { title: "CE long stop" }), line(L(t, x.short), "#dc2626", { title: "CE short stop" })); style("chandelier", p0, q0); }
  if (on("zigzag")) {
    const p0 = out.price.length, q0 = out.panes.length;
    const pts = zigzag(h, l, N("zigzag", "pct", 5));
    out.price.push(line(pts.map((x) => ({ time: t[x.i], value: x.price })), col("zigzag", "#e5e7eb"), { title: "ZigZag", lineWidth: 2 }));
    out.notes.push("ZigZag: the last leg is provisional and moves until price reverses by the set percent.");
    style("zigzag", p0, q0);
  }
  if (on("fisher")) { const p0 = out.price.length, q0 = out.panes.length; const x = fisherTransform(h, l, N("fisher", "n", 9)); pane("fisher", "Fisher Transform", [main(x.fisher, "#38bdf8", "Fisher", [...lv("fisher", 1.5, -1.5), ...zero]), line(L(t, x.trigger), "#f59e0b", { title: "Trigger" })]); style("fisher", p0, q0); }
  if (on("rvi")) { const p0 = out.price.length, q0 = out.panes.length; const x = rvi(o || c, h, l, c, N("rvi", "n", 10)); pane("rvi", "RVI", [main(x.rvi, "#22c55e", "RVI", zero), line(L(t, x.signal), "#ef4444", { title: "Signal" })]); style("rvi", p0, q0); }
  if (on("klinger")) { const p0 = out.price.length, q0 = out.panes.length; const x = klinger(h, l, c, v, N("klinger", "fast", 34), N("klinger", "slow", 55), N("klinger", "signal", 13)); pane("klinger", "Klinger Oscillator", [main(x.kvo, "#38bdf8", "KVO", zero), line(L(t, x.signal), "#f59e0b", { title: "Signal" })]); style("klinger", p0, q0); }
  if (on("pvt")) { const p0 = out.price.length, q0 = out.panes.length; pane("pvt", "Price Volume Trend", [line(L(t, pvt(c, v)), "#a78bfa", { title: "PVT", lineWidth: 2, priceFormat: { type: "volume" } })]); style("pvt", p0, q0); }
  if (on("bop")) { const p0 = out.price.length, q0 = out.panes.length; pane("bop", "Balance of Power", [hist(balanceOfPower(o || c, h, l, c, N("bop", "n", 14)), "BOP")]); style("bop", p0, q0); }
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
