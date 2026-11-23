// Every indicator parameter the charts draw with, in one place the user edits (Shankar Sir, 23 Nov:
// "there is nothing called default, everything has to be selectable and changeable"). The values in
// START are only what a new browser starts from; the settings panel changes every one of them and
// every chart (chart lab, stock page, workspace, RSI/RSC screens, multi-tile, data window) reads them.
// Stored per browser (usePersistent), so a change shows on every open chart at once.
import { useMemo, useCallback } from "react";
import { usePersistent } from "./storage.js";
import { MA_KINDS } from "../../engine/studies.js";

export const START = {
  lines: [
    { kind: "EMA", n: 20, color: "#22d3ee" },
    { kind: "EMA", n: 50, color: "#14a44d" },
    { kind: "EMA", n: 200, color: "#d97706" },
  ],
  mmaShort: [3, 5, 8, 10, 12, 15],
  mmaLong: [30, 35, 40, 45, 50, 60],
  acc: [4, 14, 26, 39],
  rsi: 14,
  rsiNested: 14,
  rsiHigh: 70,
  rsiLow: 30,
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
  rscAvg: 10,
  rscBase: 100,
  renkoBox: null, // null = sized from the instrument's price
  kagiPct: 4,
  pfBox: null,
  pfRev: 3,
  srLookback: null, // null = 250 daily candles, 150 otherwise
  fibLookback: null, // null = 250 daily candles, 120 otherwise
  fibRatios: [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.618],
  vpBins: 28,
  vpValueArea: 70,
};

const int = (v, lo, hi) => { const n = Math.round(+v); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
const pos = (v) => { const n = +v; return v !== "" && v != null && Number.isFinite(n) && n > 0 ? n : null; };

/** "3, 5,8" -> [3, 5, 8] (whole numbers 1-1000, duplicates dropped, order kept). */
export function parseList(text) {
  const out = [];
  for (const p of String(text ?? "").split(/[\s,;]+/)) { const n = int(p, 1, 1000); if (n != null && !out.includes(n)) out.push(n); }
  return out;
}

/** Stored settings -> a complete, valid set (anything missing or unusable takes its START value). */
export function normalise(s = {}) {
  const o = { ...START, ...(s || {}) };
  const list = (k) => (Array.isArray(o[k]) ? o[k].map((x) => int(x, 1, 1000)).filter((x) => x != null) : START[k]);
  const lines = Array.isArray(o.lines)
    ? o.lines.map((l) => ({ kind: MA_KINDS.includes(l?.kind) ? l.kind : "EMA", n: int(l?.n, 1, 1000), color: typeof l?.color === "string" ? l.color : "#22d3ee", off: !!l?.off })).filter((l) => l.n != null)
    : START.lines;
  const per = (k, lo = 1, hi = 1000) => int(o[k], lo, hi) ?? START[k];
  const rsiHigh = Math.min(100, Math.max(0, +o.rsiHigh)), rsiLow = Math.min(100, Math.max(0, +o.rsiLow));
  return {
    lines, mmaShort: list("mmaShort"), mmaLong: list("mmaLong"), acc: list("acc"),
    rsi: per("rsi", 2), rsiNested: per("rsiNested", 2),
    rsiHigh: Number.isFinite(rsiHigh) ? rsiHigh : START.rsiHigh, rsiLow: Number.isFinite(rsiLow) ? rsiLow : START.rsiLow,
    macdFast: per("macdFast"), macdSlow: per("macdSlow"), macdSignal: per("macdSignal"),
    rscAvg: per("rscAvg"), rscBase: pos(o.rscBase) ?? START.rscBase,
    renkoBox: pos(o.renkoBox), kagiPct: pos(o.kagiPct) ?? START.kagiPct, pfBox: pos(o.pfBox), pfRev: per("pfRev"),
    srLookback: int(o.srLookback, 10, 5000),
    fibLookback: int(o.fibLookback, 10, 5000),
    fibRatios: Array.isArray(o.fibRatios) ? [...new Set(o.fibRatios.map(Number).filter((x) => Number.isFinite(x) && x >= 0 && x <= 10))].sort((a, b) => a - b) : START.fibRatios,
    vpBins: int(o.vpBins, 4, 200) ?? START.vpBins,
    vpValueArea: Math.min(99, Math.max(1, +o.vpValueArea || START.vpValueArea)),
  };
}

/** [settings, patch] — patch merges into what is stored. */
export function useIndSettings() {
  const [raw, setRaw] = usePersistent("indSettings", START);
  const s = useMemo(() => normalise(raw), [raw]);
  const patch = useCallback((p) => setRaw((cur) => ({ ...normalise(cur), ...p })), [setRaw]);
  const reset = useCallback(() => setRaw(START), [setRaw]);
  return [s, patch, reset];
}

/** "EMA 20 / 50 / SMA 200" for labels. */
export const linesLabel = (lines) => (lines.length ? lines.map((l) => `${l.kind} ${l.n}`).join(" / ") : "none");
/** "3-15" style label for a period list. */
export const listLabel = (xs) => (xs.length ? (xs.length > 2 ? `${Math.min(...xs)}-${Math.max(...xs)}` : xs.join(", ")) : "none");
