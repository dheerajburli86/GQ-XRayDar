// Per-underlying, per-session summary of the whole chain: the row that
// rankings, screens, history charts and alerts all read (tas_fo_stats).

import { enrichChain, pcrOverall, pcr, maxPain, oiWalls, atmIv, skewMetrics, termStructure, expectedMove, gex, gexProfile } from "./chain.js";
import { futuresTable, rollover } from "./futures.js";
import { classifyBuildup, zScore } from "./positioning.js";
import { ivRank, volRegime } from "./volatility.js";

const r4 = (x) => (Number.isFinite(x) ? Math.round(x * 1e4) / 1e4 : null);
const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);

/** Summary of one session from the raw day (see chain.js for the shape). */
export function summarizeDay(day, opts = {}) {
  const chain = enrichChain(day, opts);
  const futs = futuresTable(day, opts);
  const near = futs[0] || null;
  const ro = rollover(futs);
  const ex0 = chain.expiries.find((e) => e.rows.length >= 3) || null;
  const ex1 = ex0 ? chain.expiries.find((e) => e.expiry > ex0.expiry && e.rows.length >= 3) : null;
  const all = pcrOverall(chain);
  const p0 = ex0 ? pcr(ex0) : null;
  const mp = ex0 ? maxPain(ex0) : null;
  const walls = ex0 ? oiWalls(ex0, day.spot) : null;
  const sk = ex0 ? skewMetrics(ex0) : null;
  const ts = termStructure(chain);
  const em = ex0 ? expectedMove(ex0, day.spot) : null;
  const gx = ex0 ? gex(ex0, day.spot, day.lot) : null;
  let flip = null;
  if (ex0 && day.kind === "index") { try { flip = gexProfile(chain, { expiries: [ex0.expiry], steps: 31 }).flip; } catch { flip = null; } }
  let callOiChg = 0, putOiChg = 0, optTurnover = 0, optVol = 0, otmCallWrite = 0, otmPutWrite = 0;
  for (const ex of chain.expiries) for (const r of ex.rows) {
    for (const leg of [r.ce, r.pe]) {
      if (!leg) continue;
      if (leg.cp > 0) callOiChg += leg.chgOi || 0; else putOiChg += leg.chgOi || 0;
      optTurnover += (leg.px || 0) * (leg.vol || 0) * (day.lot || 1); optVol += leg.vol || 0; // premium traded, rupees
      // Writing proxy: OTM contracts whose OI rose while their premium fell.
      const otm = leg.cp * (day.spot - r.strike) < 0;
      if (otm && leg.chgOi > 0 && leg.chgPx != null && leg.chgPx < 0) { if (leg.cp > 0) otmCallWrite += leg.chgOi; else otmPutWrite += leg.chgOi; }
    }
  }
  const futOi = futs.reduce((s, f) => s + (f.oi || 0), 0), futOiChg = futs.reduce((s, f) => s + (f.chgOi || 0), 0);
  return {
    date: day.date, und: day.underlying, kind: day.kind, spot: day.spot, spotPrev: day.spotPrev ?? null, lot: day.lot,
    nearExpiry: near?.expiry ?? ex0?.expiry ?? null, nearDte: near?.dte ?? ex0?.dte ?? null,
    fut: near ? { expiry: near.expiry, price: r2(near.price), oi: near.oi, chgOi: near.chgOi, vol: near.vol, pxChg: r4(near.pxChg), basisPct: r4(near.basisPct), carry: r4(near.carry) } : null,
    fut2: futs[1] ? { expiry: futs[1].expiry, price: r2(futs[1].price), oi: futs[1].oi } : null,
    futOi, futOiChg, futOiChgPct: futOi - futOiChg > 0 ? r4(futOiChg / (futOi - futOiChg)) : null,
    rolloverPct: r4(ro?.pct), rollSpreadPct: r4(ro?.spreadPct), rollAnnual: r4(ro?.annualised),
    callOi: all.callOi, putOi: all.putOi, callOiChg, putOiChg, pcrOi: r4(all.oi), pcrVol: r4(all.vol), pcrNear: r4(p0?.oi),
    optVol, optTurnover, otmCallWrite, otmPutWrite,
    maxPain: mp?.strike ?? null, maxPainDistPct: mp?.strike && day.spot ? r4(mp.strike / day.spot - 1) : null,
    callWall: walls?.resistance[0]?.strike ?? null, putWall: walls?.support[0]?.strike ?? null,
    callHhi: r4(walls?.callConcentration.hhi), putHhi: r4(walls?.putConcentration.hhi),
    atmIv: r4(ex0 ? atmIv(ex0) : null), atmIvNext: r4(ex1 ? atmIv(ex1) : null), skew25: r4(sk?.skew25), wing10: r4(sk?.wing10), termInverted: ts.inverted,
    expMovePct: r4(em?.straddlePct), gexTotal: gx ? Math.round(gx.total) : null, gammaFlip: r2(flip),
  };
}

/** History-dependent fields: IV rank / percentile, OI and volume z-scores, build-up, regime. hist: previous summaries (oldest first). */
export function withHistory(s, hist) {
  const ivs = [...hist.map((h) => h.atmIv), s.atmIv];
  const ir = ivRank(ivs, 252);
  const prev = hist[hist.length - 1];
  const spotChg = s.spotPrev > 0 ? s.spot / s.spotPrev - 1 : prev?.spot > 0 ? s.spot / prev.spot - 1 : null;
  const pxChg = s.fut?.pxChg ?? spotChg;
  const vols = hist.slice(-20).map((h) => h.fut?.vol).filter((x) => x > 0);
  const volBase = vols.length ? vols.reduce((a, x) => a + x, 0) / vols.length : null;
  const bu = classifyBuildup({ pxChg, oiChg: s.futOiChgPct, vol: s.fut?.vol, volBaseline: volBase,
    pxHist: hist.slice(-60).map((h) => h.fut?.pxChg).filter(Number.isFinite), oiHist: hist.slice(-60).map((h) => h.futOiChgPct).filter(Number.isFinite) });
  const optVols = hist.slice(-20).map((h) => h.optVol).filter((x) => x > 0);
  const oiPct = (() => { const xs = hist.slice(-252).map((h) => h.futOi).filter((x) => x > 0); return xs.length >= 20 ? xs.filter((x) => x < s.futOi).length / xs.length : null; })();
  // 20-session close-to-close realised vol of the underlying, from the stored spot series.
  const spots = [...hist.slice(-20).map((h) => h.spot), s.spot].filter((x) => x > 0);
  let rv20 = null;
  if (spots.length >= 15) { const rr = []; for (let i = 1; i < spots.length; i++) rr.push(Math.log(spots[i] / spots[i - 1])); const m = rr.reduce((a, x) => a + x, 0) / rr.length; rv20 = Math.sqrt((rr.reduce((a, x) => a + (x - m) ** 2, 0) / (rr.length - 1)) * 252); }
  return {
    ...s, spotChg: r4(spotChg), rv20: r4(rv20), ivRank: r4(ir.rank), ivPct: r4(ir.percentile), ivHistN: ir.n, volRegime: volRegime(ir.percentile).key,
    buildup: bu.key, buildupConf: r4(bu.confidence), oiPercentile: r4(oiPct),
    optVolZ: r4(zScore(s.optVol, optVols)), futVolRatio: volBase ? r4((s.fut?.vol || 0) / volBase) : null,
    pcrZ: r4(zScore(s.pcrOi, hist.slice(-60).map((h) => h.pcrOi).filter(Number.isFinite))),
    maxPainPrev: prev?.maxPain ?? null, callWallPrev: prev?.callWall ?? null, putWallPrev: prev?.putWall ?? null,
  };
}
