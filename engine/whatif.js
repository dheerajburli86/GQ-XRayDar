// What-if price: a typed price (today's, or a later session's) is added to the stored daily candles so every
// indicator can be read as if that candle had printed. Nothing is stored; the result is always labelled hypothetical.
//
// entries: [{ date: "YYYY-MM-DD", close: number }]
//   date == last stored date  -> that candle's close is replaced (its high / low stretch to hold the new close)
//   date  > last stored date  -> a new candle is appended (open = previous close, high / low = the open and close)
//   date  < last stored date  -> ignored (history is never rewritten) and reported
// rscCloses (optional, parallel to bars.time): the closes in the benchmark's currency; a typed price is carried over
// with the last stored FX ratio, so the relative-strength line moves by the same percentage as the price.

const pad = (n) => String(n).padStart(2, "0");

/** The next weekday after an ISO date (string maths only; weekends skipped, exchange holidays are not known here). */
export function nextWeekday(date) {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  do { t.setUTCDate(t.getUTCDate() + 1); } while (t.getUTCDay() === 0 || t.getUTCDay() === 6);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function applyWhatIf(bars, entries, rscCloses = null) {
  const list = (entries || []).filter((e) => e && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && Number.isFinite(e.close) && e.close > 0).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const n0 = bars?.time?.length || 0;
  if (!n0 || !list.length) return { bars, rscCloses, applied: [], ignored: list };
  const col = (k) => (Array.isArray(bars[k]) ? bars[k].slice() : bars.close.map(() => null));
  const out = { ...bars, time: bars.time.slice(), open: col("open"), high: col("high"), low: col("low"), close: bars.close.slice(), volume: bars.volume ? bars.volume.slice() : null };
  const last0 = n0 - 1;
  const fx = rscCloses && bars.close[last0] > 0 && rscCloses[last0] > 0 ? rscCloses[last0] / bars.close[last0] : 1;
  const rc = rscCloses ? rscCloses.slice() : null;
  const applied = [], ignored = [];
  for (const e of list) {
    const n = out.time.length;
    const lastDate = out.time[n - 1];
    if (e.date < lastDate) { ignored.push(e); continue; }
    if (e.date === lastDate) {
      out.close[n - 1] = e.close;
      out.high[n - 1] = Math.max(out.high[n - 1] ?? e.close, e.close);
      out.low[n - 1] = Math.min(out.low[n - 1] ?? e.close, e.close);
      if (rc) rc[n - 1] = e.close * fx;
    } else {
      const prev = out.close[n - 1];
      out.time.push(e.date); out.open.push(prev); out.close.push(e.close);
      out.high.push(Math.max(prev, e.close)); out.low.push(Math.min(prev, e.close));
      if (out.volume) out.volume.push(0);
      if (rc) rc.push(e.close * fx);
    }
    applied.push(e);
  }
  return { bars: out, rscCloses: rc, applied, ignored };
}
