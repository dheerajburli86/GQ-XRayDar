// Risk coach: reads the user's own trade journal (only with their consent,
// which the page asks for) and reports behaviour patterns and the market
// regimes in which their trades worked. Rule-based and explainable; every
// finding states the entries it rests on.
//
// Entry: { id, at, exitAt, tag, view, lots, plannedMaxLoss, pnl, fees,
//          snapshot: { volRegime, ivPct, buildup, eventDays }, adjustments: [] }

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const days = (a, b) => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 86400000) : null);
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

function groupStats(closed, keyOf) {
  const m = new Map();
  for (const e of closed) { const k = keyOf(e); if (k == null || k === "") continue; const g = m.get(k) || { key: k, n: 0, wins: 0, pnl: 0 }; g.n++; g.pnl += e.pnl; if (e.pnl > 0) g.wins++; m.set(k, g); }
  return [...m.values()].map((g) => ({ ...g, winRate: g.wins / g.n, avg: g.pnl / g.n })).sort((a, b) => b.pnl - a.pnl);
}

export function coachReport(entries, { minEntries = 5 } = {}) {
  const closed = (entries || []).filter((e) => Number.isFinite(e.pnl));
  if (closed.length < minEntries) return { ready: false, findings: [], note: `Log at least ${minEntries} closed entries (with P&L) to see patterns; ${closed.length} so far.` };
  const wins = closed.filter((e) => e.pnl > 0), losses = closed.filter((e) => e.pnl <= 0);
  const net = (e) => e.pnl - (e.fees || 0);
  const findings = [];
  const add = (severity, title, detail, ids) => findings.push({ severity, title, detail, entries: ids });
  const avgW = mean(wins.map((e) => e.pnl)), avgL = mean(losses.map((e) => e.pnl));
  const pf = losses.length ? wins.reduce((s, e) => s + e.pnl, 0) / -losses.reduce((s, e) => s + e.pnl, 0) : null;
  const summary = { n: closed.length, winRate: wins.length / closed.length, avgWin: avgW, avgLoss: avgL, profitFactor: pf, expectancy: mean(closed.map(net)), fees: closed.reduce((s, e) => s + (e.fees || 0), 0) };

  // 1. Losers held past the planned maximum loss.
  const past = losses.filter((e) => e.plannedMaxLoss > 0 && -e.pnl > e.plannedMaxLoss * 1.05);
  if (past.length) add("high", "Losses ran past the planned maximum", `${past.length} of ${losses.filter((e) => e.plannedMaxLoss > 0).length} losing entries with a planned max loss closed beyond it, by ${Math.round(mean(past.map((e) => -e.pnl / e.plannedMaxLoss - 1)) * 100)}% on average.`, past.map((e) => e.id));
  // 2. Holding losers longer than winners (disposition effect).
  const hw = median(wins.map((e) => days(e.at, e.exitAt)).filter((x) => x != null)), hl = median(losses.map((e) => days(e.at, e.exitAt)).filter((x) => x != null));
  if (hw != null && hl != null && hl > 1.5 * Math.max(1, hw)) add("medium", "Losers are held longer than winners", `Median holding period ${hl} days for losses against ${hw} for wins: profits are taken quickly while losses are given time.`, losses.map((e) => e.id));
  // 3. Over-sizing before events.
  const sizes = closed.map((e) => e.lots).filter((x) => x > 0), med = median(sizes);
  const evBig = closed.filter((e) => e.snapshot?.eventDays != null && e.snapshot.eventDays <= 5 && e.lots > 1.5 * (med || 0));
  if (med && evBig.length >= 2) add("high", "Larger size close to events", `${evBig.length} entries opened within 5 days of a result or policy event were more than 1.5x your median size (${med} lots); their combined P&L ${Math.round(evBig.reduce((s, e) => s + e.pnl, 0))}.`, evBig.map((e) => e.id));
  // 4. Size increases after a loss (revenge sizing).
  const byDate = [...closed].sort((a, b) => (a.exitAt || a.at) < (b.exitAt || b.at) ? -1 : 1);
  const revenge = []; for (let i = 1; i < byDate.length; i++) if (byDate[i - 1].pnl < 0 && byDate[i].lots > 1.5 * (byDate[i - 1].lots || Infinity)) revenge.push(byDate[i].id);
  if (revenge.length >= 2) add("medium", "Size goes up straight after a loss", `${revenge.length} times the next trade after a loss was more than 1.5x the size of the losing one.`, revenge);
  // 5. Costs eating the edge.
  if (summary.fees > 0 && summary.fees > 0.3 * Math.abs(closed.reduce((s, e) => s + e.pnl, 0))) add("medium", "Costs are a large share of results", `Fees and taxes ${Math.round(summary.fees)} are more than 30% of the gross P&L.`, closed.map((e) => e.id));
  // 6. Too many adjustments on losers.
  const adj = losses.filter((e) => (e.adjustments || []).length >= 3);
  if (adj.length >= 2) add("low", "Repeated adjustments on losing trades", `${adj.length} losing entries were adjusted three or more times; consider a rule to close instead after the second adjustment.`, adj.map((e) => e.id));

  const byRegime = groupStats(closed, (e) => e.snapshot?.volRegime);
  const byTag = groupStats(closed, (e) => e.tag);
  const byView = groupStats(closed, (e) => e.view);
  const best = byRegime.filter((g) => g.n >= 3).sort((a, b) => b.avg - a.avg)[0], worst = byRegime.filter((g) => g.n >= 3).sort((a, b) => a.avg - b.avg)[0];
  if (best && worst && best.key !== worst.key) add("info", "Regimes where your trades worked", `Best average result in the "${best.key}" volatility regime (${best.n} trades, ${Math.round(best.winRate * 100)}% won); worst in "${worst.key}" (${worst.n} trades, ${Math.round(worst.winRate * 100)}% won).`, []);
  if (!findings.length) add("info", "No behaviour pattern flagged", "None of the checks fired on the logged entries.", []);
  return { ready: true, summary, findings, byRegime, byTag, byView, note: "Rule-based analysis of your own entries; each finding lists the entries behind it." };
}

/** Short post-trade review of one closed entry. */
export function postTradeReview(e) {
  if (!Number.isFinite(e.pnl)) return "Still open.";
  const out = [];
  out.push(e.pnl > 0 ? `Closed with a profit of ${Math.round(e.pnl)}.` : `Closed with a loss of ${Math.round(-e.pnl)}.`);
  if (e.plannedMaxLoss > 0) out.push(-e.pnl > e.plannedMaxLoss ? `The loss passed the planned maximum of ${e.plannedMaxLoss}.` : "Stayed within the planned maximum loss.");
  if (e.fees) out.push(`Costs ${Math.round(e.fees)} (${e.pnl ? Math.round((e.fees / Math.abs(e.pnl)) * 100) : 0}% of the result).`);
  if (e.snapshot?.volRegime) out.push(`Opened in a "${e.snapshot.volRegime}" volatility regime${e.snapshot.ivPct != null ? ` (IV percentile ${Math.round(e.snapshot.ivPct * 100)}%)` : ""}.`);
  if (e.snapshot?.eventDays != null && e.snapshot.eventDays <= 5) out.push(`An event was ${e.snapshot.eventDays} day(s) away at entry.`);
  if ((e.adjustments || []).length) out.push(`${e.adjustments.length} adjustment(s) logged.`);
  return out.join(" ");
}
