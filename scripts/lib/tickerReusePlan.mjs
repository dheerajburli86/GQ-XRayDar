// Pure planner for the ticker-reuse backfill: no I/O, so it is tested without a database or FMP.
import { cutAtTickerReuse } from "../../engine/quality.js";

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const day = (d) => Date.parse(`${String(d).slice(0, 10)}T00:00:00Z`) / 86400000;

/**
 * dbBars: { time[], open[], high[], low[], close[], volume[] } as stored for the instrument.
 * fmpRows: [{ date, open, high, low, close, volume }] in any order (FMP returns newest first).
 * Returns { skip: reason } or { breakDate, deleteBefore, insert: [rows ascending] }.
 * The FMP series is only trusted when it JOINS the stored one: it ends within 10 days of the break, its last close is
 * within x0.5..x2 of the first stored close after the break, and on the dates both have (after the break) the closes
 * agree to 3% at the median. Otherwise FMP is describing another company or another price basis and nothing is written.
 */
export function planBackfill(dbBars, fmpRows, { minRows = 60 } = {}) {
  const cut = cutAtTickerReuse(dbBars);
  if (!cut.cut) return { skip: "no ticker-reuse break in the stored bars" };
  const B = cut.cut.date;
  const rows = (fmpRows || []).filter((r) => r && r.date && Number.isFinite(+r.close) && +r.close > 0).map((r) => ({ date: String(r.date).slice(0, 10), open: +r.open || +r.close, high: +r.high || +r.close, low: +r.low || +r.close, close: +r.close, volume: Math.round(+r.volume || 0) })).sort((a, b) => (a.date < b.date ? -1 : 1));
  const before = rows.filter((r) => r.date < B);
  if (before.length < minRows) return { skip: `FMP has only ${before.length} bars before ${B}` };
  const last = before[before.length - 1];
  if (day(B) - day(last.date) > 10) return { skip: `FMP history ends ${last.date}, more than 10 days before the break ${B}` };
  const first = cut.bars.close[0];
  const join = last.close / first;
  if (join < 0.5 || join > 2) return { skip: `FMP close ${last.close} on ${last.date} does not join the stored ${first} on ${B} (x${join.toFixed(2)})` };
  const have = new Map(rows.map((r) => [r.date, r.close]));
  const diffs = [];
  for (let i = 0; i < cut.bars.time.length && diffs.length < 40; i++) { const f = have.get(String(cut.bars.time[i]).slice(0, 10)); if (f) diffs.push(Math.abs(f / cut.bars.close[i] - 1)); }
  if (diffs.length >= 5 && median(diffs) > 0.03) return { skip: `after ${B} FMP and the stored closes differ by ${(median(diffs) * 100).toFixed(1)}% at the median` };
  return { breakDate: B, deleteBefore: B, insert: before, storedBefore: cut.cut.bars };
}
