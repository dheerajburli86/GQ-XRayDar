// Flat export of the stored GLOCOM / LOCOM group history (tas_glocom_group), one row per date x group.
// Scope keys: 'G|industry' | 'G|sector' | 'G|country' (global, USD) and 'C:<country>|industry' | 'C:<country>|sector'.
// Fractions everywhere (0.052 = 5.2%); percentiles are 0-1 among the groups rated that day.
export const GLOCOM_EXPORT_COLUMNS = ["date", "market", "level", "group", "band", "band_code", "rank", "rated_groups", "score", "stocks", "ret_1w", "ret_6m", "ret_1y", "pctile_1w", "pctile_6m", "pctile_1y"];

export function scopeParts(key) {
  const [head, level = ""] = String(key).split("|");
  const market = head === "G" ? "Global" : head.replace(/^C:/, "");
  return { market, level };
}

/** history = the object stored in tas_glocom_group.data ({dates, of, groups}); -> array of row objects, oldest date first. */
export function glocomHistoryRows(scopeKey, history) {
  if (!history?.dates || !history.groups) return [];
  const { market, level } = scopeParts(scopeKey);
  const rows = [];
  history.dates.forEach((date, t) => {
    for (const [group, g] of Object.entries(history.groups)) {
      if (!g.n?.[t]) continue; // group had no stock that day
      rows.push({ date, market, level, group, band: g.label?.[t] ?? "", band_code: g.code?.[t] ?? "", rank: g.rank?.[t] ?? "", rated_groups: history.of?.[t] ?? "", score: g.score?.[t] ?? "", stocks: g.n[t], ret_1w: g.w?.[t] ?? "", ret_6m: g.m6?.[t] ?? "", ret_1y: g.y?.[t] ?? "", pctile_1w: g.pW?.[t] ?? "", pctile_6m: g.p6m?.[t] ?? "", pctile_1y: g.p1y?.[t] ?? "" });
    }
  });
  return rows;
}

const cell = (v) => { const s = String(v ?? ""); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function toCsv(rows, columns = GLOCOM_EXPORT_COLUMNS) {
  return [columns.join(","), ...rows.map((r) => columns.map((c) => cell(r[c])).join(","))].join("\n") + "\n";
}
