// AI setup score: a transparent composite, not a black box. Every component
// lists the evidence and thresholds that produced it; a component with no data
// is marked unavailable and its weight is re-spread over the others (shown in
// `weightsUsed`), never silently scored as zero or as average.

import { METHODOLOGY } from "./methodology.js";

const clamp = (v) => Math.max(0, Math.min(100, v));

function technical(s) {
  const ev = [];
  let pts = 0, max = 0;
  const add = (cond, p, text, neg) => { max += p; if (cond) { pts += p; ev.push({ ok: true, text }); } else if (neg) ev.push({ ok: false, text: neg }); };
  const W = s.tf?.W || {}, D = s.tf?.D || {};
  add(W.mma === "bull", 25, "Weekly MMA in bullish alignment", W.mma === "bear" ? "Weekly MMA in bearish alignment" : "Weekly MMA not aligned");
  add(D.mma === "bull" || D.mma === "above", 15, "Daily short MMA above long MMA", "Daily short MMA not above long MMA");
  add(s.day?.above200, 10, "Price above 200-day EMA", "Price below 200-day EMA");
  add(s.day?.above50, 10, "Price above 50-day EMA", "Price below 50-day EMA");
  add(D.rsi >= 50 && D.rsi <= 75, 10, `Daily RSI ${D.rsi} in the 50-75 trend zone`, D.rsi > 75 ? `Daily RSI ${D.rsi} stretched (>75)` : `Daily RSI ${D.rsi} below 50`);
  add(s.day?.nearHigh52, 10, "Within 5% of the 52-week high", null);
  add(D.breakoutRecent || W.breakoutRecent || W.postConsBreak, 10, "Recent breakout", null);
  add(s.day?.accumulation, 10, `Accumulation: up/down volume ${s.day?.udRatio}`, s.day?.distribution ? `Distribution: up/down volume ${s.day?.udRatio}` : null);
  return { score: max ? clamp((pts / max) * 100) : null, evidence: ev, thresholds: "MMA alignment, 50/200 EMA, RSI 50-75, 52W proximity, breakout, up/down volume >= 1.25" };
}

function relative(s, rsRank) {
  const ev = [];
  const parts = [];
  for (const [bk, label] of [["country", "country"], ["countrySector", "sector"], ["global", "global"]]) {
    const r = s.rsc?.[bk];
    if (!r?.W) continue;
    let p = 0;
    if (r.W.rising) { p += 40; ev.push({ ok: true, text: `Weekly RSC vs ${label} rising` }); } else ev.push({ ok: false, text: `Weekly RSC vs ${label} not rising` });
    if (r.W.atHigh) { p += 30; ev.push({ ok: true, text: `RSC vs ${label} at a 52-week high` }); }
    if (r.W.turnUp) { p += 20; ev.push({ ok: true, text: `RSC vs ${label} upward inflection` }); }
    if ((r.D?.chg?.["3M"] ?? 0) > 0) { p += 10; ev.push({ ok: true, text: `RSC vs ${label} +${r.D.chg["3M"]}% over 3M` }); }
    parts.push(Math.min(100, p));
  }
  if (rsRank != null) { parts.push(rsRank); ev.push({ ok: rsRank >= 50, text: `RS rank ${rsRank} (percentile within country)` }); }
  if (!parts.length) return { score: null, evidence: [{ ok: false, text: "No benchmark series" }] };
  return { score: clamp(parts.reduce((a, b) => a + b, 0) / parts.length), evidence: ev, thresholds: "RSC rising (EMA10 slope), 52-bar RSC high, inflection after >= 6 falling bars" };
}

function participation(ctx) {
  if (ctx?.sectorPct50 == null) return { score: null, evidence: [{ ok: false, text: "No sector breadth" }] };
  const p = ctx.sectorPct50;
  return { score: clamp(p), evidence: [{ ok: p >= 50, text: `${p}% of the stock's country-sector trade above their 50-day EMA` }], thresholds: "Sector % above 50-DMA, linear" };
}

function fundamentals(f, pctl) {
  if (!f) return { score: null, evidence: [{ ok: false, text: "No fundamental data" }] };
  const ev = [], parts = [];
  for (const [k, label] of [["revenueGrowthYoY", "Revenue growth"], ["epsGrowthYoY", "EPS growth"], ["operatingMargin", "Operating margin"], ["roe", "ROE"]]) {
    const v = pctl?.[k];
    if (v == null) continue;
    parts.push(v);
    ev.push({ ok: v >= 50, text: `${label} ${f[k]}${k === "roe" || k.includes("Margin") || k.includes("Growth") ? "%" : ""} (percentile ${v})` });
  }
  if (f.improving) { parts.push(80); ev.push({ ok: true, text: "Fundamentals improving (growth accelerating / margins expanding)" }); }
  if (f.deteriorating) { parts.push(20); ev.push({ ok: false, text: "Fundamentals deteriorating" }); }
  if (!parts.length) return { score: null, evidence: [{ ok: false, text: "Fundamental metrics incomplete" }] };
  return { score: clamp(parts.reduce((a, b) => a + b, 0) / parts.length), evidence: ev, thresholds: "Percentiles within the screened population" };
}

function catalysts(ctx) {
  // No catalyst feed is connected yet (Finxray news / results calendar).
  if (!ctx?.catalysts) return { score: null, evidence: [{ ok: false, text: "No catalyst feed connected (Finxray pending)" }] };
  return { score: ctx.catalysts.score, evidence: ctx.catalysts.evidence };
}

function timeframe(s) {
  const st = s.mmaTf || {};
  const tfs = ["D", "W", "M"].filter((k) => st[k]);
  if (!tfs.length) return { score: null, evidence: [] };
  const bull = tfs.filter((k) => st[k] === "bull").length;
  const bear = tfs.filter((k) => st[k] === "bear").length;
  const ev = tfs.map((k) => ({ ok: st[k] === "bull", text: `${{ D: "Daily", W: "Weekly", M: "Monthly" }[k]} MMA ${st[k]}` }));
  if (s.tfShift) ev.push({ ok: null, text: s.tfShift });
  return { score: clamp(((bull - bear * 0.5) / tfs.length) * 100), evidence: ev, thresholds: "Share of D/W/M timeframes with bullish MMA" };
}

/** row: {snap, f}; ctx: {rsRank, sectorPct50, fundPct, catalysts}; weights override optional. */
export function scoreSetup(row, ctx = {}, weights = METHODOLOGY.scoring.weights) {
  const s = row.snap;
  if (!s) return null;
  const comps = {
    technical: technical(s),
    relative: relative(s, ctx.rsRank),
    participation: participation(ctx),
    fundamentals: fundamentals(row.f, ctx.fundPct),
    catalysts: catalysts(ctx),
    timeframe: timeframe(s),
  };
  const avail = Object.keys(comps).filter((k) => comps[k].score != null);
  const wsum = avail.reduce((a, k) => a + (weights[k] || 0), 0);
  const weightsUsed = {};
  let total = 0;
  for (const k of Object.keys(comps)) {
    const w = comps[k].score != null && wsum > 0 ? (weights[k] || 0) / wsum : 0;
    weightsUsed[k] = Math.round(w * 1000) / 1000;
    comps[k].weight = weights[k] || 0; comps[k].weightUsed = weightsUsed[k];
    comps[k].available = comps[k].score != null;
    if (comps[k].score != null) { comps[k].score = Math.round(comps[k].score); total += w * comps[k].score; }
  }
  // conflicts: strong components pointing opposite ways
  const conflicts = [];
  if (comps.technical.score != null && comps.relative.score != null && Math.abs(comps.technical.score - comps.relative.score) >= 50)
    conflicts.push(comps.technical.score > comps.relative.score ? "Price trend strong but relative strength weak" : "Relative strength strong but price trend weak");
  if (comps.fundamentals.score != null && comps.technical.score != null && Math.abs(comps.fundamentals.score - comps.technical.score) >= 50)
    conflicts.push(comps.fundamentals.score > comps.technical.score ? "Fundamentals strong but technicals weak" : "Technicals strong but fundamentals weak");
  if (s.agreement === "conflict") conflicts.push(`Indicators disagree: ${s.bullSignals.length} bullish vs ${s.bearSignals.length} bearish`);
  if (s.tfShift) conflicts.push(s.tfShift);
  return { total: Math.round(total), components: comps, weightsUsed, conflicts, asOf: s.asOf };
}

export const SCORE_COMPONENTS = ["technical", "relative", "participation", "fundamentals", "catalysts", "timeframe"];
