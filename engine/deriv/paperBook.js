// Practice book for futures and options. Fills are booked at a stored end-of-day
// price (last traded price if the contract traded, else the exchange settlement
// price), never at a live quote, and every fill pays the estimated Indian costs.
// There is no margin check and no slippage: it is a learning tool, not a
// simulation of real execution.
import { legCost, INDIA_COSTS } from "./futures.js";

export const PAPER_DERIV_START = 1000000; // INR

export const newDerivBook = () => ({ cash: PAPER_DERIV_START, start: PAPER_DERIV_START, trades: [], createdAt: new Date().toISOString() });

export const contractKey = (c) => `${c.und}|${c.kind}|${c.expiry}|${c.kind === "OPT" ? c.strike : 0}|${c.kind === "OPT" ? c.cp : 0}`;
export const contractName = (c) => `${c.und} ${c.expiry} ${c.kind === "FUT" ? "FUT" : `${c.strike} ${c.cp > 0 ? "CE" : "PE"}`}`;

/** Find a contract's stored price in a chain day (the raw day from the API). Returns null when it is not listed. */
export function quoteFrom(day, c) {
  if (!day) return null;
  if (c.kind === "FUT") {
    const f = (day.futures || []).find((x) => x.expiry === c.expiry);
    if (!f) return null;
    const price = f.vol > 0 && f.close > 0 ? f.close : f.settle || f.close;
    return price > 0 ? { price, lot: day.lot, date: day.date, traded: f.vol > 0 } : null;
  }
  const o = (day.options || []).find((x) => x.expiry === c.expiry && x.strike === c.strike && x.cp === c.cp);
  if (!o) return null;
  const price = o.vol > 0 && o.close > 0 ? o.close : o.settle > 0 ? o.settle : o.close > 0 ? o.close : null;
  return price > 0 ? { price, lot: day.lot, date: day.date, traded: o.vol > 0 } : null;
}

/** Book one fill. order: {und, kind, expiry, strike?, cp?, side(+1/-1), lots}; quote from quoteFrom. Returns {book} or {error}. */
export function placeOrder(book, order, quote, { costs = INDIA_COSTS, id = String(Date.now()) + Math.random().toString(36).slice(2, 6) } = {}) {
  const lots = Math.floor(+order.lots);
  if (!quote || !(quote.price > 0)) return { error: "That contract has no stored price on the latest session." };
  if (!(lots > 0)) return { error: "Enter a whole number of lots." };
  if (!(quote.lot > 0)) return { error: "The lot size is unknown for this underlying." };
  if (order.expiry <= quote.date) return { error: "That contract has already expired." };
  const qty = lots * quote.lot;
  const value = quote.price * qty;
  const fee = legCost(order.kind === "FUT" ? "FUT" : "OPT", order.side, value, costs).total;
  const premium = order.kind === "OPT" ? -order.side * value : 0; // options pay / receive the premium now
  if (book.cash + premium - fee < 0 && order.side > 0) return { error: `Not enough practice cash for this premium and costs (${Math.round(book.cash).toLocaleString("en-IN")} available).` };
  const t = { tid: id, und: order.und, kind: order.kind, expiry: order.expiry, strike: order.strike ?? null, cp: order.cp ?? null, side: order.side, lots, lot: quote.lot, qty, price: quote.price, fee, date: quote.date, at: new Date().toISOString() };
  return { book: { ...book, cash: book.cash + premium - fee, trades: [...book.trades, t] }, trade: t };
}

/** Net positions with average price and realised result (average-cost, long and short). Futures realise into cash through `realisedFut`. */
export function positionsOf(trades) {
  const m = new Map();
  for (const t of trades) {
    const k = contractKey(t);
    const p = m.get(k) || { key: k, und: t.und, kind: t.kind, expiry: t.expiry, strike: t.strike, cp: t.cp, lot: t.lot, net: 0, avg: 0, realised: 0, fees: 0 };
    p.fees += t.fee;
    if (p.net === 0 || Math.sign(p.net) === t.side) { // opening or adding
      p.avg = (Math.abs(p.net) * p.avg + t.qty * t.price) / (Math.abs(p.net) + t.qty);
      p.net += t.side * t.qty;
    } else { // closing (maybe flipping)
      const closeQty = Math.min(Math.abs(p.net), t.qty);
      p.realised += closeQty * (t.price - p.avg) * Math.sign(p.net);
      const left = t.qty - closeQty;
      p.net += t.side * closeQty;
      if (left > 0) { p.net = t.side * left; p.avg = t.price; }
      if (p.net === 0) p.avg = 0;
    }
    m.set(k, p);
  }
  return [...m.values()];
}

/** Mark positions to the latest stored session. days: {und: rawChainDay}. Expired contracts value at intrinsic (options) or spot (futures). */
export function markBook(book, days) {
  const pos = positionsOf(book.trades).map((p) => {
    const day = days[p.und];
    let last = null, expired = false, source = "none";
    if (day) {
      if (p.expiry <= day.date) {
        expired = true; source = "expiry value";
        last = p.kind === "FUT" ? day.spot : Math.max(0, p.cp * (day.spot - p.strike));
      } else {
        const q = quoteFrom(day, p);
        if (q) { last = q.price; source = q.traded ? "last traded" : "settlement"; }
      }
    }
    const open = p.net !== 0;
    const unreal = open && last != null ? p.net * (last - p.avg) : null;
    return { ...p, open, last, expired, source, unreal };
  });
  // futures never move cash on entry, so their realised result and mark go into equity directly
  const futRealised = pos.filter((p) => p.kind === "FUT").reduce((s, p) => s + p.realised, 0);
  const optValue = pos.filter((p) => p.kind === "OPT" && p.open && p.last != null).reduce((s, p) => s + p.net * p.last, 0);
  const futUnreal = pos.filter((p) => p.kind === "FUT" && p.open && p.unreal != null).reduce((s, p) => s + p.unreal, 0);
  const optRealised = pos.filter((p) => p.kind === "OPT").reduce((s, p) => s + p.realised, 0);
  const equity = book.cash + futRealised + optValue + futUnreal;
  const fees = pos.reduce((s, p) => s + p.fees, 0);
  const unmarked = pos.filter((p) => p.open && p.last == null).length;
  return { positions: pos, equity, futRealised, optRealised, optValue, futUnreal, fees, unmarked };
}
