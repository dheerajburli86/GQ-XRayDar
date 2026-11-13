// Market briefs: daily / weekly / monthly summaries written from stored
// calculations only. Every sentence carries its number and its date, and no
// sentence makes a recommendation -- it describes what the data shows.

const H = { daily: { bars: 1, label: "day", ret: "1D" }, weekly: { bars: 5, label: "week", ret: "1W" }, monthly: { bars: 21, label: "month", ret: "1M" } };
const pct = (v, d = 1) => (v == null ? "n/a" : `${v > 0 ? "+" : ""}${v.toFixed(d)}%`);
const chg = (s, bars) => {
  if (!s?.level?.length) return null;
  const n = s.level.length - 1;
  return n - bars >= 0 ? (s.level[n] / s.level[n - bars] - 1) * 100 : null;
};

/**
 * inputs: {
 *   asOf, period: "daily"|"weekly"|"monthly",
 *   global: {CW, EW},                      index series (USD)
 *   regions: [{name, series}], countries: [{name, series}]   CW USD
 *   breadth: {global: rec, regions: {name: rec}}
 *   rotation: [...] (global scope), regimes: {key: {...}}, ewcwGlobal: summary
 *   rows: screen rows (sec + flat)
 * }
 */
export function writeBrief(inp) {
  const p = H[inp.period] || H.weekly;
  const sections = [];
  const g = chg(inp.global?.CW, p.bars), ge = chg(inp.global?.EW, p.bars);
  const lines = [];
  if (g != null) lines.push(`The global CW equity index moved ${pct(g)} over the ${p.label} to ${inp.asOf}; the equal-weighted index moved ${pct(ge)}${g != null && ge != null ? ` (${ge > g ? "broader participation than the cap-weighted leaders" : ge < g ? "large caps led the equal-weighted average" : "in line"})` : ""}.`);
  const reg = (inp.regions || []).map((r) => ({ name: r.name, c: chg(r.series, p.bars) })).filter((r) => r.c != null).sort((a, b) => b.c - a.c);
  if (reg.length) lines.push(`Regions (USD): ${reg.map((r) => `${r.name} ${pct(r.c)}`).join(", ")}.`);
  const ctr = (inp.countries || []).map((r) => ({ name: r.name, c: chg(r.series, p.bars) })).filter((r) => r.c != null).sort((a, b) => b.c - a.c);
  if (ctr.length >= 4) lines.push(`Strongest countries: ${ctr.slice(0, 3).map((r) => `${r.name} ${pct(r.c)}`).join(", ")}. Weakest: ${ctr.slice(-3).reverse().map((r) => `${r.name} ${pct(r.c)}`).join(", ")}.`);
  sections.push({ title: "Performance", lines });

  const b = inp.breadth?.global;
  if (b?.dates?.length) {
    const n = b.dates.length - 1, k = Math.max(0, n - p.bars);
    const bl = [];
    bl.push(`${b.pct50[n]}% of stocks trade above their 50-day EMA (${pct(b.pct50[n] - b.pct50[k], 1).replace("%", " pts")} over the ${p.label}); ${b.pct200[n]}% above the 200-day.`);
    const nh = sum(b.newHigh, k + 1, n), nl = sum(b.newLow, k + 1, n);
    bl.push(`New 52-week highs vs lows over the ${p.label}: ${nh} vs ${nl}. Advance/decline line ${b.adLine[n] - b.adLine[k] >= 0 ? "rose" : "fell"} by ${Math.abs(b.adLine[n] - b.adLine[k])}.`);
    if (b.pctBullMma?.[n] != null) bl.push(`${b.pctBullMma[n]}% of stocks have a bullish weekly MMA alignment.`);
    if (inp.divergence?.flag) bl.push(`Breadth divergence: the global index rose ${pct(inp.divergence.indexChg)} over ${inp.divergence.bars} sessions while ${inp.divergence.reasons.join("; ")}.`);
    sections.push({ title: "Breadth", lines: bl });
  }

  if (inp.rotation?.length) {
    const by = (q) => inp.rotation.filter((s) => s.quadrant === q).map((s) => s.name);
    const rl = [];
    for (const q of ["Leading", "Improving", "Weakening", "Lagging"]) { const xs = by(q); if (xs.length) rl.push(`${q}: ${xs.join(", ")}.`); }
    const moved = inp.rotation.flatMap((s) => (s.transitions || []).filter((t) => t.date >= (inp.sinceDate || "")).map((t) => `${s.name} ${t.from} -> ${t.to}`));
    if (moved.length) rl.push(`Quadrant changes: ${moved.slice(0, 8).join("; ")}.`);
    sections.push({ title: "Global sector rotation (vs global CW)", lines: rl });
  }

  if (inp.regimes) {
    const r = Object.entries(inp.regimes).filter(([k]) => /^CW\|USD\|(G|R:[^|]+)$/.test(k)).map(([, v]) => `${v.name.replace(" CW (USD)", "")}: ${v.label} (efficiency ${v.er}, vol percentile ${v.volPctile})`);
    if (r.length) sections.push({ title: "Market regime", lines: r });
  }
  if (inp.ewcwGlobal) sections.push({ title: "Participation (EW vs CW)", lines: [`Global EW/CW: ${inp.ewcwGlobal.label}; ratio change 1M ${pct(inp.ewcwGlobal.chg?.["1M"])}, 3M ${pct(inp.ewcwGlobal.chg?.["3M"])}.`] });

  const rows = inp.rows || [];
  if (rows.length) {
    const key = p.ret === "1D" ? null : `ret${p.ret}`;
    const ml = [];
    if (key) {
      const s = rows.filter((r) => r.flat?.[key] != null && (r.sec.capUsdNow || 0) > 0).sort((a, b) => b.flat[key] - a.flat[key]);
      ml.push(`Top movers (local currency, ${p.ret}): ${s.slice(0, 5).map((r) => `${r.sec.symbol} ${pct(r.flat[key])}`).join(", ")}.`);
      ml.push(`Bottom movers: ${s.slice(-5).reverse().map((r) => `${r.sec.symbol} ${pct(r.flat[key])}`).join(", ")}.`);
    }
    const bo = rows.filter((r) => r.flat?.breakoutVolume).length, hi = rows.filter((r) => r.flat?.atHigh52).length;
    ml.push(`${hi} stocks closed at a 52-week high on ${inp.asOf}; ${bo} broke out on volume.`);
    const wwUp = rows.filter((r) => r.flat?.wwTrend === "turn_up_from_low").map((r) => r.sec.symbol);
    if (wwUp.length) ml.push(`Weight Watcher turns up from a prolonged low: ${wwUp.slice(0, 10).join(", ")}${wwUp.length > 10 ? ` and ${wwUp.length - 10} more` : ""}.`);
    const early = rows.filter((r) => r.flat?.stageId >= 4 && r.flat?.stageId <= 6).length;
    ml.push(`${early} stocks are in an early-stage setup (RSC turn, breakout or volume-confirmed breakout).`);
    sections.push({ title: "Stocks", lines: ml });
  }
  return { title: `${inp.period[0].toUpperCase()}${inp.period.slice(1)} market brief`, asOf: inp.asOf, sections, note: "Generated from stored calculations; descriptive only, not investment advice." };
}
const sum = (a, i, j) => { let s = 0; for (let k = Math.max(0, i); k <= j; k++) s += a?.[k] || 0; return s; };
