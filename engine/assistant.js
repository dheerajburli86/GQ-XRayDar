// Research assistant: answers questions from the STORED calculations only,
// with the values, their dates and links to the charts behind them. It is a
// deterministic layer over the natural-language parser; when the GQ agent is
// connected it can call the same functions as tools.
import { parseCommand } from "./nl.js";
import { runScreen, FIELD } from "./fields.js";
import { breadthDivergence } from "./breadth.js";
import { EVENT_LABEL } from "./signals.js";
import { WW_TREND_LABEL } from "./weightWatcher.js";
import { fmtPct, fmtMoney } from "./format.js";

const p = (v) => fmtPct(v);

export async function answer(text, d) {
  const cmd = parseCommand(text, { securities: d.secs, countries: d.countries });
  const out = { cmd, blocks: [] };
  const say = (t) => out.blocks.push({ kind: "text", text: t });
  const link = (label, to) => out.blocks.push({ kind: "link", label, to });
  const list = (items) => out.blocks.push({ kind: "list", items });

  if (cmd.intent === "explain" || cmd.intent === "stock" || cmd.intent === "chart") {
    const sec = d.secById.get(cmd.securityId);
    const s = await d.api.snapshot(cmd.securityId);
    if (!s) { say(`I have no stored analysis for ${cmd.symbol}.`); return out; }
    const sn = s.snap, W = sn.tf.W || {}, D = sn.tf.D || {}, M = sn.tf.M || {};
    say(`${sec.symbol} (${sec.name}) · ${sec.country}, ${sec.sector}${sec.capSegment ? `, ${sec.capSegment} cap` : ""}. Data as of ${sn.asOf}: close ${sn.close} ${sec.currency}${sec.capUsdNow ? `, market cap ${fmtMoney(sec.capUsdNow)} (estimated)` : ""}.`);
    say(`Returns (local): 1W ${p(sn.ret["1W"])}, 1M ${p(sn.ret["1M"])}, 3M ${p(sn.ret["3M"])}, 12M ${p(sn.ret["12M"])}. In USD 3M ${p(sn.retUsd["3M"])}.`);
    say(`Trend: weekly MMA ${W.mma}${W.bullBars ? ` (bullish for ${W.bullBars} weeks)` : ""}, daily ${D.mma}, monthly ${M.mma}${sn.tfShift ? ` — ${sn.tfShift}` : ""}. Weekly RSI ${W.rsi} (RSI of RSI ${W.rsi2}); daily RSI ${D.rsi}.`);
    const rc = sn.rsc;
    const rl = [];
    for (const [k, l] of [["country", "its country"], ["countrySector", "its sector"], ["region", "its region"], ["global", "global"]]) {
      const r = rc[k]; if (!r?.W) continue;
      rl.push(`vs ${l}: ${r.W.rising ? "rising" : r.W.falling ? "falling" : "flat"} weekly, 3M ${p(r.D?.chg?.["3M"])}${r.W.turnUp ? ", upward inflection" : ""}${r.W.atHigh ? ", at a 52-week RSC high" : ""}`);
    }
    if (rl.length) { say("Relative strength:"); list(rl); }
    if (rc.country?.W?.divergence) say(`Price vs RSC divergence on the weekly: ${rc.country.W.divergence}.`);
    say(`Stage: ${sn.stage.label}${sn.stage.evidence.length ? ` — ${sn.stage.evidence.join("; ")}` : ""}.`);
    const day = sn.day;
    say(`Levels: ${p(day.pctFromHigh52)} from the 52-week high, ${p(day.pctFromAth)} from the all-time high; volume ${day.volRatio}x its 50-day average; up/down volume ${day.udRatio}${day.accumulation ? " (accumulation)" : day.distribution ? " (distribution)" : ""}.`);
    if (s.ww) say(`Weight Watcher: ${s.ww.last != null ? `${s.ww.last.toFixed(2)}% of its country-sector CW index` : ""}, ${WW_TREND_LABEL[s.ww.trend] || s.ww.trend}${s.ww.change4 != null ? ` (${p(s.ww.change4 * 100)} over 4 quarters)` : ""}.`);
    if (s.f) say(`Fundamentals (${s.f.basis}, to ${s.f.asOf}): revenue growth ${p(s.f.revenueGrowthYoY)}, EPS growth ${p(s.f.epsGrowthYoY)}, operating margin ${s.f.operatingMargin ?? "—"}%, ROE ${s.f.roe ?? "—"}%${s.f.pe ? `, P/E ${s.f.pe}` : ""}${s.f.improving ? " — improving" : s.f.deteriorating ? " — deteriorating" : ""}.`);
    if (s.score) {
      say(`AI setup score ${s.score.total}/100: ${Object.entries(s.score.components).filter(([, c]) => c.score != null).map(([k, c]) => `${k} ${c.score}`).join(", ")}.`);
      if (s.score.conflicts?.length) say(`Conflicts: ${s.score.conflicts.join("; ")}.`);
    }
    const ev = (await d.api.events(cmd.securityId)).slice(-4).reverse();
    if (ev.length) { say("Most recent inflections:"); list(ev.map((e) => `${e.date}: ${EVENT_LABEL[e.type] || e.type}${e.fwd?.["1M"] != null ? ` → ${p(e.fwd["1M"])} over the next month` : ""}`)); }
    link("Open RSIMMA screen", `screens/RSIMMA/${sec.id}`); link("Open RSCACC screen", `screens/RSCACC/${sec.id}`); link("Stock page", `stock/${sec.id}`);
    say("Descriptive analysis of stored data, not a recommendation.");
    return out;
  }

  if (cmd.intent === "screen") {
    let rows = runScreen(d.rows, { conditions: cmd.conditions, scope: { country: cmd.scope.country, region: cmd.scope.region, classification: cmd.scope.classification, sector: cmd.scope.sector, industryGroup: cmd.scope.industryGroup, cap: cmd.scope.cap, assetClass: cmd.scope.assetClass } });
    // sort: what was asked; otherwise the first numeric condition asked about (largest first), else the AI setup score
    const sf = cmd.sort?.field || cmd.conditions.find((c) => FIELD[c.field] && ["num", "pct", "money"].includes(FIELD[c.field].type))?.field || "score";
    const val = (r, f) => { const v = FIELD[f]?.get(r); return Number.isFinite(v) ? v : null; };
    rows = [...rows].sort((a, b) => (val(b, sf) ?? -1e18) - (val(a, sf) ?? -1e18));
    if (cmd.sort?.dir === "asc") rows.reverse();
    const lim = cmd.limit || 25;
    const noun = cmd.scope.assetClass === "ETF" ? "ETFs" : cmd.scope.assetClass === "Stock" ? "stocks" : "instruments";
    say(`${rows.length} ${noun} match: ${cmd.understood.join(" · ") || "no filters"}. Data as of ${d.info.asOf}.${rows.length > lim ? ` Showing the top ${lim}, by ${FIELD[sf]?.label || sf}:` : ""}`);
    if (!rows.length) say("Nothing passes every condition. Loosen one of them (for example a lower score or a smaller market cap) and ask again.");
    // every value the question asked about, per row, so the answer can be checked at a glance
    const shownF = [...new Set([...cmd.conditions.map((c) => c.field), sf])].filter((f) => FIELD[f]).slice(0, 5);
    list(rows.slice(0, lim).map((r) => `${r.sec.symbol} · ${r.sec.name || ""} (${r.sec.country}, ${r.sec.sector || r.sec.assetClass || ""}) — ${shownF.map((f) => `${FIELD[f].label}: ${fmtVal(FIELD[f], FIELD[f].get(r))}`).join("; ")}`));
    link("Open in the screener", `screener?q=${encodeURIComponent(text)}`);
    return out;
  }

  const scopeKey = cmd.scope.country ? `C:${cmd.scope.country}` : cmd.scope.region ? `R:${cmd.scope.region}` : "G";
  const scopeName = cmd.scope.country || cmd.scope.region || "global";
  if (cmd.intent === "rotation") {
    const r = await d.api.rotation(scopeKey);
    if (!r) { say(`No rotation data for ${scopeName}.`); return out; }
    say(`Sector rotation in ${scopeName} (weekly, as of ${r[0]?.tail.at(-1)?.date}):`);
    list(["Leading", "Improving", "Weakening", "Lagging"].map((q) => `${q}: ${r.filter((s) => s.quadrant === q).map((s) => `${s.name} (${s.ratio}/${s.mom})`).join(", ") || "none"}`));
    const moves = r.flatMap((s) => s.transitions.slice(-1).map((t) => `${s.name}: ${t.from} → ${t.to} on ${t.date}`));
    if (moves.length) { say("Latest quadrant changes:"); list(moves); }
    link("Open sector rotation", "rotation");
    return out;
  }
  if (cmd.intent === "breadth") {
    const b = await d.api.breadth(scopeKey);
    const idx = await d.api.indexSeries(`CW|${scopeKey.startsWith("C:") ? "LCL" : "USD"}|${scopeKey}`);
    if (!b) { say(`No breadth data for ${scopeName}.`); return out; }
    const n = b.dates.length - 1;
    say(`Breadth in ${scopeName} on ${b.dates[n]}: ${b.pct50[n]}% above the 50-day EMA (${p(b.pct50[n] - b.pct50[Math.max(0, n - 21)]).replace("%", " pts")} over a month), ${b.pct200[n]}% above the 200-day; ${b.adv[n]} advancers vs ${b.dec[n]} decliners; ${b.newHigh[n]} new 52-week highs vs ${b.newLow[n]} lows; ${b.pctBullMma[n] ?? "—"}% with a bullish weekly MMA.`);
    const dv = breadthDivergence(idx, b);
    if (dv) say(dv.flag ? `Breadth divergence: the index is up ${p(dv.indexChg)} over ${dv.bars} sessions while ${dv.reasons.join("; ")}.` : `No breadth divergence over the last ${dv.bars} sessions.`);
    link("Open market breadth", `breadth?scope=${encodeURIComponent(scopeKey)}`);
    return out;
  }
  if (cmd.intent === "regime") {
    const items = Object.entries(d.regimes).filter(([k]) => k === `CW|USD|${scopeKey}` || k === `CW|LCL|${scopeKey}` || (scopeKey === "G" && /^CW\|USD\|R:[^|]+$/.test(k)));
    if (!items.length) { say(`No regime data for ${scopeName}.`); return out; }
    list(items.map(([, v]) => `${v.name}: ${v.label} — efficiency ratio ${v.er}, realised vol ${v.volNow}% (percentile ${v.volPctile}) as of ${v.asOf}`));
    return out;
  }
  if (cmd.intent === "navigate") { link(`Open ${cmd.page}`, cmd.page); return out; }
  say("I answer from the stored calculations. Try:");
  list(["explain <SYMBOL>", "show strongest weekly IT stocks with improving relative strength", "which sectors are leading in Europe", "market breadth in India", "large cap Japanese stocks near 52 week high with unusual volume", "what is the regime in Asia"]);
  return out;
}
function fmtVal(f, v) { if (v == null) return "—"; if (!f) return String(v); if (f.type === "pct") return fmtPct(v); if (f.type === "money") return fmtMoney(v); if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(2); return String(v); }
