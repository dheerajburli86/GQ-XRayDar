// Dates are ISO "YYYY-MM-DD" strings throughout: they sort lexically, never
// shift with the viewer's timezone, and a session is the date the exchange
// printed -- not a timestamp converted from somewhere else.

export const TIMEFRAMES = ["D", "W", "M", "Q", "Y"];
export const TF_LABEL = { D: "Daily", W: "Weekly", M: "Monthly", Q: "Quarterly", Y: "Yearly" };

/** Trailing-return horizons in TRADING DAYS. A horizon is not a candle size:
 *  "3M" is a 63-session look-back on daily data, "Q" is a quarterly candle. */
export const HORIZONS = { "1W": 5, "1M": 21, "3M": 63, "6M": 126, "12M": 252 };
export const HORIZON_KEYS = Object.keys(HORIZONS);

const DAY = 86400000;
export const toUTC = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
export const fromUTC = (t) => new Date(t).toISOString().slice(0, 10);
export const addDays = (d, n) => fromUTC(toUTC(d) + n * DAY);
export const dayOfWeek = (d) => new Date(toUTC(d)).getUTCDay();
export const isWeekday = (d) => { const w = dayOfWeek(d); return w !== 0 && w !== 6; };

const WEEK_CACHE = new Map();
/** Period bucket for a candle timeframe. */
export function periodKey(date, tf) {
  if (tf === "D") return date;
  if (tf === "W") {
    let w = WEEK_CACHE.get(date);
    if (w === undefined) { w = weekStart(date); if (WEEK_CACHE.size > 200000) WEEK_CACHE.clear(); WEEK_CACHE.set(date, w); }
    return w;
  }
  const y = +date.slice(0, 4), m = +date.slice(5, 7);
  if (tf === "M") return date.slice(0, 7);
  if (tf === "Q") return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
  return String(y);
}

function weekStart(date) {
  const t = toUTC(date);
  const dow = (new Date(t).getUTCDay() + 6) % 7; // Monday = 0
  return fromUTC(t - dow * DAY);
}

export const quarterOf = (d) => periodKey(d, "Q");

/** Indices of the last date in each COMPLETED calendar quarter. The final
 *  date is a quarter end only if the next quarter has already begun -- a
 *  running quarter is never treated as closed (no look-ahead). */
export function quarterEndIndices(dates) {
  const out = [];
  for (let i = 0; i < dates.length - 1; i++) {
    if (quarterOf(dates[i]) !== quarterOf(dates[i + 1])) out.push(i);
  }
  return out;
}

/** Binary search: first index with dates[i] >= d (dates ascending). */
export function lowerBound(dates, d) {
  let lo = 0, hi = dates.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (dates[mid] < d) lo = mid + 1; else hi = mid; }
  return lo;
}

/** Last index with dates[i] <= d, or -1. */
export function indexAtOrBefore(dates, d) {
  const i = lowerBound(dates, d);
  if (i < dates.length && dates[i] === d) return i;
  return i - 1;
}

/** Weekday calendar between two dates inclusive (used by the demo generator). */
export function weekdays(from, to) {
  const out = [];
  for (let t = toUTC(from), end = toUTC(to); t <= end; t += DAY) {
    const d = fromUTC(t);
    if (isWeekday(d)) out.push(d);
  }
  return out;
}

export function quarterLabel(d) {
  const q = quarterOf(d);
  return `${q.slice(5)} ${q.slice(0, 4)}`;
}
