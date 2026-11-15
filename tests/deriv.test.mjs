// Derivatives engine, custom indices, new timeframes and cross-asset maths.
import { test } from "node:test";
import assert from "node:assert/strict";
import { gbs, impliedVol, crr, baw, priceOption, ncdf, ninv } from "../engine/deriv/pricing.js";
import { enrichChain, maxPain, pcr, parity, fitSvi, skewMetrics, termStructure, gexProfile, probabilities } from "../engine/deriv/chain.js";
import { classifyBuildup, optionFlow, conflicts } from "../engine/deriv/positioning.js";
import { realisedVol, ivRank, volRegime } from "../engine/deriv/volatility.js";
import { futuresTable, rollover, continuousFutures, legCost } from "../engine/deriv/futures.js";
import { TEMPLATES, legsFromTemplate, strategyMetrics, positionGreeks } from "../engine/deriv/strategy.js";
import { parseFoBhavcopy, parseSecBan, parseParticipantOi, parseCombineOi, isoDate } from "../engine/deriv/nse.js";
import { encodeDay, decodeDay } from "../engine/deriv/codec.js";
import { matches, parseDerivQuery, confluence } from "../engine/deriv/screen.js";
import { summarizeDay, withHistory } from "../engine/deriv/summary.js";
import { demoDerivatives } from "../engine/deriv/demo.js";
import { buildCustomIndex } from "../engine/customIndex.js";
import { periodKey, TIMEFRAMES } from "../engine/calendar.js";
import { aggregate } from "../engine/indicators.js";
import { correlationMatrix, xReturns } from "../engine/crossAsset.js";

const near = (a, b, tol) => Math.abs(a - b) <= tol;

test("normal CDF and its inverse", () => {
  assert.ok(near(ncdf(0), 0.5, 1e-12));
  assert.ok(near(ncdf(1.96), 0.9750021, 1e-6));
  assert.ok(near(ninv(0.975), 1.959964, 1e-5));
});

test("Black-Scholes reference prices (Hull) and put-call parity", () => {
  // Hull: S=42, K=40, r=10%, sigma=20%, T=0.5 -> call 4.76, put 0.81
  const c = gbs(1, 42, 40, 0.5, 0.1, 0.1, 0.2), p = gbs(-1, 42, 40, 0.5, 0.1, 0.1, 0.2);
  assert.ok(near(c.price, 4.7594, 1e-3) && near(p.price, 0.8086, 1e-3));
  assert.ok(near(c.price - p.price, 42 - 40 * Math.exp(-0.05), 1e-9));
});

test("analytic Greeks match finite differences", () => {
  const S = 100, K = 105, T = 0.25, r = 0.06, b = 0.05, v = 0.25, h = 1e-3;
  for (const cp of [1, -1]) {
    const g = gbs(cp, S, K, T, r, b, v), P = (s, t, vv) => gbs(cp, s, K, t, r, b, vv);
    assert.ok(near(g.delta, (P(S + h, T, v).price - P(S - h, T, v).price) / (2 * h), 1e-5));
    assert.ok(near(g.gamma, (P(S + h, T, v).price - 2 * g.price + P(S - h, T, v).price) / (h * h), 1e-4));
    assert.ok(near(g.vega, (P(S, T, v + 1e-4).price - P(S, T, v - 1e-4).price) / 2e-4 / 100, 1e-6));
    assert.ok(near(g.vanna, (P(S, T, v + 1e-4).delta - P(S, T, v - 1e-4).delta) / 2e-4 / 100, 1e-6));
    assert.ok(near(g.charm, P(S, T - 1 / 365, v).delta - g.delta, 2e-5));
    assert.ok(near(g.color, P(S, T - 1 / 365, v).gamma - g.gamma, 2e-6));
    assert.ok(near(g.speed, (P(S + h, T, v).gamma - P(S - h, T, v).gamma) / (2 * h), 1e-6));
  }
});

test("implied volatility round-trips across models", () => {
  for (const [m, inp] of [["BSM", { cp: 1, S: 100, K: 110, T: 0.3, r: 0.05, q: 0.01 }], ["BLACK76", { cp: -1, F: 100, S: 100, K: 90, T: 0.1, r: 0.06 }]]) {
    const px = priceOption(m, { ...inp, v: 0.31 }).price;
    assert.ok(near(impliedVol(m, inp, px), 0.31, 1e-6), m);
  }
  assert.equal(impliedVol("BSM", { cp: 1, S: 100, K: 50, T: 0.5, r: 0, q: 0 }, 10), null); // below intrinsic
});

test("American pricing: trees converge to BSM for European, BAW is close to a fine tree", () => {
  const eu = gbs(-1, 100, 100, 1, 0.08, 0.08, 0.3).price;
  assert.ok(near(crr(-1, 100, 100, 1, 0.08, 0, 0.3, false, 800), eu, 0.02));
  const tree = crr(-1, 100, 100, 0.25, 0.08, 0, 0.2, true, 800), w = baw(-1, 100, 100, 0.25, 0.08, 0, 0.2);
  assert.ok(w > gbs(-1, 100, 100, 0.25, 0.08, 0.08, 0.2).price && near(w, tree, 0.05));
});

function sampleDay() {
  return demoDerivatives("2026-11-13", 3).days.get("NIFTY").at(-1);
}

test("chain enrichment: IVs recover the generator's smile and max pain is a listed strike", () => {
  const ch = enrichChain(sampleDay());
  const ex = ch.expiries.find((e) => e.rows.length > 10);
  const ivs = ex.rows.map((r) => r.ce?.iv).filter(Boolean);
  assert.ok(ivs.length > 10 && ivs.every((v) => v > 0.03 && v < 1.5));
  const mp = maxPain(ex);
  assert.ok(ex.rows.some((r) => r.strike === mp.strike));
  const p = pcr(ex);
  assert.ok(p.oi > 0 && p.callOi > 0 && p.putOi > 0);
  // Synthetic futures from parity sit on the forward (prices come from one model).
  const par = parity(ex, 0.065);
  for (const row of par.rows.slice(0, 5)) assert.ok(Math.abs(row.synthetic - ex.F) / ex.F < 0.002);
  const sk = skewMetrics(ex);
  assert.ok(sk.skew25 > 0, "generator has a put skew");
  assert.ok(termStructure(ch).points.length >= 2);
  const svi = fitSvi(ex);
  assert.ok(svi && svi.rmse < 1e-3);
  assert.ok(Number.isFinite(gexProfile(ch, { expiries: [ex.expiry], steps: 15 }).points[0].gex));
});

test("risk-neutral probabilities are consistent", () => {
  const p = probabilities(100, 0.25, 0.2, { above: 100, below: 100, low: 95, high: 105 });
  assert.ok(near(p.above + p.below, 1, 1e-12));
  assert.ok(p.inside > 0 && p.inside < 1 && p.touchAbove >= p.above);
});

test("build-up classification and option flow", () => {
  assert.equal(classifyBuildup({ pxChg: 0.01, oiChg: 0.05 }).key, "long_buildup");
  assert.equal(classifyBuildup({ pxChg: -0.01, oiChg: 0.05 }).key, "short_buildup");
  assert.equal(classifyBuildup({ pxChg: 0.01, oiChg: -0.05 }).key, "short_covering");
  assert.equal(classifyBuildup({ pxChg: -0.01, oiChg: -0.05 }).key, "long_unwinding");
  assert.equal(classifyBuildup({ pxChg: 0.0001, oiChg: 0.05 }).key, "neutral");
  const f = optionFlow({ cp: 1, oi: 1000, chgOi: 400, chgPx: -3, iv: 0.18, vol: 500 }, { ivPrev: 0.2 });
  assert.equal(f.kind, "writing");
  assert.ok(f.confidence <= 0.8);
  assert.equal(conflicts({ dir: 1 }, { mmaBearD: true }).length, 1);
});

test("realised volatility estimators agree on a constant-range series and IV rank bounds", () => {
  const n = 80, close = [], open = [], high = [], low = [];
  let p = 100;
  for (let i = 0; i < n; i++) { const o = p; p *= i % 2 ? 1.01 : 1 / 1.01; open.push(o); close.push(p); high.push(Math.max(o, p) * 1.002); low.push(Math.min(o, p) / 1.002); }
  const b = { time: close.map((_, i) => String(i)), open, high, low, close };
  const cc = realisedVol(b, 20, "cc");
  assert.ok(near(cc, Math.log(1.01) * Math.sqrt(252) * Math.sqrt(20 / 19), 1e-6));
  for (const m of ["parkinson", "gk", "yz"]) assert.ok(realisedVol(b, 20, m) > 0, m);
  const ir = ivRank([...Array(30).keys()].map((x) => x / 100));
  assert.equal(ir.rank, 1);
  assert.equal(volRegime(0.97).key, "extreme");
});

test("futures basis, rollover, continuous series and costs", () => {
  const day = { date: "2026-11-02", spot: 100, futures: [{ expiry: "2026-11-26", close: 101, settle: 101, oi: 300, vol: 10 }, { expiry: "2026-12-31", close: 102, settle: 102, oi: 700, vol: 5 }], options: [] };
  const t = futuresTable(day, { r: 0.065 });
  assert.ok(near(t[0].basisPct, 0.01, 1e-12) && t[0].carry > 0);
  assert.ok(near(rollover(t).pct, 0.7, 1e-12));
  const days = [{ date: "a", near: { expiry: "e1", price: 100 }, next: { expiry: "e2", price: 102 } }, { date: "b", near: { expiry: "e2", price: 103 }, next: null }];
  const cf = continuousFutures(days, "backDiff", { rollDays: 0 });
  assert.equal(cf.rolls.length, 1);
  assert.ok(near(cf.points[0].adj, 102, 1e-9) && cf.points[1].adj === 103);
  const c = legCost("OPT", -1, 100000);
  assert.ok(near(c.stt, 100, 1e-9) && c.total > c.stt);
});

test("strategy metrics: bull call spread bounds, iron condor two breakevens, straddle unlimited loss", () => {
  const ch = enrichChain(sampleDay());
  const lot = ch.lot;
  const legs = legsFromTemplate(TEMPLATES.find((t) => t.name === "Bull Call Spread"), ch);
  const m = strategyMetrics(legs, ch);
  const width = legs[1].strike - legs[0].strike, debit = (legs[0].price - legs[1].price) * lot;
  assert.ok(near(m.maxLoss, -debit, 1e-6 * lot * 100) && near(m.maxProfit, width * lot - debit, 1e-3 * lot));
  assert.equal(m.breakevens.length, 1);
  const ic = strategyMetrics(legsFromTemplate(TEMPLATES.find((t) => t.name === "Iron Condor"), ch), ch);
  assert.equal(ic.breakevens.length, 2);
  assert.ok(Number.isFinite(ic.maxLoss) && ic.pop > 0 && ic.pop < 1);
  assert.equal(strategyMetrics(legsFromTemplate(TEMPLATES.find((t) => t.name === "Short Straddle"), ch), ch).maxLoss, -Infinity);
  const syn = legsFromTemplate(TEMPLATES.find((t) => t.name === "Synthetic Long"), ch);
  assert.ok(near(positionGreeks(syn, ch).delta, lot, 0.02 * lot), "synthetic long ~ one lot of delta");
});

test("NSE file parsers: header by name, shares converted to contracts, ban list, participants, MWPL", () => {
  const head = "TradDt,BizDt,Sgmt,Src,FinInstrmTp,FinInstrmId,ISIN,TckrSymb,SctySrs,XpryDt,FininstrmActlXpryDt,StrkPric,OptnTp,FinInstrmNm,OpnPric,HghPric,LwPric,ClsPric,LastPric,PrvsClsgPric,UndrlygPric,SttlmPric,OpnIntrst,ChngInOpnIntrst,TtlTradgVol,TtlTrfVal,TtlNbOfTxsExctd,SsnId,NewBrdLotQty,Rmks";
  const lines = [head];
  for (let i = 0; i < 60; i++) lines.push(`2026-11-13,2026-11-13,FO,NSE,IDO,1,,NIFTY,,2026-11-27,2026-11-27,${24000 + i * 50},${i % 2 ? "PE" : "CE"},X,1,1,1,${10 + i},10,9,24100.5,10,${75 * (100 + i)},${75 * 5},${75 * 20},1000,10,F1,75,`);
  lines.push("2026-11-13,2026-11-13,FO,NSE,IDF,1,,NIFTY,,2026-11-27,2026-11-27,,,X,1,1,1,24200,24200,24100,24100.5,24210,7500,750,1500,1,1,F1,75,");
  const p = parseFoBhavcopy(lines.join("\n"));
  const d = p.days.get("NIFTY");
  assert.equal(p.date, "2026-11-13");
  assert.match(p.units, /converted/);
  assert.equal(d.options[0].oi, 100);
  assert.equal(d.futures[0].oi, 100);
  assert.equal(d.spot, 24100.5);
  assert.throws(() => parseFoBhavcopy("A,B\n1,2"), /missing/);
  assert.deepEqual(parseSecBan("Securities in Ban For Trade Date 14-NOV-2026:\n1,IDEA\n2,RBLBANK\n"), ["IDEA", "RBLBANK"]);
  const po = parseParticipantOi("Participant wise Open Interest\nClient Type,Future Index Long,Future Index Short\nFII,100,250\nTOTAL,1,1");
  assert.equal(po.find((x) => x.type === "FII")["Future Index Short"], 250);
  const mw = parseCombineOi("Date,ISIN,Scrip Name,NSE Symbol,MWPL,Open Interest,Limit for Next Day\n13-Nov-2026,IN1,ABC LTD,ABC,1000,960,40");
  assert.equal(mw[0].pct, 0.96);
  assert.equal(isoDate("13-NOV-2026"), "2026-11-13");
});

test("chain codec round-trips and summaries carry history fields", () => {
  const day = sampleDay();
  const back = decodeDay({ date: day.date, und: day.underlying, kind: day.kind, spot: day.spot, lot: day.lot, data: JSON.parse(JSON.stringify(encodeDay(day))) });
  assert.equal(back.options.length, day.options.length);
  assert.deepEqual(pick(back.options[7]), pick(day.options[7]));
  const s = withHistory(summarizeDay(day), []);
  assert.ok(s.pcrOi > 0 && s.maxPain > 0 && s.atmIv > 0 && "buildup" in s);
});
const pick = (o) => ({ expiry: o.expiry, strike: o.strike, cp: o.cp, close: o.close, settle: o.settle, prevClose: o.prevClose, oi: o.oi, chgOi: o.chgOi, vol: o.vol });

test("derivatives screen conditions, plain-English parser and confluence", () => {
  const row = { und: "X", kind: "stock", s: { buildup: "long_buildup", ivRank: 0.25, pcrOi: 1.2 }, tech: { mmaBullD: true, rsiD: 60, rscRising_country_D: true } };
  assert.ok(matches(row, [{ field: "buildup", op: "=", value: "long_buildup" }, { field: "ivRank", op: "<=", value: 0.3 }]));
  const q = parseDerivQuery("stocks with long build-up and IV rank below 30");
  assert.deepEqual(q.conds.map((c) => c.field).sort(), ["buildup", "ivRank", "kind"]);
  const c = confluence(row);
  assert.equal(c.score, 100);
});

test("custom index: CW, EW and own weights chain correctly and WW sums to 100", () => {
  const t = ["2024-03-28", "2024-03-29", "2024-04-01", "2024-04-02", "2024-06-28", "2024-07-01"];
  const a = { id: "a", label: "A", time: t, close: [10, 11, 11, 12, 12, 12], shares: 100, weight: 3 };
  const b = { id: "b", label: "B", time: t, close: [20, 20, 22, 22, 24, 24], shares: 50, weight: 1 };
  const cw = buildCustomIndex([a, b], { method: "CW" });
  assert.deepEqual(cw.level.slice(0, 3), [1000, 1050, 1100]);
  const ew = buildCustomIndex([a, b], { method: "EW" });
  assert.equal(ew.level[1], 1050);
  const cu = buildCustomIndex([a, b], { method: "CUSTOM" });
  assert.equal(cu.level[1], 1075);
  for (const r of [cw, ew, cu]) for (let j = 0; j < r.weightsAt.dates.length; j++) assert.ok(near(r.weightsAt.children.reduce((s, c) => s + (c.weights[j] || 0), 0), 100, 1e-6));
});

test("half-yearly and 9-month candles", () => {
  assert.ok(TIMEFRAMES.includes("H") && TIMEFRAMES.includes("N"));
  assert.equal(periodKey("2026-06-30", "H"), "2026-H1");
  assert.equal(periodKey("2026-07-01", "H"), "2026-H2");
  assert.equal(periodKey("2000-09-30", "N"), "2000-01-N");
  assert.equal(periodKey("2000-10-01", "N"), "2000-10-N");
  assert.equal(periodKey("2001-06-30", "N"), "2000-10-N");
  const time = [], close = [];
  for (let m = 1; m <= 12; m++) { time.push(`2026-${String(m).padStart(2, "0")}-15`); close.push(m); }
  const h = aggregate({ time, open: close, high: close, low: close, close, volume: close.map(() => 1) }, "H");
  assert.deepEqual(h.close, [6, 12]);
  assert.deepEqual(h.time, ["2026-06-15", "2026-12-15"]); // stamped with the period's last session
});

test("cross-asset returns and correlation", () => {
  const dates = [], a = [], b = [];
  let p = 100, q = 50;
  for (let t = Date.parse("2025-01-06"), i = 0; i < 400; t += 86400000) { const d = new Date(t); if (d.getUTCDay() % 6 === 0) continue; const r = Math.sin(i++ / 3) * 0.01; p *= 1 + r; q *= 1 + r; dates.push(d.toISOString().slice(0, 10)); a.push(p); b.push(q); }
  const m = correlationMatrix([{ dates, close: a }, { dates, close: b }], 52);
  assert.ok(near(m.matrix[0][1], 1, 1e-9));
  assert.ok(near(xReturns({ dates, close: a })["1W"], a.at(-1) / a.at(-6) - 1, 1e-12));
});
