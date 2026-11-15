// Price / open-interest interpretation, option writing vs buying, squeeze risk,
// anomalies and conflicts with the technical picture.
//
// Every classification here is a POSSIBLE interpretation with the evidence for
// and against it and a confidence score. Open interest says how many contracts
// are open, not who opened them or why, so nothing is presented as certain.

export const BUILDUP = {
  long_buildup: { label: "Long build-up", dir: 1, read: "Price up with rising open interest: new positions are being added on the way up." },
  short_buildup: { label: "Short build-up", dir: -1, read: "Price down with rising open interest: new positions are being added on the way down." },
  short_covering: { label: "Short covering", dir: 1, read: "Price up with falling open interest: existing short positions are being closed." },
  long_unwinding: { label: "Long unwinding", dir: -1, read: "Price down with falling open interest: existing long positions are being closed." },
  neutral: { label: "No clear change", dir: 0, read: "Price and open interest moved too little to read." },
};

const z = (x, xs) => {
  const v = xs.filter((y) => Number.isFinite(y));
  if (v.length < 5 || !Number.isFinite(x)) return null;
  const m = v.reduce((s, y) => s + y, 0) / v.length;
  const sd = Math.sqrt(v.reduce((s, y) => s + (y - m) ** 2, 0) / (v.length - 1));
  return sd > 0 ? (x - m) / sd : null;
};
export const zScore = z;

/**
 * Classify one session's price / OI change.
 * inp: { pxChg (fraction), oiChg (fraction), vol, volBaseline?, pxHist?:[], oiHist?:[] }
 * thresholds: price 0.25%, OI 1% (below both = neutral)
 */
export function classifyBuildup({ pxChg, oiChg, vol, volBaseline, pxHist = [], oiHist = [] }, { pxMin = 0.0025, oiMin = 0.01 } = {}) {
  if (!Number.isFinite(pxChg) || !Number.isFinite(oiChg)) return { key: "neutral", ...BUILDUP.neutral, confidence: 0, evidence: ["Price or open-interest change missing"], counter: [] };
  let key = "neutral";
  if (Math.abs(pxChg) >= pxMin && Math.abs(oiChg) >= oiMin) key = pxChg > 0 ? (oiChg > 0 ? "long_buildup" : "short_covering") : (oiChg > 0 ? "short_buildup" : "long_unwinding");
  const evidence = [], counter = [];
  let conf = 0;
  if (key !== "neutral") {
    evidence.push(`Price ${(pxChg * 100).toFixed(2)}%, open interest ${(oiChg * 100).toFixed(2)}%`);
    conf = 0.35;
    const zp = z(pxChg, pxHist), zo = z(oiChg, oiHist);
    if (zp != null) { if (Math.abs(zp) >= 1) { conf += 0.15; evidence.push(`Price move ${zp.toFixed(1)} sd vs its own history`); } else counter.push(`Price move is ordinary (${zp.toFixed(1)} sd)`); }
    if (zo != null) { if (Math.abs(zo) >= 1) { conf += 0.2; evidence.push(`OI change ${zo.toFixed(1)} sd vs its own history`); } else counter.push(`OI change is ordinary (${zo.toFixed(1)} sd)`); }
    if (volBaseline > 0 && vol > 0) {
      const vr = vol / volBaseline;
      if (vr >= 1.5) { conf += 0.2; evidence.push(`Volume ${vr.toFixed(1)}x its 20-session average`); }
      else if (vr < 0.7) { conf -= 0.1; counter.push(`Volume only ${vr.toFixed(1)}x its average`); }
    }
    conf = Math.max(0.05, Math.min(0.95, conf));
  }
  return { key, ...BUILDUP[key], confidence: conf, evidence, counter };
}

/**
 * Option positioning for one contract vs the previous session.
 *   OI up   + premium down -> writing likely   (call writing caps upside / put writing supports)
 *   OI up   + premium up   -> buying likely
 *   OI down + premium up   -> writers covering
 *   OI down + premium down -> buyers unwinding
 * IV change and the volume / OI ratio adjust the confidence. Bid / ask trade
 * location is not in end-of-day data, so confidence is capped at 0.8.
 */
export function optionFlow(leg, { ivPrev = null } = {}) {
  if (!leg || !(leg.oi > 0) || !Number.isFinite(leg.chgOi) || leg.chgPx == null) return null;
  const oiUp = leg.chgOi > 0, pxUp = leg.chgPx > 0, side = leg.cp > 0 ? "Call" : "Put";
  const prevOi = leg.oi - leg.chgOi;
  const oiPct = prevOi > 0 ? leg.chgOi / prevOi : null;
  if (Math.abs(leg.chgOi) < Math.max(1, 0.02 * leg.oi) || leg.chgPx === 0) return null;
  const kind = oiUp ? (pxUp ? "buying" : "writing") : (pxUp ? "short_covering" : "unwinding");
  const label = { buying: `${side} buying`, writing: `${side} writing`, short_covering: `${side} short covering`, unwinding: `${side} unwinding` }[kind];
  const evidence = [`OI ${oiUp ? "+" : ""}${leg.chgOi.toLocaleString()}${oiPct != null ? ` (${(oiPct * 100).toFixed(0)}%)` : ""}`, `premium ${pxUp ? "+" : ""}${leg.chgPx.toFixed(2)}`];
  let conf = 0.4;
  if (oiPct != null && Math.abs(oiPct) > 0.2) conf += 0.15;
  if (ivPrev != null && leg.iv != null) {
    const div = leg.iv - ivPrev;
    const consistent = (kind === "writing" && div < 0) || (kind === "buying" && div > 0) || (kind === "short_covering" && div > 0) || (kind === "unwinding" && div < 0);
    evidence.push(`IV ${div >= 0 ? "+" : ""}${(div * 100).toFixed(1)} pts${consistent ? " (consistent)" : " (inconsistent)"}`);
    conf += consistent ? 0.15 : -0.15;
  }
  if (leg.vol > 0 && leg.oi > 0 && leg.vol / leg.oi > 1) { evidence.push(`volume ${(leg.vol / leg.oi).toFixed(1)}x open interest (heavy intraday turnover)`); conf -= 0.05; }
  return { kind, label, confidence: Math.max(0.05, Math.min(0.8, conf)), evidence, note: "End-of-day: whether trades hit the bid or the ask is not known." };
}

/** Squeeze / liquidation risk from accumulated positioning and price behaviour. */
export function squeezeRisk({ buildupHistory = [], pxChg5, oiPercentile }) {
  const recent = buildupHistory.slice(-5);
  const shorts = recent.filter((k) => k === "short_buildup").length, longs = recent.filter((k) => k === "long_buildup").length;
  const out = [];
  if (shorts >= 3 && pxChg5 > 0 && (oiPercentile ?? 0) >= 0.7) out.push({ key: "short_squeeze_risk", label: "Short-squeeze risk", why: `${shorts} short build-up sessions of the last 5, open interest in its top 30%, and price has turned up` });
  if (longs >= 3 && pxChg5 < 0 && (oiPercentile ?? 0) >= 0.7) out.push({ key: "long_liquidation_risk", label: "Long-liquidation risk", why: `${longs} long build-up sessions of the last 5, open interest in its top 30%, and price has turned down` });
  return out;
}

/**
 * Conflicts between positioning and the technical picture. tech is a flat
 * screen row from the technical engine (mmaBullD, rsiD, rscRising_country_D, trendUpD, ...).
 */
export function conflicts(buildup, tech) {
  if (!tech || !buildup || buildup.dir === 0) return [];
  const out = [];
  const up = buildup.dir > 0;
  const say = (cond, txt) => { if (cond) out.push(txt); };
  say(up && tech.mmaBearD, "Positioning reads bullish but the daily moving averages are in bearish order");
  say(!up && tech.mmaBullD, "Positioning reads bearish but the daily moving averages are in bullish order");
  say(up && tech.rsiD != null && tech.rsiD > 75, `Bullish positioning with RSI already ${tech.rsiD?.toFixed(0)} (stretched)`);
  say(!up && tech.rsiD != null && tech.rsiD < 25, `Bearish positioning with RSI already ${tech.rsiD?.toFixed(0)} (stretched)`);
  say(up && tech.rscRising_country_D === false, "Bullish positioning while relative strength vs the market is falling");
  say(!up && tech.rscRising_country_D === true, "Bearish positioning while relative strength vs the market is rising");
  return out;
}

/**
 * Multi-factor conviction score (0-100) for a derivatives signal:
 * persistence across sessions, volume confirmation, z-score magnitude, and
 * agreement with the technical timeframes.
 */
export function signalConviction({ persistence = 0, volumeRatio = null, zMagnitude = null, tfAgree = 0, tfTotal = 0 }) {
  const parts = {
    persistence: Math.min(1, persistence / 3),
    volume: volumeRatio == null ? 0.5 : Math.min(1, Math.max(0, (volumeRatio - 0.7) / 1.3)),
    magnitude: zMagnitude == null ? 0.5 : Math.min(1, Math.abs(zMagnitude) / 2.5),
    timeframes: tfTotal ? tfAgree / tfTotal : 0.5,
  };
  const w = { persistence: 0.3, volume: 0.2, magnitude: 0.25, timeframes: 0.25 };
  const score = Math.round(100 * Object.entries(w).reduce((s, [k, v]) => s + v * parts[k], 0));
  return { score, parts, weights: w };
}

/**
 * Unusual activity across a chain vs its own baseline (end-of-day):
 * volume z-score, volume / OI turnover, OI jumps, premium spent, deep-ITM and far-OTM activity.
 * baseline: Map key -> {vol:[], oi:[]} for the same contract over prior sessions (optional).
 */
export function chainAnomalies(chain, baseline = null, { zMin = 3, voiMin = 2 } = {}) {
  const out = [];
  for (const ex of chain.expiries) for (const r of ex.rows) for (const leg of [r.ce, r.pe]) {
    if (!leg || !(leg.vol > 0)) continue;
    const key = `${ex.expiry}|${r.strike}|${leg.cp}`;
    const b = baseline?.get(key);
    const zv = b ? z(leg.vol, b.vol) : null;
    const voi = leg.oi > 0 ? leg.vol / leg.oi : null;
    const mny = leg.cp * (chain.spot - r.strike) / chain.spot;
    const tags = [];
    if (zv != null && zv >= zMin) tags.push(`volume ${zv.toFixed(1)} sd above its norm`);
    if (voi != null && voi >= voiMin && leg.vol * (chain.lot || 1) * (leg.px || 0) > 0) tags.push(`volume ${voi.toFixed(1)}x open interest`);
    if (leg.chgOi > 0 && leg.oi > 0 && leg.chgOi / Math.max(1, leg.oi - leg.chgOi) > 1) tags.push("open interest more than doubled");
    if (mny > 0.1 && leg.vol > 0) tags.push("deep in the money (often financing or dividend-related)");
    if (mny < -0.12 && ex.dte > 3) tags.push("far out of the money (tail hedge or lottery)");
    if (!tags.length) continue;
    const premium = (leg.px || 0) * leg.vol * (chain.lot || 1);
    out.push({ expiry: ex.expiry, strike: r.strike, type: leg.cp > 0 ? "CE" : "PE", vol: leg.vol, oi: leg.oi, chgOi: leg.chgOi, px: leg.px, iv: leg.iv, premium, zVol: zv, voi, tags });
  }
  return out.sort((a, b) => b.premium - a.premium);
}

/**
 * Flow attribution for an anomaly: directional buying, volatility selling,
 * spread / roll, or tail hedge, with a confidence. Never claims to know who traded.
 */
export function attributeFlow(a, flow) {
  const cands = [];
  if (a.tags.some((t) => t.startsWith("far out"))) cands.push(["Tail hedging", 0.45]);
  if (flow?.kind === "writing") cands.push(["Volatility selling", 0.5 + (flow.confidence - 0.4)]);
  if (flow?.kind === "buying") cands.push(["Directional buying", 0.45 + (flow.confidence - 0.4)]);
  if (a.voi > 3) cands.push(["Spread / rollover or intraday turnover", 0.35]);
  if (a.tags.some((t) => t.startsWith("deep in"))) cands.push(["Financing / dividend play", 0.35]);
  cands.sort((x, y) => y[1] - x[1]);
  const [label, c] = cands[0] || ["Unclassified", 0.1];
  return { label, confidence: Math.max(0.05, Math.min(0.8, c)), alternatives: cands.slice(1).map((x) => x[0]) };
}
