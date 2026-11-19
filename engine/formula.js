// Custom indicators: a small formula language (owner's feature list, item 3, approach 2).
// Example:  ema(close, 10) - ema(close, 30)        cross(close, highest(high, 20))
//           (close - lowest(low, 14)) / (highest(high, 14) - lowest(low, 14)) * 100
//           rsi(close, 14) > 60 and close > ema(close, 50)
// Parsed into a tree and evaluated over whole candle arrays; nothing is passed to eval(), so a
// formula can only use the names listed below. Booleans are 1 / 0; a missing value stays null.
import { sma, ema, rsi } from "./indicators.js";
import { atrW } from "./studies.js";

const num = (v) => typeof v === "number" && Number.isFinite(v);

const SERIES = {
  open: (b) => b.open, high: (b) => b.high, low: (b) => b.low, close: (b) => b.close, volume: (b) => (b.volume || b.close.map(() => 0)),
  // the comparison series chosen on the chart (aligned to the candles), and close / comparison
  // b.rsc: relative strength vs the chart's comparison series, aligned to the candles (one currency)
  rsc: (b) => { if (!b.rsc) throw new Error("rsc needs a comparison series (pick one with 'Compare with')"); return b.rsc; },
  hl2: (b) => b.high.map((h, i) => (h + b.low[i]) / 2), hlc3: (b) => b.high.map((h, i) => (h + b.low[i] + b.close[i]) / 3),
};

const window = (fn) => (x, n) => {
  const k = Math.max(1, Math.round(n)), out = new Array(x.length).fill(null);
  for (let i = k - 1; i < x.length; i++) { const w = x.slice(i - k + 1, i + 1); if (w.every(num)) out[i] = fn(w); }
  return out;
};
const FUNCS = {
  sma: { args: 2, f: (x, n) => sma(x, Math.round(n)), help: "simple average of x over n candles" },
  ema: { args: 2, f: (x, n) => ema(x, Math.round(n)), help: "exponential average of x over n candles" },
  rsi: { args: 2, f: (x, n) => rsi(x, Math.round(n)), help: "RSI of x over n" },
  atr: { args: 1, bars: true, f: (b, n) => atrW(b.high, b.low, b.close, Math.round(n)), help: "average true range over n" },
  highest: { args: 2, f: window((w) => Math.max(...w)), help: "highest x over n" },
  lowest: { args: 2, f: window((w) => Math.min(...w)), help: "lowest x over n" },
  sum: { args: 2, f: window((w) => w.reduce((a, c) => a + c, 0)), help: "sum of x over n" },
  std: { args: 2, f: window((w) => { const m = w.reduce((a, c) => a + c, 0) / w.length; return Math.sqrt(w.reduce((a, c) => a + (c - m) ** 2, 0) / w.length); }), help: "standard deviation of x over n" },
  ref: { args: 2, f: (x, n) => x.map((_, i) => (i - Math.round(n) >= 0 ? x[i - Math.round(n)] : null)), help: "x n candles ago" },
  change: { args: 2, f: (x, n) => x.map((v, i) => (i - Math.round(n) >= 0 && num(v) && num(x[i - Math.round(n)]) ? v - x[i - Math.round(n)] : null)), help: "x minus x n candles ago" },
  roc: { args: 2, f: (x, n) => x.map((v, i) => { const p = x[i - Math.round(n)]; return num(v) && num(p) && p !== 0 ? (v / p - 1) * 100 : null; }), help: "% change of x over n" },
  cross: { args: 2, f: (a, b) => a.map((v, i) => (i && num(v) && num(b[i]) && num(a[i - 1]) && num(b[i - 1]) ? (v > b[i] && a[i - 1] <= b[i - 1] ? 1 : 0) : null)), help: "1 on the candle a crosses above b" },
  crossunder: { args: 2, f: (a, b) => a.map((v, i) => (i && num(v) && num(b[i]) && num(a[i - 1]) && num(b[i - 1]) ? (v < b[i] && a[i - 1] >= b[i - 1] ? 1 : 0) : null)), help: "1 on the candle a crosses below b" },
  abs: { args: 1, f: (x) => x.map((v) => (num(v) ? Math.abs(v) : null)), help: "absolute value" },
  sqrt: { args: 1, f: (x) => x.map((v) => (num(v) && v >= 0 ? Math.sqrt(v) : null)), help: "square root" },
  log: { args: 1, f: (x) => x.map((v) => (num(v) && v > 0 ? Math.log(v) : null)), help: "natural log" },
  max: { args: 2, f: (a, b) => a.map((v, i) => (num(v) && num(b[i]) ? Math.max(v, b[i]) : null)), help: "larger of a and b" },
  min: { args: 2, f: (a, b) => a.map((v, i) => (num(v) && num(b[i]) ? Math.min(v, b[i]) : null)), help: "smaller of a and b" },
};
export const FORMULA_HELP = { series: Object.keys(SERIES), functions: Object.entries(FUNCS).map(([k, v]) => `${k}(${v.bars ? "n" : v.args === 1 ? "x" : k === "cross" || k === "crossunder" || k === "max" || k === "min" ? "a, b" : "x, n"}): ${v.help}`) };

function tokenize(src) {
  const out = [];
  const re = /\s*(?:(\d+\.?\d*|\.\d+)|([A-Za-z_][A-Za-z0-9_]*)|(>=|<=|==|!=|&&|\|\||[-+*/()<>,?:!]))/y;
  let m, pos = 0;
  while (pos < src.length) {
    re.lastIndex = pos;
    m = re.exec(src);
    if (!m) { if (/^\s*$/.test(src.slice(pos))) break; throw new Error(`Cannot read "${src.slice(pos, pos + 12)}"`); }
    pos = re.lastIndex;
    if (m[1]) out.push({ t: "num", v: +m[1] });
    else if (m[2]) { const w = m[2].toLowerCase(); out.push(w === "and" || w === "or" || w === "not" ? { t: "op", v: w } : { t: "id", v: w }); }
    else out.push({ t: "op", v: m[3] });
  }
  return out;
}

/** Parse a formula. Throws a plain-English error for anything it does not understand. */
export function parseFormula(src) {
  const tk = tokenize(String(src || ""));
  if (!tk.length) throw new Error("Empty formula");
  let p = 0;
  const peek = () => tk[p], next = () => tk[p++];
  const isOp = (...v) => peek()?.t === "op" && v.includes(peek().v);
  const expect = (v) => { if (!isOp(v)) throw new Error(`Expected "${v}"${peek() ? ` near "${peek().v}"` : " at the end"}`); p++; };
  const bin = (sub, ops) => () => { let l = sub(); while (isOp(...ops)) { const op = next().v; l = { k: "bin", op, l, r: sub() }; } return l; };
  const primary = () => {
    const t = next();
    if (!t) throw new Error("The formula ends too early");
    if (t.t === "num") return { k: "num", v: t.v };
    if (t.t === "op" && t.v === "(") { const e = expr(); expect(")"); return e; }
    if (t.t === "id") {
      if (isOp("(")) {
        const fn = Object.hasOwn(FUNCS, t.v) ? FUNCS[t.v] : null;
        if (!fn) throw new Error(`Unknown function "${t.v}". Known: ${Object.keys(FUNCS).join(", ")}`);
        p++;
        const args = [];
        if (!isOp(")")) { args.push(expr()); while (isOp(",")) { p++; args.push(expr()); } }
        expect(")");
        if (args.length !== fn.args) throw new Error(`${t.v}() takes ${fn.args} value${fn.args > 1 ? "s" : ""}`);
        return { k: "fn", name: t.v, args };
      }
      if (!Object.hasOwn(SERIES, t.v)) throw new Error(`Unknown name "${t.v}". Use ${Object.keys(SERIES).join(", ")} or a function.`);
      return { k: "ser", name: t.v };
    }
    throw new Error(`Unexpected "${t.v}"`);
  };
  const unary = () => { if (isOp("-", "not", "!")) { const op = next().v; return { k: "un", op, e: unary() }; } return primary(); };
  const mul = bin(unary, ["*", "/"]), add = bin(mul, ["+", "-"]);
  const cmp = () => { const l = add(); if (isOp(">", "<", ">=", "<=", "==", "!=")) { const op = next().v; return { k: "bin", op, l, r: add() }; } return l; };
  const and = bin(cmp, ["and", "&&"]), or = bin(and, ["or", "||"]);
  const expr = () => { const c = or(); if (isOp("?")) { p++; const a = expr(); expect(":"); return { k: "tern", c, a, b: expr() }; } return c; };
  const tree = expr();
  if (p < tk.length) throw new Error(`Unexpected "${tk[p].v}"`);
  return tree;
}

/** Evaluate over candles b = {time, open, high, low, close, volume}; returns an array (nulls where undefined). */
export function evalFormula(src, b) {
  const tree = typeof src === "string" ? parseFormula(src) : src;
  const n = b.close.length;
  const bc = (x) => (Array.isArray(x) ? x : new Array(n).fill(x));
  const ev = (e) => {
    switch (e.k) {
      case "num": return e.v;
      case "ser": return SERIES[e.name](b);
      case "un": { const x = bc(ev(e.e)); return x.map((v) => (num(v) ? (e.op === "-" ? -v : v ? 0 : 1) : null)); }
      case "fn": {
        const fn = FUNCS[e.name];
        if (fn.bars) { const k = ev(e.args[0]); return fn.f(b, Array.isArray(k) ? k[k.length - 1] : k); }
        const args = e.args.map(ev);
        const scalarN = (i) => (Array.isArray(args[i]) ? args[i].findLast?.(num) ?? args[i][args[i].length - 1] : args[i]);
        if (["cross", "crossunder", "max", "min"].includes(e.name)) return fn.f(bc(args[0]), bc(args[1]));
        return fn.args === 1 ? fn.f(bc(args[0])) : fn.f(bc(args[0]), scalarN(1));
      }
      case "tern": { const c = bc(ev(e.c)), a = bc(ev(e.a)), bb = bc(ev(e.b)); return c.map((v, i) => (num(v) ? (v ? a[i] : bb[i]) : null)); }
      case "bin": {
        const l = bc(ev(e.l)), r = bc(ev(e.r));
        return l.map((x, i) => {
          const y = r[i];
          if (!num(x) || !num(y)) return null;
          switch (e.op) {
            case "+": return x + y; case "-": return x - y; case "*": return x * y; case "/": return y === 0 ? null : x / y;
            case ">": return +(x > y); case "<": return +(x < y); case ">=": return +(x >= y); case "<=": return +(x <= y);
            case "==": return +(x === y); case "!=": return +(x !== y);
            case "and": case "&&": return +(!!x && !!y); case "or": case "||": return +(!!x || !!y);
            default: return null;
          }
        });
      }
      default: return null;
    }
  };
  return bc(ev(tree));
}

/** True when the formula is a condition (its top level compares or combines). */
export const isCondition = (src) => { try { const t = parseFormula(src); return t.k === "bin" && [">", "<", ">=", "<=", "==", "!=", "and", "or", "&&", "||"].includes(t.op) || (t.k === "fn" && /^cross/.test(t.name)); } catch { return false; } };

/**
 * An indicator from a request ("create an indicator that ..."), approach 1 of the feature list.
 * A formula written in the request is used as it is; otherwise a few plain descriptions are
 * recognised. Returns { name, formula, understood } or null (nothing is invented).
 */
export function formulaFromText(text) {
  const t = String(text || "").trim();
  const m = t.match(/(?:indicator|formula)\s*(?:that is|=|:)?\s*(.+)$/i);
  const body = (m ? m[1] : t).trim().replace(/[.]$/, "");
  try { parseFormula(body); return { name: body.slice(0, 30), formula: body, understood: "the formula as written" }; } catch { /* not a formula: try the descriptions */ }
  const s = t.toLowerCase(), n = (d) => { const x = s.match(/(\d+)/); return x ? +x[1] : d; };
  const T = [
    [/distance (?:from|to) (?:the )?(\d+)?\s*(?:-day |day )?(?:ema|average|moving average)/, () => { const k = n(200); return [`% from EMA ${k}`, `(close / ema(close, ${k}) - 1) * 100`]; }],
    [/momentum|rate of change|roc/, () => { const k = n(20); return [`Momentum ${k}`, `roc(close, ${k})`]; }],
    [/volatility/, () => { const k = n(20); return [`Volatility ${k}`, `std(roc(close, 1), ${k})`]; }],
    [/new (\d+)?[- ]?(?:day |week |candle )?high/, () => { const k = n(52); return [`New ${k}-candle high`, `close > ref(highest(high, ${k}), 1)`]; }],
    [/new (\d+)?[- ]?(?:day |week |candle )?low/, () => { const k = n(52); return [`New ${k}-candle low`, `close < ref(lowest(low, ${k}), 1)`]; }],
    [/volume (?:spike|surge)|unusual volume/, () => { const k = n(2); return [`Volume x${k}`, `volume > ${k} * ref(sma(volume, 50), 1)`]; }],
    [/rsi/, () => { const k = n(14); return [`RSI ${k}`, `rsi(close, ${k})`]; }],
    [/golden cross/, () => ["Golden cross", "cross(ema(close, 50), ema(close, 200))"]],
    [/death cross/, () => ["Death cross", "crossunder(ema(close, 50), ema(close, 200))"]],
    [/(?:ema|average) (\d+) (?:above|over|crosses above) (?:ema|average) (\d+)/, () => { const x = s.match(/(\d+)\D+(\d+)/); return [`EMA ${x[1]} over ${x[2]}`, `cross(ema(close, ${x[1]}), ema(close, ${x[2]}))`]; }],
  ];
  for (const [re, f] of T) if (re.test(s)) { const [name, formula] = f(); return { name, formula, understood: `read "${t}" as ${formula}` }; }
  return null;
}

/**
 * Import own indicators from a file's text. Accepted, one per line or as JSON:
 *   name = formula          (lines starting with # or // are comments)
 *   [{ "name": "...", "formula": "...", "pane": "own"|"price", "color": "#22d3ee" }]
 * Only this formula language is read. Scripts in another language (Pine, AFL, JavaScript) are not run:
 * a line that is not a valid formula is reported, never executed.
 * Returns { items: [{ name, formula, pane, color }], errors: [string] }.
 */
export function importFormulas(text, { max = 200 } = {}) {
  const items = [], errors = [];
  const src = String(text || "").replace(/^\uFEFF/, "").trim();
  let raw = [];
  if (src.startsWith("[") || src.startsWith("{")) {
    try { const j = JSON.parse(src); raw = (Array.isArray(j) ? j : Array.isArray(j.indicators) ? j.indicators : [j]).map((x, i) => ({ ...x, at: `entry ${i + 1}` })); } catch (e) { return { items, errors: [`not valid JSON: ${e.message}`] }; }
  } else {
    src.split(/\r?\n/).forEach((line, i) => {
      const t = line.trim();
      if (!t || t.startsWith("#") || t.startsWith("//")) return;
      const m = t.match(/^([^=<>!]{1,60}?)\s=\s(.+)$/) || t.match(/^([A-Za-z_][\w .%-]{0,40}?)\s*:\s*(.+)$/);
      raw.push(m ? { name: m[1].trim(), formula: m[2].trim(), at: `line ${i + 1}` } : { name: "", formula: t, at: `line ${i + 1}` });
    });
  }
  for (const r of raw.slice(0, max)) {
    const f = String(r.formula || "").trim();
    if (!f) { errors.push(`${r.at}: no formula`); continue; }
    try { parseFormula(f); } catch (e) { errors.push(`${r.at}: ${e.message}`); continue; }
    items.push({ name: String(r.name || f.slice(0, 24)).slice(0, 60), formula: f, pane: r.pane === "price" ? "price" : "own", color: /^#[0-9a-f]{6}$/i.test(r.color || "") ? r.color : "#22d3ee" });
  }
  if (raw.length > max) errors.push(`only the first ${max} entries were read`);
  return { items, errors };
}

/** The reverse: own indicators as JSON text that importFormulas reads back. */
export const exportFormulas = (list) => JSON.stringify((list || []).map(({ name, formula, pane, color }) => ({ name, formula, pane, color })), null, 2);
