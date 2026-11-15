// Strategy builder: named templates, multi-leg payoff (at expiry and before),
// risk / reward metrics, probabilities, costs, a stress-based margin ESTIMATE,
// scenario Greeks, a rule-based recommender and adjustment suggestions.

import { gbs, ncdf } from "./pricing.js";
import { legCost } from "./futures.js";
import { atmStrike, atmIv } from "./chain.js";

// Leg spec in a template: [type, side, strikeOffset (in strike steps from ATM), ratio, expiryIndex]
// type: CE | PE | FUT | EQ ; side +1 long / -1 short
const T = (group, name, legs, view) => ({ group, name, legs, view });
export const TEMPLATES = [
  T("Directional bullish", "Long Call", [["CE", 1, 0, 1]], "bullish"),
  T("Directional bullish", "Bull Call Spread", [["CE", 1, 0, 1], ["CE", -1, 2, 1]], "bullish"),
  T("Directional bullish", "Bull Put Spread", [["PE", -1, 0, 1], ["PE", 1, -2, 1]], "bullish"),
  T("Directional bullish", "Call Ratio Backspread", [["CE", -1, 0, 1], ["CE", 1, 2, 2]], "bullish-volatile"),
  T("Directional bullish", "Synthetic Long", [["CE", 1, 0, 1], ["PE", -1, 0, 1]], "bullish"),
  T("Directional bullish", "Risk Reversal (Bullish)", [["CE", 1, 2, 1], ["PE", -1, -2, 1]], "bullish"),
  T("Directional bullish", "ZEBRA (call)", [["CE", 1, -2, 2], ["CE", -1, 0, 1]], "bullish"),
  T("Directional bearish", "Long Put", [["PE", 1, 0, 1]], "bearish"),
  T("Directional bearish", "Bear Put Spread", [["PE", 1, 0, 1], ["PE", -1, -2, 1]], "bearish"),
  T("Directional bearish", "Bear Call Spread", [["CE", -1, 0, 1], ["CE", 1, 2, 1]], "bearish"),
  T("Directional bearish", "Put Ratio Backspread", [["PE", -1, 0, 1], ["PE", 1, -2, 2]], "bearish-volatile"),
  T("Directional bearish", "Synthetic Short", [["PE", 1, 0, 1], ["CE", -1, 0, 1]], "bearish"),
  T("Directional bearish", "Risk Reversal (Bearish)", [["PE", 1, -2, 1], ["CE", -1, 2, 1]], "bearish"),
  T("Neutral / range-bound", "Short Straddle", [["CE", -1, 0, 1], ["PE", -1, 0, 1]], "neutral"),
  T("Neutral / range-bound", "Short Strangle", [["CE", -1, 3, 1], ["PE", -1, -3, 1]], "neutral"),
  T("Neutral / range-bound", "Iron Condor", [["PE", 1, -5, 1], ["PE", -1, -3, 1], ["CE", -1, 3, 1], ["CE", 1, 5, 1]], "neutral"),
  T("Neutral / range-bound", "Iron Butterfly", [["PE", 1, -3, 1], ["PE", -1, 0, 1], ["CE", -1, 0, 1], ["CE", 1, 3, 1]], "neutral"),
  T("Neutral / range-bound", "Long Call Butterfly", [["CE", 1, -2, 1], ["CE", -1, 0, 2], ["CE", 1, 2, 1]], "neutral"),
  T("Neutral / range-bound", "Short Call Butterfly", [["CE", -1, -2, 1], ["CE", 1, 0, 2], ["CE", -1, 2, 1]], "volatile"),
  T("Neutral / range-bound", "Long Call Condor", [["CE", 1, -3, 1], ["CE", -1, -1, 1], ["CE", -1, 1, 1], ["CE", 1, 3, 1]], "neutral"),
  T("Neutral / range-bound", "Jade Lizard", [["PE", -1, -2, 1], ["CE", -1, 2, 1], ["CE", 1, 4, 1]], "neutral-bullish"),
  T("Neutral / range-bound", "Reverse Jade Lizard", [["CE", -1, 2, 1], ["PE", -1, -2, 1], ["PE", 1, -4, 1]], "neutral-bearish"),
  T("Volatility buying", "Long Straddle", [["CE", 1, 0, 1], ["PE", 1, 0, 1]], "volatile"),
  T("Volatility buying", "Long Strangle", [["CE", 1, 3, 1], ["PE", 1, -3, 1]], "volatile"),
  T("Volatility buying", "Strap", [["CE", 1, 0, 2], ["PE", 1, 0, 1]], "volatile-bullish"),
  T("Volatility buying", "Strip", [["CE", 1, 0, 1], ["PE", 1, 0, 2]], "volatile-bearish"),
  T("Volatility buying", "Reverse Iron Condor", [["PE", -1, -5, 1], ["PE", 1, -3, 1], ["CE", 1, 3, 1], ["CE", -1, 5, 1]], "volatile"),
  T("Volatility buying", "Reverse Iron Butterfly", [["PE", -1, -3, 1], ["PE", 1, 0, 1], ["CE", 1, 0, 1], ["CE", -1, 3, 1]], "volatile"),
  T("Volatility selling", "Bull Put Credit Spread", [["PE", -1, -1, 1], ["PE", 1, -3, 1]], "neutral-bullish"),
  T("Volatility selling", "Bear Call Credit Spread", [["CE", -1, 1, 1], ["CE", 1, 3, 1]], "neutral-bearish"),
  T("Time, calendar and diagonal", "Call Calendar Spread", [["CE", -1, 0, 1, 0], ["CE", 1, 0, 1, 1]], "neutral"),
  T("Time, calendar and diagonal", "Put Calendar Spread", [["PE", -1, 0, 1, 0], ["PE", 1, 0, 1, 1]], "neutral"),
  T("Time, calendar and diagonal", "Call Diagonal Spread", [["CE", -1, 2, 1, 0], ["CE", 1, 0, 1, 1]], "neutral-bullish"),
  T("Time, calendar and diagonal", "Double Calendar", [["CE", -1, 2, 1, 0], ["CE", 1, 2, 1, 1], ["PE", -1, -2, 1, 0], ["PE", 1, -2, 1, 1]], "neutral"),
  T("Time, calendar and diagonal", "Double Diagonal", [["CE", -1, 3, 1, 0], ["CE", 1, 4, 1, 1], ["PE", -1, -3, 1, 0], ["PE", 1, -4, 1, 1]], "neutral"),
  T("Time, calendar and diagonal", "Poor Man's Covered Call", [["CE", 1, -4, 1, 1], ["CE", -1, 2, 1, 0]], "neutral-bullish"),
  T("Time, calendar and diagonal", "Poor Man's Covered Put", [["PE", 1, 4, 1, 1], ["PE", -1, -2, 1, 0]], "neutral-bearish"),
  T("Advanced multi-leg and arbitrage", "Call Ratio Spread 1x2", [["CE", 1, 0, 1], ["CE", -1, 2, 2]], "neutral-bullish"),
  T("Advanced multi-leg and arbitrage", "Put Ratio Spread 1x2", [["PE", 1, 0, 1], ["PE", -1, -2, 2]], "neutral-bearish"),
  T("Advanced multi-leg and arbitrage", "Call Ratio Spread 1x3", [["CE", 1, 0, 1], ["CE", -1, 2, 3]], "neutral"),
  T("Advanced multi-leg and arbitrage", "Broken-Wing Butterfly", [["CE", 1, -2, 1], ["CE", -1, 0, 2], ["CE", 1, 3, 1]], "neutral-bullish"),
  T("Advanced multi-leg and arbitrage", "Christmas Tree (calls)", [["CE", 1, 0, 1], ["CE", -1, 2, 1], ["CE", -1, 4, 1]], "neutral-bullish"),
  T("Advanced multi-leg and arbitrage", "Conversion", [["EQ", 1, 0, 1], ["PE", 1, 0, 1], ["CE", -1, 0, 1]], "arbitrage"),
  T("Advanced multi-leg and arbitrage", "Reversal", [["EQ", -1, 0, 1], ["PE", -1, 0, 1], ["CE", 1, 0, 1]], "arbitrage"),
  T("Advanced multi-leg and arbitrage", "Box Spread", [["CE", 1, -2, 1], ["PE", -1, -2, 1], ["CE", -1, 2, 1], ["PE", 1, 2, 1]], "arbitrage"),
  T("Advanced multi-leg and arbitrage", "Jelly Roll", [["CE", 1, 0, 1, 1], ["PE", -1, 0, 1, 1], ["CE", -1, 0, 1, 0], ["PE", 1, 0, 1, 0]], "arbitrage"),
  T("Futures and cash-derivatives", "Long Futures", [["FUT", 1, 0, 1]], "bullish"),
  T("Futures and cash-derivatives", "Short Futures", [["FUT", -1, 0, 1]], "bearish"),
  T("Futures and cash-derivatives", "Futures Calendar Spread", [["FUT", -1, 0, 1, 0], ["FUT", 1, 0, 1, 1]], "spread"),
  T("Futures and cash-derivatives", "Cash-Futures Arbitrage", [["EQ", 1, 0, 1], ["FUT", -1, 0, 1]], "arbitrage"),
  T("Futures and cash-derivatives", "Covered Call", [["EQ", 1, 0, 1], ["CE", -1, 2, 1]], "neutral-bullish"),
  T("Futures and cash-derivatives", "Protective Put", [["EQ", 1, 0, 1], ["PE", 1, -2, 1]], "bullish"),
];
export const TEMPLATE_GROUPS = [...new Set(TEMPLATES.map((t) => t.group))];

/** Strike step of an expiry (most common gap between listed strikes). */
export function strikeStep(ex) {
  const g = new Map();
  for (let i = 1; i < ex.rows.length; i++) { const d = +(ex.rows[i].strike - ex.rows[i - 1].strike).toFixed(4); g.set(d, (g.get(d) || 0) + 1); }
  return [...g.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 1;
}

/** Turn a template into concrete legs against an enriched chain. */
export function legsFromTemplate(tpl, chain, { expiryIndex = 0, lots = 1, widthMult = 1 } = {}) {
  const live = chain.expiries.filter((e) => e.rows.length > 4);
  return tpl.legs.map(([type, side, off, ratio, ei = 0]) => {
    const ex = live[Math.min(live.length - 1, expiryIndex + ei)] || live[0];
    const near = live[Math.min(live.length - 1, expiryIndex)] || live[0];
    // One template "step" = a quarter of the near expiry's 1-sd move, rounded to listed strikes,
    // so a +/-3 short strike sits about 0.75 sd out whatever the underlying or its volatility.
    const step = strikeStep(ex), iv = atmIv(near) || 0.2, unit = Math.max(step, Math.round((0.25 * near.F * iv * Math.sqrt(near.T)) / step) * step);
    const atm = atmStrike(ex, ex.F);
    const strike = type === "CE" || type === "PE" ? nearestStrike(ex, atm + off * unit * widthMult) : null;
    return makeLeg(chain, { type, side, strike, expiry: type === "EQ" ? null : ex.expiry, qty: ratio * lots });
  });
}
const nearestStrike = (ex, K) => ex.rows.reduce((b, r) => (Math.abs(r.strike - K) < Math.abs(b - K) ? r.strike : b), ex.rows[0].strike);

/** A concrete leg with its entry price and IV read off the chain. */
export function makeLeg(chain, { type, side, strike, expiry, qty = 1, price = null }) {
  const ex = chain.expiries.find((e) => e.expiry === expiry);
  let px = price, iv = null;
  if (type === "CE" || type === "PE") {
    const row = ex?.rows.find((r) => r.strike === strike);
    const leg = type === "CE" ? row?.ce : row?.pe;
    px = px ?? leg?.px ?? null; iv = leg?.iv ?? (ex ? atmIv(ex) : null);
  } else if (type === "FUT") {
    const f = chain.futures.find((x) => x.expiry === expiry);
    px = px ?? (f ? (f.vol > 0 ? f.close : f.settle || f.close) : ex?.F ?? chain.spot);
  } else px = px ?? chain.spot;
  return { type, side, strike, expiry, qty, price: px, iv };
}

/** Value of one leg at underlying S, time `t` years after today, IV shift dv. */
function legValue(leg, S, chain, t, dv, r) {
  if (leg.type === "EQ") return S;
  const ex = chain.expiries.find((e) => e.expiry === leg.expiry);
  const T = Math.max(0, (ex?.T ?? 0) - t);
  const fwd = ex ? (ex.F / chain.spot) * S : S;
  if (leg.type === "FUT") return T > 0 ? fwd * Math.exp(-0 * T) : S;
  const cp = leg.type === "CE" ? 1 : -1;
  if (T <= 0) return Math.max(0, cp * (S - leg.strike));
  const iv = Math.max(0.01, (leg.iv || 0.2) + dv);
  return gbs(cp, fwd, leg.strike, T, r, 0, iv).price;
}

/** P&L of the whole position at S, t years ahead (t = Infinity -> each leg at its own expiry). */
export function positionPnl(legs, S, chain, { t = 0, dv = 0, r = 0.065, lot = chain.lot || 1 } = {}) {
  let pnl = 0;
  const first = Math.min(...legs.filter((l) => l.expiry).map((l) => chain.expiries.find((e) => e.expiry === l.expiry)?.T ?? 0), Infinity);
  const tt = t === Infinity ? (Number.isFinite(first) ? first : 0) : t;
  for (const l of legs) {
    const mult = l.type === "EQ" ? 1 : lot;
    pnl += l.side * l.qty * mult * (legValue(l, S, chain, tt, dv, r) - (l.price || 0));
  }
  return pnl;
}

/**
 * Metrics at the first expiry: max profit / loss (and whether unbounded),
 * breakevens, reward / risk, probability of profit, expected value (lognormal,
 * from the ATM IV of the first expiry), net debit / credit and Greeks now.
 */
export function strategyMetrics(legs, chain, { r = 0.065, lot = chain.lot || 1, dv = 0 } = {}) {
  if (!legs.length) return null;
  const exps = legs.filter((l) => l.expiry).map((l) => chain.expiries.find((e) => e.expiry === l.expiry)).filter(Boolean).sort((a, b) => a.T - b.T);
  const ex = exps[0] || chain.expiries[0];
  const iv = (atmIv(ex) || 0.2) + dv, T = ex.T, S0 = chain.spot;
  const lo = S0 * Math.exp(-6 * iv * Math.sqrt(T)), hi = S0 * Math.exp(6 * iv * Math.sqrt(T));
  const N = 600, grid = [];
  for (let i = 0; i <= N; i++) { const S = lo + ((hi - lo) * i) / N; grid.push({ S, pnl: positionPnl(legs, S, chain, { t: Infinity, r, lot }) }); }
  const pn = grid.map((g) => g.pnl);
  // Downside is bounded (prices stop at zero): include S -> 0 in the extremes.
  const atZero = positionPnl(legs, 1e-6 * S0, chain, { t: Infinity, r, lot });
  const maxP = Math.max(...pn, atZero), maxL = Math.min(...pn, atZero);
  // Upside is unbounded only if the payoff keeps rising / falling like at least 5% of one lot of delta.
  const k = 20, slopeHi = (pn[N] - pn[N - k]) / (grid[N].S - grid[N - k].S), tol = 0.05 * lot;
  const unboundedUp = slopeHi > tol, unboundedLossUp = slopeHi < -tol;
  const breakevens = [];
  for (let i = 1; i <= N; i++) if (Math.sign(pn[i - 1]) !== Math.sign(pn[i]) && pn[i - 1] !== 0) breakevens.push(grid[i - 1].S + ((grid[i].S - grid[i - 1].S) * (0 - pn[i - 1])) / (pn[i] - pn[i - 1]));
  // Probabilities and EV under the lognormal with forward F and ATM IV.
  const F = ex.F;
  const dens = (S) => { const x = (Math.log(S / F) + 0.5 * iv * iv * T) / (iv * Math.sqrt(T)); return Math.exp(-0.5 * x * x) / (S * iv * Math.sqrt(2 * Math.PI * T)); };
  let pop = 0, ev = 0, mass = 0;
  for (let i = 1; i <= N; i++) { const S = (grid[i].S + grid[i - 1].S) / 2, w = dens(S) * (grid[i].S - grid[i - 1].S), p = (pn[i] + pn[i - 1]) / 2; mass += w; ev += w * p; if (p > 0) pop += w; }
  pop /= mass || 1; ev /= mass || 1;
  // Probability of touching each breakeven before expiry (driftless reflection approximation).
  const pot = breakevens.map((b) => Math.min(1, 2 * (b > S0 ? 1 - ncdf(Math.log(b / F) / (iv * Math.sqrt(T))) : ncdf(Math.log(b / F) / (iv * Math.sqrt(T))))));
  const net = legs.reduce((s, l) => s + l.side * l.qty * (l.type === "EQ" ? 1 : lot) * (l.price || 0), 0);
  const greeks = positionGreeks(legs, chain, { r, lot });
  const maxProfit = unboundedUp ? Infinity : maxP, maxLoss = unboundedLossUp ? -Infinity : maxL;
  return {
    expiry: ex.expiry, iv, maxProfit, maxLoss, breakevens, rewardRisk: Number.isFinite(maxProfit) && Number.isFinite(maxLoss) && maxLoss < 0 ? maxProfit / -maxLoss : null,
    pop, pot, ev, netPremium: -net, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0, greeks, grid,
    assumptions: `Lognormal at the ${ex.expiry} ATM IV ${(iv * 100).toFixed(1)}%, forward ${F.toFixed(2)}; later-expiry legs valued with Black-76 at the first expiry.`,
  };
}

/** Aggregate Greeks of a position (per lot multiplier applied), now. */
export function positionGreeks(legs, chain, { r = 0.065, lot = chain.lot || 1, S = chain.spot, dv = 0, t = 0 } = {}) {
  const g = { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0, vanna: 0, charm: 0, vomma: 0, speed: 0, zomma: 0, color: 0 };
  for (const l of legs) {
    const m = l.side * l.qty * (l.type === "EQ" ? 1 : lot);
    if (l.type === "EQ" || l.type === "FUT") { g.delta += m; continue; }
    const ex = chain.expiries.find((e) => e.expiry === l.expiry);
    if (!ex) continue;
    const T = Math.max(1e-6, ex.T - t), F = (ex.F / chain.spot) * S;
    const x = gbs(l.type === "CE" ? 1 : -1, F, l.strike, T, r, 0, Math.max(0.01, (l.iv || 0.2) + dv));
    for (const k of Object.keys(g)) g[k] += m * (x[k] || 0);
  }
  return g;
}

/** Greeks and P&L over a grid of spot shocks x IV shifts, optionally after `days`. */
export function scenarioMatrix(legs, chain, { spotShocks = [-0.1, -0.05, -0.02, 0, 0.02, 0.05, 0.1], ivShifts = [-0.1, -0.05, 0, 0.05, 0.1], days = 0, r = 0.065 } = {}) {
  return ivShifts.map((dv) => ({ dv, cells: spotShocks.map((s) => {
    const S = chain.spot * (1 + s), t = days / 365;
    return { shock: s, pnl: positionPnl(legs, S, chain, { t, dv, r }), ...positionGreeks(legs, chain, { r, S, dv, t }) };
  }) }));
}

/** Transaction costs for opening (and closing, if roundTrip) every leg. */
export function strategyCosts(legs, chain, { roundTrip = true } = {}) {
  const lot = chain.lot || 1;
  let total = 0; const rows = [];
  for (const l of legs) {
    const kind = l.type === "EQ" ? "EQ" : l.type === "FUT" ? "FUT" : "OPT";
    const qty = l.qty * (kind === "EQ" ? 1 : lot), val = (l.price || 0) * qty;
    const open = legCost(kind, l.side, val), close = roundTrip ? legCost(kind, -l.side, val) : { total: 0 };
    rows.push({ leg: legLabel(l), open: open.total, close: close.total, stt: open.stt + (close.stt || 0) });
    total += open.total + close.total;
  }
  return { rows, total, note: "Statutory charges at the rates in INDIA_COSTS plus ₹20 brokerage per order; slippage not included (end-of-day prices)." };
}

/**
 * Margin ESTIMATE: worst one-day loss across spot +/- 8% (index) or 15% (stock)
 * and IV +/- 25% scenarios, plus a 3% exposure margin on short notional.
 * The exchange's SPAN margin needs the NSE SPAN risk-parameter file and is not
 * computed here; this number is labelled an estimate wherever shown.
 */
export function marginEstimate(legs, chain, { r = 0.065 } = {}) {
  const lot = chain.lot || 1, range = chain.kind === "index" ? 0.08 : 0.15;
  let worst = 0;
  for (let i = -8; i <= 8; i++) for (const dvr of [-0.25, 0, 0.25]) {
    const S = chain.spot * (1 + (range * i) / 8);
    const p = positionPnl(legs, S, chain, { t: 1 / 365, dv: dvr * 0.2, r });
    worst = Math.min(worst, p);
  }
  const shortNotional = legs.filter((l) => l.side < 0 && l.type !== "EQ").reduce((s, l) => s + l.qty * lot * (l.type === "FUT" ? l.price : chain.spot), 0);
  const premiumPaid = legs.filter((l) => l.side > 0 && (l.type === "CE" || l.type === "PE")).reduce((s, l) => s + l.qty * lot * (l.price || 0), 0);
  const shortOrFut = legs.some((l) => l.side < 0 || l.type === "FUT");
  const est = shortOrFut ? -worst + 0.03 * shortNotional : premiumPaid;
  return { estimate: est, scanRange: range, label: "Estimate, not exchange SPAN", note: "Stress loss over spot and IV scenarios plus 3% exposure on short notional. Spread and hedge benefits appear because the whole position is stressed together." };
}

export const legLabel = (l) => `${l.side > 0 ? "Buy" : "Sell"} ${l.qty} ${l.type === "EQ" ? "shares (lot-equivalent)" : l.type === "FUT" ? `FUT ${l.expiry}` : `${l.strike} ${l.type} ${l.expiry}`}`;

/**
 * Rule-based recommender. Inputs: view (bullish | bearish | neutral | volatile),
 * ivPercentile (0-1), maxLoss (rupees, optional), horizon days. Each template
 * that fits the view is built on the live chain and scored on fit to the IV
 * regime, probability of profit, reward / risk, liquidity and the loss limit.
 * The output explains every score; it is a ranking of structures, not advice.
 */
export function recommend(chain, { view = "bullish", ivPercentile = null, maxLoss = null, expiryIndex = 0, walls = null, spots = null } = {}) {
  const fits = TEMPLATES.filter((t) => t.view.split("-").includes(view) && t.view !== "arbitrage");
  const out = [];
  for (const tpl of fits) {
    const legs = legsFromTemplate(tpl, chain, { expiryIndex });
    if (legs.some((l) => (l.type === "CE" || l.type === "PE") && !(l.price > 0))) continue;
    const m = strategyMetrics(legs, chain);
    if (!m) continue;
    const reasons = [];
    let s = 0;
    const shortVol = legs.reduce((a, l) => a + (l.type === "CE" || l.type === "PE" ? -l.side * l.qty : 0), 0) > 0;
    if (ivPercentile != null) {
      if (shortVol && ivPercentile > 0.6) { s += 25; reasons.push("sells options while IV is high for this underlying"); }
      else if (!shortVol && ivPercentile < 0.4) { s += 25; reasons.push("buys options while IV is low for this underlying"); }
      else if (shortVol && ivPercentile < 0.3) { s -= 15; reasons.push("sells options while IV is low (little premium)"); }
      else if (!shortVol && ivPercentile > 0.7) { s -= 15; reasons.push("buys options while IV is high (expensive)"); }
    }
    s += 30 * m.pop; reasons.push(`probability of profit ${(m.pop * 100).toFixed(0)}%`);
    if (m.rewardRisk != null) { s += Math.min(20, 10 * m.rewardRisk); reasons.push(`reward / risk ${m.rewardRisk.toFixed(2)}`); }
    if (!Number.isFinite(m.maxLoss)) { s -= 20; reasons.push("loss is open-ended"); }
    else if (Number.isFinite(m.maxProfit) && -m.maxLoss > 5 * m.maxProfit) { s -= 15; reasons.push("worst loss is more than 5x the best gain (tail risk)"); }
    if (maxLoss != null && Number.isFinite(m.maxLoss) && -m.maxLoss > maxLoss) { s -= 30; reasons.push("worst loss exceeds your limit"); }
    if (walls && view === "neutral" && m.breakevens.length === 2 && walls.support[0] && walls.resistance[0] && m.breakevens[0] <= walls.support[0].strike && m.breakevens[1] >= walls.resistance[0].strike) { s += 10; reasons.push("breakevens sit outside the main put and call OI walls"); }
    const thin = legs.filter((l) => { const ex = chain.expiries.find((e) => e.expiry === l.expiry); const row = ex?.rows.find((r) => r.strike === l.strike); const leg = l.type === "CE" ? row?.ce : l.type === "PE" ? row?.pe : null; return leg && !(leg.vol > 0); }).length;
    if (thin) { s -= 10 * thin; reasons.push(`${thin} leg(s) did not trade today (liquidity)`); }
    const evidence = evidenceFor({ legs, metrics: m, chain, reasons, shortVol, ivPercentile, walls, view, spots });
    out.push({ template: tpl.name, group: tpl.group, legs, metrics: m, score: Math.round(s), reasons, evidence });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Adjustment / roll ideas for an open position from where spot sits against it. */
export function adjustments(legs, chain, metrics) {
  if (!metrics) return [];
  const S = chain.spot, g = metrics.greeks, out = [];
  const be = metrics.breakevens;
  if (be.length === 2 && (S < be[0] * 1.01 || S > be[1] * 0.99)) out.push("Spot is close to a breakeven: consider rolling the tested side further out, or closing it.");
  if (Math.abs(g.delta) > 0.3 * legs.reduce((a, l) => a + l.qty * (chain.lot || 1), 0)) out.push(`Net delta ${g.delta.toFixed(1)} is large for this structure: a futures hedge of ${Math.round(-g.delta / (chain.lot || 1))} lot(s) would neutralise it.`);
  if (g.theta < 0 && metrics.pop < 0.4) out.push("The position pays time decay with a low probability of profit: consider converting the long leg into a spread (sell a further strike).");
  if (g.gamma < 0 && metrics.expiry && chain.expiries[0]?.dte <= 2) out.push("Short gamma into expiry: small moves now cost more; roll out to the next expiry if you want to keep the view.");
  if (!out.length) out.push("No adjustment flagged: spot is inside the breakevens and the Greeks are balanced for this structure.");
  return out;
}

/**
 * How often the structure would have finished in profit historically: the
 * expiry payoff applied to every past move of the same length in the stored
 * spot series (spots: oldest first). A check of the lognormal PoP, not a forecast.
 */
export function historicalHitRate(metrics, spots, sessions, S0) {
  if (!metrics?.grid?.length || !spots || spots.length < sessions + 20) return null;
  const pnlAt = (S) => { const g = metrics.grid; if (S <= g[0].S) return g[0].pnl; if (S >= g[g.length - 1].S) return g[g.length - 1].pnl; let lo = 0, hi = g.length - 1; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (g[mid].S < S) lo = mid; else hi = mid; } const w = (S - g[lo].S) / (g[hi].S - g[lo].S); return g[lo].pnl + w * (g[hi].pnl - g[lo].pnl); };
  let n = 0, wins = 0;
  for (let i = 0; i + sessions < spots.length; i++) { if (!(spots[i] > 0 && spots[i + sessions] > 0)) continue; n++; if (pnlAt(S0 * (spots[i + sessions] / spots[i])) > 0) wins++; }
  return n ? { hitRate: wins / n, n, sessions } : null;
}

/**
 * Evidence ledger for a ranked structure: supporting drivers, counter-evidence,
 * a confidence score, the historical sample behind it and explicit invalidation
 * triggers (price, IV, OI). Every recommendation carries one.
 */
export function evidenceFor({ legs, metrics: m, chain, reasons, shortVol, ivPercentile, walls, view, spots }) {
  const neg = /low \(|expensive|open-ended|tail risk|exceeds|did not trade|little premium/;
  const supporting = reasons.filter((r) => !neg.test(r)), counter = reasons.filter((r) => neg.test(r));
  if (m.ev < 0) counter.push(`model expected value is negative (${Math.round(m.ev)})`);
  if (m.pop < 0.4) counter.push("less likely than not to finish in profit under the model");
  const ex = chain.expiries.find((e) => e.expiry === m.expiry);
  const sessions = Math.max(1, Math.round(((ex?.dte ?? 7) * 5) / 7));
  const hist = spots ? historicalHitRate(m, spots, sessions, chain.spot) : null;
  if (hist && hist.n >= 20) (Math.abs(hist.hitRate - m.pop) > 0.15 ? counter : supporting).push(`historically ${Math.round(hist.hitRate * 100)}% of ${hist.n} past ${sessions}-session moves would have finished in profit (model PoP ${Math.round(m.pop * 100)}%)`);
  const confidence = Math.max(0.05, Math.min(0.85, hist && hist.n >= 20 ? 0.5 * m.pop + 0.5 * hist.hitRate - 0.05 * counter.length : 0.8 * m.pop - 0.05 * counter.length));
  const inv = [];
  const be = m.breakevens.map((b) => Math.round(b));
  if (be.length === 2) inv.push(`price: a close below ${be[0]} or above ${be[1]} (breakevens)`);
  else if (be.length === 1) inv.push(`price: a close ${view === "bearish" ? "above" : "below"} ${be[0]} (breakeven)`);
  const iv = m.iv;
  if (shortVol) inv.push(`IV: ATM IV above ${((iv + 0.05) * 100).toFixed(1)}%${ivPercentile != null ? " or IV percentile above 90%" : ""} (short volatility loses as IV rises)`);
  else if (legs.some((l) => l.type === "CE" || l.type === "PE")) inv.push(`IV: ATM IV below ${(Math.max(0.01, iv - 0.04) * 100).toFixed(1)}% (long premium loses as IV falls)`);
  if (walls?.support?.[0] && walls?.resistance?.[0]) inv.push(view === "bullish" ? `OI: the main put wall (${walls.support[0].strike}) moves lower or unwinds` : view === "bearish" ? `OI: the main call wall (${walls.resistance[0].strike}) moves higher or unwinds` : `OI: the put wall (${walls.support[0].strike}) or call wall (${walls.resistance[0].strike}) shifts toward or past a breakeven`);
  return { supporting, counter, confidence, sample: hist, invalidation: inv, kind: "model estimate", note: "Confidence blends the model probability of profit with the historical hit rate of the same payoff, less a penalty for each counter-point. It is a ranking aid, not a prediction." };
}
