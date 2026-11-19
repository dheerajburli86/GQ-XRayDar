// Seasonality (owner's feature list, item 9): how an instrument has behaved by day of the week
// and by month of the year, and its average path through the calendar year (to overlay on the
// chart). Returns are close-to-close, in the instrument's own currency, over the stored history.

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const stats = (xs) => {
  const n = xs.length;
  if (!n) return { n: 0, avg: null, median: null, up: null };
  const s = [...xs].sort((a, b) => a - b);
  return { n, avg: xs.reduce((a, c) => a + c, 0) / n, median: n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2, up: xs.filter((x) => x > 0).length / n };
};

/** time[] (YYYY-MM-DD), close[] -> { dayOfWeek: [...], monthOfYear: [...], years, path } */
export function seasonality(time, close) {
  const dow = Array.from({ length: 7 }, () => []), mon = Array.from({ length: 12 }, () => []);
  for (let i = 1; i < close.length; i++) {
    if (!(close[i] > 0) || !(close[i - 1] > 0)) continue;
    const d = new Date(`${time[i]}T00:00:00Z`);
    dow[(d.getUTCDay() + 6) % 7].push(close[i] / close[i - 1] - 1);
  }
  // month returns: last close of the month vs last close of the month before
  const lastOf = new Map();
  for (let i = 0; i < close.length; i++) if (close[i] > 0) lastOf.set(time[i].slice(0, 7), close[i]);
  const keys = [...lastOf.keys()].sort();
  for (let k = 1; k < keys.length; k++) {
    const [y0, m0] = keys[k - 1].split("-").map(Number), [y1, m1] = keys[k].split("-").map(Number);
    if ((y1 - y0) * 12 + (m1 - m0) !== 1) continue; // a gap in the history: no return for that month
    mon[m1 - 1].push(lastOf.get(keys[k]) / lastOf.get(keys[k - 1]) - 1);
  }
  // average path through the year: for each full year, cumulative return by trading-day-of-year
  // index (scaled to 252), averaged across years and rebased to 0
  const byYear = new Map();
  for (let i = 0; i < close.length; i++) { const y = time[i].slice(0, 4); if (!byYear.has(y)) byYear.set(y, []); byYear.get(y).push(close[i]); }
  const curves = [];
  for (const [, xs] of byYear) {
    if (xs.length < 200 || !(xs[0] > 0)) continue;
    curves.push(Array.from({ length: 253 }, (_, k) => { const j = Math.min(xs.length - 1, Math.round((k / 252) * (xs.length - 1))); return xs[j] / xs[0] - 1; }));
  }
  const path = curves.length ? Array.from({ length: 253 }, (_, k) => curves.reduce((a, c) => a + c[k], 0) / curves.length) : [];
  return {
    dayOfWeek: dow.slice(0, 5).map((xs, i) => ({ label: DOW[i], ...stats(xs) })),
    monthOfYear: mon.map((xs, i) => ({ label: MONTHS[i], ...stats(xs) })),
    years: curves.length, path,
  };
}

/** The average yearly path laid onto the current year's dates, scaled to start at `startPrice`. */
export function seasonalOverlay(path, yearStart, startPrice, sessionsPerYear = 252) {
  if (!path.length || !(startPrice > 0)) return [];
  const out = [];
  const d0 = new Date(`${yearStart}T00:00:00Z`);
  for (let k = 0; k <= sessionsPerYear; k++) {
    const d = new Date(d0.getTime() + Math.round((k / sessionsPerYear) * 364) * 86400000);
    out.push({ time: d.toISOString().slice(0, 10), value: startPrice * (1 + path[k]) });
  }
  return out;
}
