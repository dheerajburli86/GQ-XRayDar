// Plain-English read of a chart (feature 4.4): what the stored calculations and
// the candles show, per timeframe. Shared by the server (GQ agent, Telegram) and
// the browser (chart page "Explain this chart"). Descriptive only.
import { aggregate } from "./indicators.js";
import { supportResistance } from "./chartTools.js";
import { candlePatternsAt, CANDLE_PATTERNS } from "./candles.js";

const TFN = { D: "Daily", W: "Weekly", M: "Monthly", Q: "Quarterly", Y: "Yearly" };
const r2 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
const MMA = { bull: "in bullish alignment (all short averages above all long ones, both groups rising)", bear: "in bearish alignment", above: "short-term group above the long-term group, not fully aligned", below: "short-term group below the long-term group" };

export function describeChart({ sec, snap, bars, tfs = ["D", "W"], mode = null }) {
  const lines = [];
  for (const k of tfs) {
    const t = snap?.tf?.[k];
    if (!t) continue;
    const b = aggregate(bars, k);
    const lv = supportResistance(b, { lookback: k === "D" ? 250 : 150 });
    const i = b.time.length - 1;
    const pats = candlePatternsAt(b, i).filter((p) => CANDLE_PATTERNS[p].dir !== 0).map((p) => CANDLE_PATTERNS[p].label);
    lines.push(`${TFN[k]} (${b.time.length} candles to ${t.t}): close ${t.close}. `
      + `MMA ${MMA[t.mma] || "mixed"}${t.compression ? "; short averages compressed (a squeeze)" : ""}${t.expansion ? "; averages fanning out" : ""}. `
      + `RSI ${t.rsi} (RSI of RSI ${t.rsi2})${t.rsiDivergence ? `, ${t.rsiDivergence} RSI divergence` : ""}. MACD ${t.macd === "bull" ? "above" : "below"} its signal${t.macdCross ? ` (just crossed ${t.macdCross === "bull" ? "up" : "down"})` : ""}. `
      + `${t.consolidation ? "Price is consolidating. " : ""}${t.breakoutRecent ? "Broke out of a range in the last 5 candles. " : ""}${t.breakdown ? "Broke down from a range. " : ""}`
      + `${pats.length ? `Latest candle: ${pats.join(", ")}. ` : ""}`
      + `${lv.length ? `Levels price has turned at: ${lv.map((l) => `${l.kind} ${r2(l.price)} (${l.touches} touches)`).join(", ")}.` : ""}`);
  }
  const r = snap?.rsc?.country?.W;
  if (r) lines.push(`Against its country index (weekly relative strength): ${r.rising ? "rising" : r.falling ? "falling" : "flat"}${r.turnUp ? ", just turned up" : ""}${r.atHigh ? ", at a 52-week high" : ""}.`);
  if (snap?.stage) lines.push(`Stage: ${snap.stage.label}.`);
  if (snap?.tfShift) lines.push(`${snap.tfShift}.`);
  if (mode) lines.push(`View: ${mode}.`);
  return { symbol: sec?.symbol, asOf: snap?.asOf, lines, text: lines.join("\n"), note: "Describes what the chart shows; not a forecast or a recommendation." };
}
