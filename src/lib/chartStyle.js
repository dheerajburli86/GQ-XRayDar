// Price drawn as a line, OHLC bars or candles (owner, improvements 11 and 12): in a line chart
// every rising period is green and every falling period red (close vs the previous close).
export const PRICE_STYLES = [{ value: "line", label: "Line" }, { value: "bar", label: "Bar" }, { value: "candles", label: "Candle" }];
export const UP = "#16a34a", DOWN = "#dc2626";

/**
 * time[], ohlc {open, high, low, close}; returns a TvChart series spec.
 * keep(x): which values are drawable (e.g. > 0 on a log scale).
 */
export function priceSeries(time, ohlc, style = "line", { up = UP, down = DOWN, keep = (x) => x != null && Number.isFinite(x), id = "price", options = {}, priceLines } = {}) {
  const { open, high, low, close } = ohlc;
  if (style === "bar" || style === "candles") {
    const data = [];
    for (let i = 0; i < time.length; i++) {
      const o = open?.[i] ?? close[i], h = high?.[i] ?? close[i], l = low?.[i] ?? close[i], c = close[i];
      if (keep(o) && keep(h) && keep(l) && keep(c)) data.push({ time: time[i], open: o, high: Math.max(h, o, c), low: Math.min(l, o, c), close: c });
    }
    const opts = style === "bar" ? { upColor: up, downColor: down, thinBars: false } : { upColor: up, downColor: down, borderVisible: false, wickUpColor: up, wickDownColor: down };
    return { id, type: style === "bar" ? "bar" : "candles", data, priceLines, options: { lastValueVisible: false, priceLineVisible: false, ...opts, ...options } };
  }
  const data = [];
  let prev = null;
  for (let i = 0; i < time.length; i++) {
    const c = close[i];
    if (!keep(c)) continue;
    data.push({ time: time[i], value: c, color: prev == null || c >= prev ? up : down });
    prev = c;
  }
  return { id, type: "line", data, priceLines, options: { lineWidth: 1, lastValueVisible: false, priceLineVisible: false, ...options } };
}
