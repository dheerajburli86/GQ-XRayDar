// Traded value ("turnover") ranking, used where a market cap does not exist (India).
// Turnover = median daily close x volume in USD over the last `window` sessions with volume.
// It is a liquidity measure, NOT a market cap: it is always labelled "ranked by turnover".

export const TURNOVER_WINDOW = 60;
export const TURNOVER_MIN_BARS = 20;

/** bars: {close[], volume[]|null}; fxClose: per-bar USD per unit of the bar's currency. Returns USD/day or null. */
export function turnoverUsd(close, volume, fxPerBar, window = TURNOVER_WINDOW, minBars = TURNOVER_MIN_BARS) {
  if (!volume || !close || close.length !== volume.length) return null;
  const vals = [];
  for (let i = close.length - 1; i >= 0 && vals.length < window; i--) {
    const v = volume[i], c = close[i];
    if (!(v > 0) || !(c > 0)) continue;
    const f = fxPerBar ? fxPerBar[i] : 1;
    if (!(f > 0)) continue;
    vals.push(v * c * f);
  }
  if (vals.length < minBars) return null;
  vals.sort((a, b) => a - b);
  const m = vals.length >> 1;
  return Math.round(vals.length % 2 ? vals[m] : (vals[m - 1] + vals[m]) / 2);
}

/** Order two security records, biggest first: stocks with a market cap by cap, then the rest by turnover. */
export function secRankCmp(a, b) {
  const ca = a.capUsdNow || a.capUsd || 0, cb = b.capUsdNow || b.capUsd || 0;
  if (ca > 0 || cb > 0) { if (ca > 0 && cb > 0) return cb - ca; return ca > 0 ? -1 : 1; }
  return (b.turnoverUsd || 0) - (a.turnoverUsd || 0);
}
/** Same for screen rows ({sec}). */
export const rowRankCmp = (a, b) => secRankCmp(a.sec, b.sec);

/** True when a list of securities is ordered by turnover rather than cap (no cap on any of them). */
export const rankedByTurnover = (secs) => secs.length > 0 && secs.every((s) => !(s.capUsdNow > 0 || s.capUsd > 0)) && secs.some((s) => s.turnoverUsd > 0);
