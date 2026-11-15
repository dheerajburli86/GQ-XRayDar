// GLOCOM / LOCOM: the heatmap dashboard's rule sheet, applied to stocks and to
// industry / sector groups, with the rank history that shows how each group is
// moving.
//
// The sheet ranks three returns -- 1 week, 6 months, 1 year -- as percentiles
// (0..1) within a peer set, then reads a band off the combination:
//
//   Name          Weekly     6 Month    1 Year          band
//   US 80 80      w > 0.8    m6 > 0.4   y > 0.8         1 dark green
//   LTS 80        w <= 0.8   m6 > 0.4   y > 0.8         1 dark green
//   US 60 60      w > 0.6    m6 > 0.4   0.6 < y <= 0.8  2 light green
//   LTS 60        w <= 0.6   m6 > 0.4   0.6 < y <= 0.8  2 light green
//   UW 30 30      w < 0.3    m6 < 0.3                   5 dark red
//   LTW 30        w <= 0.3   m6 >= 0.3                  5 dark red
//   UW 40 40      w < 0.4    m6 < 0.4                   4 light red
//   LTW 40        w <= 0.4   m6 >= 0.4                  4 light red
//   Neutral 40 60 everything else                       3 yellow
//
// Rows are tested in that order and the first match wins (owner's sheet,
// 2026-11-15). Peer sets:
//   GLOCOM  a stock against every stock in its market, or a group against the
//           other groups of the same level in that market;
//   LOCOM   a stock against the other stocks of its own industry group.
// A group's returns are the equal-weighted average of its constituents' returns,
// as on the heatmap's sector / industry tiles. A missing percentile counts as 0.5.

export const GLOCOM_RULES = [
  { label: "US 80 80", code: 1, test: (w, m, y) => w > 0.8 && m > 0.4 && y > 0.8 },
  { label: "LTS 80", code: 1, test: (w, m, y) => w <= 0.8 && m > 0.4 && y > 0.8 },
  { label: "US 60 60", code: 2, test: (w, m, y) => w > 0.6 && m > 0.4 && y > 0.6 && y <= 0.8 },
  { label: "LTS 60", code: 2, test: (w, m, y) => w <= 0.6 && m > 0.4 && y > 0.6 && y <= 0.8 },
  { label: "UW 30 30", code: 5, test: (w, m) => w < 0.3 && m < 0.3 },
  { label: "LTW 30", code: 5, test: (w, m) => w <= 0.3 && m >= 0.3 },
  { label: "UW 40 40", code: 4, test: (w, m) => w < 0.4 && m < 0.4 },
  { label: "LTW 40", code: 4, test: (w, m) => w <= 0.4 && m >= 0.4 },
];
export const NEUTRAL = { label: "Neutral 40 60", code: 3 };
export const GLOCOM_LABELS = [...GLOCOM_RULES.map((r) => r.label), NEUTRAL.label];

/** Band colours: dark green, light green, yellow, light red, dark red. */
export const GLOCOM_BANDS = {
  1: { name: "Dark green", bg: "#14532d", fg: "#ffffff" },
  2: { name: "Light green", bg: "#4ade80", fg: "#052e16" },
  3: { name: "Yellow", bg: "#facc15", fg: "#422006" },
  4: { name: "Light red", bg: "#fca5a5", fg: "#450a0a" },
  5: { name: "Dark red", bg: "#7f1d1d", fg: "#ffffff" },
};
export const glocomBand = (code) => GLOCOM_BANDS[code] || { name: "—", bg: "#4b5563", fg: "#ffffff" };

export function classifyGlocom(w, m6, y) {
  const a = w ?? 0.5, b = m6 ?? 0.5, c = y ?? 0.5;
  for (const r of GLOCOM_RULES) if (r.test(a, b, c)) return { code: r.code, label: r.label };
  return { ...NEUTRAL };
}

/** Same blend the heatmap sorts by inside a band (0..100). */
export const glocomScore = (w, m6, y) => ((w ?? 0.5) * 0.5 + (m6 ?? 0.5) * 0.3 + (y ?? 0.5) * 0.2) * 100;

/** Percentile 0..1 of each value among the non-null ones (ties share their average position). */
export function percentiles(values) {
  const idx = [];
  values.forEach((v, i) => { if (v != null && Number.isFinite(v)) idx.push(i); });
  idx.sort((a, b) => values[a] - values[b]);
  const n = idx.length, out = new Array(values.length).fill(null);
  if (!n) return out;
  for (let i = 0; i < n;) {
    let j = i;
    while (j + 1 < n && values[idx[j + 1]] === values[idx[i]]) j++;
    const p = n > 1 ? ((i + j) / 2) / (n - 1) : 0.5;
    for (let k = i; k <= j; k++) out[idx[k]] = p;
    i = j + 1;
  }
  return out;
}

/**
 * Rate a peer set. items: [{ key, w, m6, y }] (returns as fractions).
 * Returns the items with pW / p6m / p1y, code, label, score and rank (1 = best:
 * band first, then score -- the order the heatmap draws its tiles in).
 */
export function rateGlocom(items) {
  const pw = percentiles(items.map((x) => x.w)), pm = percentiles(items.map((x) => x.m6)), py = percentiles(items.map((x) => x.y));
  const out = items.map((x, i) => {
    const { code, label } = classifyGlocom(pw[i], pm[i], py[i]);
    return { ...x, pW: pw[i], p6m: pm[i], p1y: py[i], code, label, score: glocomScore(pw[i], pm[i], py[i]) };
  });
  const order = out.map((_, i) => i).sort((a, b) => out[a].code - out[b].code || out[b].score - out[a].score || String(out[a].key).localeCompare(String(out[b].key)));
  order.forEach((i, r) => { out[i].rank = r + 1; });
  return out;
}

// ---- returns at checkpoint dates -------------------------------------------------

function atOrBefore(time, d) { // last index with time <= d, or -1
  let lo = 0, hi = time.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (time[mid] <= d) lo = mid + 1; else hi = mid; }
  return lo - 1;
}
function shiftDays(d, n) { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }

export const LOOKBACK_DAYS = { w: 7, m6: 182, y: 365 };

/**
 * 1W / 6M / 1Y returns of one series at each checkpoint date (calendar look-backs,
 * as returns_latest computes them). A checkpoint where the series has no bar
 * within maxStaleDays is null (not trading), so a suspended stock drops out of
 * its group rather than freezing it.
 */
export function checkpointReturns(time, close, checkpoints, { maxStaleDays = 10 } = {}) {
  const out = new Array(checkpoints.length).fill(null);
  if (!time?.length) return out;
  for (let t = 0; t < checkpoints.length; t++) {
    const d = checkpoints[t];
    const k = atOrBefore(time, d);
    if (k < 0 || time[k] < shiftDays(d, -maxStaleDays) || !(close[k] > 0)) continue;
    const r = {};
    for (const [p, days] of Object.entries(LOOKBACK_DAYS)) {
      const j = atOrBefore(time, shiftDays(d, -days));
      // the base bar must itself be near the look-back date, or the window is not covered
      r[p] = j >= 0 && j < k && close[j] > 0 && time[j] >= shiftDays(d, -days - maxStaleDays) ? close[k] / close[j] - 1 : null;
    }
    out[t] = r;
  }
  return out;
}

// ---- group history ----------------------------------------------------------------

/** Accumulates constituent returns per group at each checkpoint (equal-weighted). */
export class GroupAccumulator {
  constructor(checkpoints) { this.dates = checkpoints; this.K = checkpoints.length; this.groups = new Map(); }
  add(group, rets) {
    if (!group || !rets) return;
    let g = this.groups.get(group);
    if (!g) { g = { sum: new Float64Array(this.K * 3), cnt: new Int32Array(this.K * 3), n: new Int32Array(this.K) }; this.groups.set(group, g); }
    for (let t = 0; t < this.K; t++) {
      const r = rets[t];
      if (!r) continue;
      g.n[t]++;
      ["w", "m6", "y"].forEach((p, j) => { if (r[p] != null && Number.isFinite(r[p])) { g.sum[t * 3 + j] += r[p]; g.cnt[t * 3 + j]++; } });
    }
  }
  /**
   * Rate the groups against each other at every checkpoint.
   * -> { dates, of: [groups rated per date], groups: { name: { rank, code, label, score, n, w, m6, y } } }
   * where each field is an array over dates (null where the group had no constituent).
   */
  history() {
    const names = [...this.groups.keys()].sort();
    const K = this.K, groups = {}, of = new Array(K).fill(0);
    const r4 = (v) => (v == null ? null : Math.round(v * 1e4) / 1e4);
    for (const name of names) groups[name] = { rank: new Array(K).fill(null), code: new Array(K).fill(null), label: new Array(K).fill(null), score: new Array(K).fill(null), n: new Array(K).fill(0), w: new Array(K).fill(null), m6: new Array(K).fill(null), y: new Array(K).fill(null), pW: new Array(K).fill(null), p6m: new Array(K).fill(null), p1y: new Array(K).fill(null) };
    for (let t = 0; t < K; t++) {
      const items = [];
      for (const name of names) {
        const g = this.groups.get(name);
        if (!g.n[t]) continue;
        const avg = (j) => (g.cnt[t * 3 + j] ? g.sum[t * 3 + j] / g.cnt[t * 3 + j] : null);
        items.push({ key: name, w: avg(0), m6: avg(1), y: avg(2), n: g.n[t] });
      }
      of[t] = items.length;
      if (items.length < 2) continue; // a rank among fewer than two is meaningless
      for (const x of rateGlocom(items)) {
        const o = groups[x.key];
        o.rank[t] = x.rank; o.code[t] = x.code; o.label[t] = x.label; o.score[t] = Math.round(x.score * 10) / 10; o.n[t] = x.n;
        o.w[t] = r4(x.w); o.m6[t] = r4(x.m6); o.y[t] = r4(x.y);
        o.pW[t] = r4(x.pW); o.p6m[t] = r4(x.p6m); o.p1y[t] = r4(x.p1y);
      }
    }
    return { dates: [...this.dates], of, groups };
  }
}

/**
 * Movement of every group between two checkpoints of a history (default: the last
 * one against the one `back` positions earlier).
 * jump > 0 = moved UP that many places (rank 9 -> 6 is +3); bandMove > 0 = moved
 * to a better band (code 3 -> 2 is +1).
 */
export function groupMoves(hist, back = 1, at = null) {
  if (!hist?.dates?.length) return [];
  const t = at ?? hist.dates.length - 1, p = t - back;
  const out = [];
  for (const [name, g] of Object.entries(hist.groups)) {
    if (g.rank[t] == null) continue;
    const prev = p >= 0 ? g.rank[p] : null;
    const prevCode = p >= 0 ? g.code[p] : null;
    out.push({
      name, rank: g.rank[t], of: hist.of[t], code: g.code[t], label: g.label[t], score: g.score[t], n: g.n[t],
      w: g.w[t], m6: g.m6[t], y: g.y[t], pW: g.pW[t], p6m: g.p6m[t], p1y: g.p1y[t],
      prevRank: prev, prevCode, prevLabel: p >= 0 ? g.label[p] : null,
      jump: prev == null ? null : prev - g.rank[t],
      bandMove: prevCode == null ? null : prevCode - g.code[t],
    });
  }
  return out.sort((a, b) => a.rank - b.rank);
}

/** Dates on which a group changed band or rank, newest first, for its movement log. */
export function groupTimeline(hist, name) {
  const g = hist?.groups?.[name];
  if (!g) return [];
  const out = [];
  for (let t = 1; t < hist.dates.length; t++) {
    if (g.rank[t] == null || g.rank[t - 1] == null) continue;
    const jump = g.rank[t - 1] - g.rank[t], bandMove = g.code[t - 1] - g.code[t];
    if (jump || bandMove) out.push({ date: hist.dates[t], rank: g.rank[t], prevRank: g.rank[t - 1], jump, label: g.label[t], prevLabel: g.label[t - 1], code: g.code[t], prevCode: g.code[t - 1], bandMove });
  }
  return out.reverse();
}
