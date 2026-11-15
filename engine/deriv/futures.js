// Futures: basis, cost of carry, fair value, rollover, calendar spreads,
// continuous series and cash-futures arbitrage screening (end-of-day).

import { yearFrac } from "./pricing.js";

export const futPrice = (f) => (f.vol > 0 && f.close > 0 ? f.close : f.settle || f.close);

/** One row per live futures contract with basis, carry and fair value. r: risk-free, q: dividend yield used for fair value. */
export function futuresTable(day, { r = 0.065, q = 0 } = {}) {
  const futs = (day.futures || []).filter((f) => f.expiry >= day.date).sort((a, b) => (a.expiry < b.expiry ? -1 : 1));
  return futs.map((f, i) => {
    const F = futPrice(f), T = Math.max(yearFrac(day.date, f.expiry), 1 / 365), S = day.spot;
    const basis = F - S;
    const carry = S > 0 && F > 0 ? Math.log(F / S) / T : null;           // annualised, continuous
    const fair = S * Math.exp((r - q) * T);
    return { leg: ["Near", "Next", "Far"][i] || `#${i + 1}`, expiry: f.expiry, dte: Math.round(T * 365), price: F, settle: f.settle, oi: f.oi, chgOi: f.chgOi, vol: f.vol,
      pxChg: f.prevClose > 0 ? F / f.prevClose - 1 : null, basis, basisPct: S > 0 ? basis / S : null, carry, impliedDivYield: carry != null ? r - carry : null,
      fair, richCheap: F - fair };
  });
}

/**
 * Rollover: share of open interest already in the next contract, and the roll
 * cost (calendar spread) in points and annualised. Meaningful in expiry week.
 */
export function rollover(rows) {
  if (rows.length < 2) return null;
  const [near, next] = rows;
  const tot = (near.oi || 0) + (next.oi || 0);
  const spread = next.price - near.price;
  const gapT = (next.dte - near.dte) / 365;
  return { pct: tot > 0 ? (next.oi || 0) / tot : null, spread, spreadPct: near.price > 0 ? spread / near.price : null, annualised: near.price > 0 && gapT > 0 ? Math.log(next.price / near.price) / gapT : null, nearDte: near.dte };
}

/** Rollover % at the same days-to-expiry in past expiry cycles, for the 3- and 6-cycle averages. */
export function rolloverHistory(stats) {
  // stats: [{date, nearExpiry, nearDte, rolloverPct}] -> last value per expiry at the smallest dte >= 1
  const byExp = new Map();
  for (const s of stats) if (s.rolloverPct != null && s.nearDte >= 1) {
    const cur = byExp.get(s.nearExpiry);
    if (!cur || s.nearDte < cur.nearDte) byExp.set(s.nearExpiry, s);
  }
  const done = [...byExp.values()].sort((a, b) => (a.nearExpiry < b.nearExpiry ? -1 : 1));
  const avg = (k) => { const xs = done.slice(-k - 1, -1).map((s) => s.rolloverPct); return xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : null; };
  return { cycles: done, avg3: avg(3), avg6: avg(6) };
}

/**
 * Continuous futures from per-session near / next prices.
 * days: [{date, near:{expiry, price, oi}, next:{expiry, price, oi}}]
 * method: unadjusted | backDiff | backRatio | oiCross | fixedDays (roll n sessions before expiry)
 */
export function continuousFutures(days, method = "backRatio", { rollDays = 3 } = {}) {
  const pts = [];
  let cur = null, prevDay = null;
  for (let i = 0; i < days.length; i++) {
    const d = days[i];
    if (!d.near) continue;
    let useNext = false;
    if (d.next) {
      if (method === "oiCross") useNext = (d.next.oi || 0) > (d.near.oi || 0);
      else { const sessionsLeft = days.slice(i + 1).filter((x) => x.near?.expiry === d.near.expiry).length; useNext = sessionsLeft < rollDays; }
    }
    const leg = useNext ? d.next : d.near;
    if (cur && leg.expiry !== cur.expiry) {
      // The roll gap is measured on ONE session where both contracts traded: today when
      // rolling early, else the previous session (natural splice at expiry).
      let gapDiff, gapRatio;
      if (useNext) { gapDiff = d.next.price - d.near.price; gapRatio = d.next.price / d.near.price; }
      else if (prevDay?.next?.expiry === leg.expiry) { gapDiff = prevDay.next.price - prevDay.near.price; gapRatio = prevDay.next.price / prevDay.near.price; }
      else { gapDiff = leg.price - cur.price; gapRatio = leg.price / cur.price; }
      pts.push({ date: d.date, roll: true, from: cur, to: { expiry: leg.expiry, price: leg.price }, gapDiff, gapRatio });
    }
    cur = { expiry: leg.expiry, price: leg.price };
    pts.push({ date: d.date, price: leg.price, expiry: leg.expiry });
    prevDay = d;
  }
  const bars = pts.filter((p) => !p.roll), rolls = pts.filter((p) => p.roll);
  const out = bars.map((p) => ({ ...p, adj: p.price }));
  if (method === "backDiff" || method === "backRatio") {
    for (const rl of rolls) for (const p of out) if (p.date < rl.date) p.adj = method === "backDiff" ? p.adj + rl.gapDiff : p.adj * rl.gapRatio;
  }
  return { points: out, rolls: rolls.map((r) => ({ date: r.date, from: r.from.expiry, to: r.to.expiry, gap: r.gapDiff })), method };
}

export const ROLL_METHODS = { unadjusted: "Unadjusted (raw splice)", backDiff: "Back-adjusted (difference)", backRatio: "Back-adjusted (ratio)", oiCross: "Roll when next month's OI exceeds near", fixedDays: "Roll a fixed number of sessions before expiry" };

/**
 * India transaction costs per side (rates as published by NSE / SEBI / the tax
 * law; brokerage is the user's own). Kept in one table with an as-of date so a
 * rate change is a one-line edit.
 */
export const INDIA_COSTS = {
  asOf: "2024-10-01",
  brokeragePerOrder: 20,
  stt: { futuresSell: 0.0002, optionsSellPremium: 0.001, optionsExercisedIntrinsic: 0.00125, deliveryBoth: 0.001 },
  exchangeTxn: { futures: 0.0000173, optionsPremium: 0.0003503, equity: 0.0000297 },
  sebiPerCrore: 10,
  stampBuy: { futures: 0.00002, options: 0.00003, delivery: 0.00015 },
  gst: 0.18,
};

/** Cost of one leg. kind: FUT | OPT | EQ ; side +1 buy / -1 sell ; value = price x quantity (premium value for options). */
export function legCost(kind, side, value, c = INDIA_COSTS) {
  const v = Math.abs(value);
  const brokerage = c.brokeragePerOrder;
  const stt = side < 0 ? (kind === "FUT" ? c.stt.futuresSell * v : kind === "OPT" ? c.stt.optionsSellPremium * v : c.stt.deliveryBoth * v) : kind === "EQ" ? c.stt.deliveryBoth * v : 0;
  const txn = (kind === "FUT" ? c.exchangeTxn.futures : kind === "OPT" ? c.exchangeTxn.optionsPremium : c.exchangeTxn.equity) * v;
  const sebi = (v / 1e7) * c.sebiPerCrore;
  const stamp = side > 0 ? (kind === "FUT" ? c.stampBuy.futures : kind === "OPT" ? c.stampBuy.options : c.stampBuy.delivery) * v : 0;
  const gst = c.gst * (brokerage + txn + sebi);
  return { brokerage, stt, txn, sebi, stamp, gst, total: brokerage + stt + txn + sebi + stamp + gst };
}

/** Cash-futures arbitrage: annualised carry earned net of round-trip costs, vs a funding rate. */
export function cashFuturesArb(row, spot, lot, { funding = 0.065 } = {}) {
  if (!(row?.price > 0 && spot > 0 && lot > 0)) return null;
  const qty = lot, T = Math.max(row.dte, 1) / 365;
  const gross = (row.price - spot) * qty;
  const costs = legCost("EQ", 1, spot * qty).total + legCost("FUT", -1, row.price * qty).total + legCost("EQ", -1, row.price * qty).total + legCost("FUT", 1, row.price * qty).total;
  const capital = spot * qty;
  const net = gross - costs;
  const netAnnual = net / capital / T;
  return { gross, costs, net, netAnnual, excessOverFunding: netAnnual - funding, note: "Buy cash + sell future, held to expiry; ignores dividends and margin funding on the future." };
}

/** Last trading day and settlement facts for a contract (NSE rules). */
export function settlementInfo(kind, expiry, asOf) {
  const dte = Math.round(yearFrac(asOf, expiry) * 365);
  const physical = kind === "stock";
  return {
    expiry, dte, lastTradingDay: expiry,
    settlement: physical ? "Physical delivery of shares for in-the-money stock options and all stock futures held at expiry" : "Cash settled against the final settlement price",
    finalPrice: physical ? "Closing price of the underlying on expiry day" : "Closing value of the index on expiry day",
    deliveryWindow: physical && dte <= 5 ? "In the physical-settlement margin window: delivery margins rise in the last days before expiry" : null,
  };
}
