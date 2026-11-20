// GQ breadth analyser (owner's workbook "GQ_Breadth_Analysis", 2026-11-20).
//
// For a parent (e.g. a country index) and its constituents (e.g. its sector indices) over a
// chosen start and end date:
//   weight   = the constituent's cap at the START date, as a share of the parent
//   change   = the constituent's % change from start to end
//   contribution = weight x change, and H = its share of the parent's total contribution
// The parent's own change is the weighted sum (the workbook's C5 / E16). Constituents are then
// split by direction against it:
//   parent up:   O/P  beat the parent, U/P lagged it but are positive, -ve U/P are negative
//   parent down: +ve O/P are positive anyway, O/P beat the parent but are negative, U/P lagged it
// and the figures of the workbook's header row follow:
//   CCR  contribution / weight of the outperformers (parent up) or underperformers (parent down)
//   OUP  outperformers per underperformer
//   RR   share of the "wrong-way" group among the lagging side
//   RRM  the wrong-way group as a share of all constituents
//   RRMK the wrong-way group's start cap as a share of the parent (cap-weighted RRM)
//   TR   RRM x 50 + CCR x 2 + (1 / OUP) x 3        TRMK  the same with RRMK
// A figure whose denominator is zero is null (the workbook shows #DIV/0!).
// Pinned against the workbook's own numbers in tests/breadthRange.test.mjs.

const sum = (a) => a.reduce((s, x) => s + x, 0);
const div = (a, b) => (b === 0 || !Number.isFinite(a) || !Number.isFinite(b) ? null : a / b);

/**
 * rows: [{ name, w, r }] with w the start weight (any positive scale) and r the fractional change
 * (0.05 = +5%). Returns the summary row and the per-constituent table.
 */
export function breadthStats(rows) {
  const items = rows.filter((x) => x && Number.isFinite(x.w) && x.w > 0 && Number.isFinite(x.r));
  const n = items.length;
  if (!n) return null;
  const total = sum(items.map((x) => x.w));
  const D = items.map((x) => (x.w / total) * 100);           // weight, %
  const F = items.map((x, i) => D[i] * x.r);                 // contribution
  const F16 = sum(F);
  const change = F16 / 100;                                  // the parent's own change
  const H = items.map((_, i) => (F16 === 0 ? 0 : F[i] / F16)); // share of the total contribution
  const up = change > 0;
  const r = items.map((x) => x.r);

  const cnt = (pred) => r.filter(pred).length;
  const wsum = (pred) => sum(D.filter((_, i) => pred(r[i])) ) / 100;
  const csum = (pred) => sum(H.filter((_, i) => pred(r[i])));
  // the groups (counts, weights, contributions)
  const gt0 = (x) => x > 0, ltC = (x) => x < change, gtC = (x) => x > change, lt0 = (x) => x < 0;
  const pos = up ? null : { n: cnt(gt0), d: wsum(gt0), e: csum(gt0) };             // +ve O/P
  const neg = up ? { n: cnt(lt0), d: wsum(lt0), e: csum(lt0) } : null;              // -ve U/P
  const op = { n: cnt(gtC) - (pos?.n || 0), d: wsum(gtC) - (pos?.d || 0), e: csum(gtC) - (pos?.e || 0) };
  const up_ = { n: cnt(ltC) - (neg?.n || 0), d: wsum(ltC) - (neg?.d || 0), e: csum(ltC) - (neg?.e || 0) };

  const ccr = up ? div(op.e, op.d) : div(up_.e, up_.d);
  const oup = up ? div(op.n, up_.n + neg.n) : div(up_.n, op.n + pos.n);
  const rr = up ? div(neg.n, neg.n + up_.n) : div(pos.n, pos.n + op.n);
  const rrm = up ? neg.n / n : pos.n / n;
  const against = sum(items.filter((x) => (up ? !(x.r > 0) : x.r > 0)).map((x) => x.w));
  const rrmk = against / total;
  const tr = (k) => (ccr == null || oup == null || oup === 0 ? null : k * 50 + ccr * 2 + (1 / oup) * 3);
  return {
    change, up, n, ccr, oup, rr, rrm, rrmk, tr: tr(rrm), trmk: tr(rrmk),
    groups: { pos, op, up: up_, neg },
    rows: items.map((x, i) => ({ name: x.name, weight: D[i], change: x.r, contribution: F[i], share: H[i] })),
  };
}

/** Index of the last date <= d (dates ascending ISO strings), or -1. */
export function lastOnOrBefore(dates, d) {
  let lo = 0, hi = dates.length - 1, ans = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (dates[mid] <= d) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return ans;
}

/**
 * Constituent rows between two dates from index series.
 * series: [{ name, dates[], level[], cap[]|null }]. A series without a cap history is given an
 * equal weight (and flagged), as for the equal-weight India indices.
 */
export function rowsBetween(series, start, end) {
  const out = [];
  let equalWeighted = false;
  for (const s of series) {
    const a = lastOnOrBefore(s.dates, start), b = lastOnOrBefore(s.dates, end);
    if (a < 0 || b < 0) continue;
    const l0 = s.level[a], l1 = s.level[b];
    if (!(l0 > 0) || !(l1 > 0)) continue;
    let w = s.cap ? s.cap[a] : null;
    if (!(w > 0)) { w = 1; equalWeighted = true; }
    out.push({ name: s.name, w, r: l1 / l0 - 1 });
  }
  return { rows: out, equalWeighted };
}

/** A look-back spec ("1D", "1W", "1M", "3M", "6M", "1Y", "YTD") -> start date for an end date. */
export function startForLookback(dates, end, spec) {
  const e = lastOnOrBefore(dates, end);
  if (e < 0) return null;
  const m = /^(\d+)(D|W|M|Y)$/i.exec(String(spec).trim());
  if (/^ytd$/i.test(spec)) return dates[Math.max(0, lastOnOrBefore(dates, `${dates[e].slice(0, 4)}-01-01`))] || null;
  if (!m) return null;
  const k = +m[1], u = m[2].toUpperCase();
  if (u === "D") return dates[Math.max(0, e - k)];
  const d = new Date(`${dates[e]}T00:00:00Z`);
  if (u === "W") d.setUTCDate(d.getUTCDate() - 7 * k);
  if (u === "M") d.setUTCMonth(d.getUTCMonth() - k);
  if (u === "Y") d.setUTCFullYear(d.getUTCFullYear() - k);
  const iso = d.toISOString().slice(0, 10);
  const i = lastOnOrBefore(dates, iso);
  return dates[Math.max(0, i)];
}

/** The workbook's header row for one period. */
export function breadthForPeriod(series, start, end) {
  const { rows, equalWeighted } = rowsBetween(series, start, end);
  const st = breadthStats(rows);
  return st ? { start, end, equalWeighted, ...st } : null;
}

/**
 * "Reverse CCR for ranges": the end date is fixed and the start date steps back one trading day
 * at a time. calendar: ascending ISO dates; returns the newest start first, as in the workbook.
 */
export function reverseRange(series, calendar, end, days = 25) {
  const e = lastOnOrBefore(calendar, end);
  if (e < 1) return [];
  const out = [];
  for (let k = 1; k <= days && e - k >= 0; k++) {
    const r = breadthForPeriod(series, calendar[e - k], calendar[e]);
    if (r) out.push(r);
  }
  return out;
}
