// Derivatives alert rules, evaluated on the stored end-of-day summaries
// (tas_fo_stats), the exchange's ban / MWPL file (tas_fo_market) and the
// user's saved practice positions.
//
// A rule fires on an EDGE: the condition holds on the latest session and did
// not hold on the one before. The server records (user, rule, underlying,
// session) once in tas_alert_event before sending, exactly like the other alerts.

import { strategyMetrics, marginEstimate, positionPnl } from "./strategy.js";
import { EXCHANGE_RULES } from "./capabilities.js";

const pct = (x, d = 1) => (x == null ? "—" : `${(x * 100).toFixed(d)}%`);
const num = (x, d = 2) => (x == null ? "—" : Number(x).toFixed(d));

/** Rule catalogue. `scope`: und (per underlying summary), market (ban / MWPL), position (saved position). */
export const DERIV_ALERT_RULES = {
  // ---- market & positioning
  fut_price_above: { group: "Market & positioning", scope: "und", label: (p) => `Futures price above ${p.level}`, params: { level: 0 }, test: (s, p) => s.fut?.price > p.level, value: (s) => s.fut?.price },
  fut_price_below: { group: "Market & positioning", scope: "und", label: (p) => `Futures price below ${p.level}`, params: { level: 0 }, test: (s, p) => s.fut?.price > 0 && s.fut.price < p.level, value: (s) => s.fut?.price },
  oi_spike: { group: "Market & positioning", scope: "und", label: (p) => `Futures OI up more than ${pct(p.pct, 0)} in a session`, params: { pct: 0.1 }, test: (s, p) => s.futOiChgPct > p.pct, value: (s) => pct(s.futOiChgPct) },
  oi_drop: { group: "Market & positioning", scope: "und", label: (p) => `Futures OI down more than ${pct(p.pct, 0)} in a session`, params: { pct: 0.1 }, test: (s, p) => s.futOiChgPct < -p.pct, value: (s) => pct(s.futOiChgPct) },
  oi_flip: { group: "Market & positioning", scope: "und", edgeOnly: true, label: () => "Build-up flips between long and short side", params: {}, test: (s, p, prev) => !!prev && side(s.buildup) && side(prev.buildup) && side(s.buildup) !== side(prev.buildup), value: (s, prev) => `${prev?.buildup} → ${s.buildup}` },
  pcr_high: { group: "Market & positioning", scope: "und", label: (p) => `PCR (OI) above ${p.level}`, params: { level: 1.5 }, test: (s, p) => s.pcrOi > p.level, value: (s) => num(s.pcrOi) },
  pcr_low: { group: "Market & positioning", scope: "und", label: (p) => `PCR (OI) below ${p.level}`, params: { level: 0.6 }, test: (s, p) => s.pcrOi != null && s.pcrOi < p.level, value: (s) => num(s.pcrOi) },
  pcr_extreme_z: { group: "Market & positioning", scope: "und", label: (p) => `PCR more than ${p.z} standard deviations from its 60-session norm`, params: { z: 2 }, test: (s, p) => Math.abs(s.pcrZ) >= p.z, value: (s) => `z ${num(s.pcrZ, 1)}` },
  mwpl_near_ban: { group: "Market & positioning", scope: "market", label: (p) => `MWPL use at or above ${pct(p.pct, 0)} (near ban)`, params: { pct: EXCHANGE_RULES.NSE.mwplNearBan }, test: (m, p) => m.pct >= p.pct, value: (m) => pct(m.pct) },
  mwpl_ban: { group: "Market & positioning", scope: "market", label: () => "Enters the F&O ban list (no fresh positions)", params: {}, test: (m) => m.banned, value: (m) => pct(m.pct) },
  mwpl_exit_ban: { group: "Market & positioning", scope: "market", label: () => "Leaves the F&O ban list", params: {}, test: (m, p, prev) => !!prev?.banned && !m.banned, value: (m) => pct(m.pct) },
  basis_anomaly: { group: "Market & positioning", scope: "und", label: (p) => `Futures basis beyond ±${pct(p.pct, 2)} of spot`, params: { pct: 0.01 }, test: (s, p) => Math.abs(s.fut?.basisPct) > p.pct, value: (s) => pct(s.fut?.basisPct, 2) },
  // ---- volatility & Greeks
  iv_rank_above: { group: "Volatility & Greeks", scope: "und", label: (p) => `IV rank above ${pct(p.level, 0)}`, params: { level: 0.8 }, test: (s, p) => s.ivRank > p.level, value: (s) => pct(s.ivRank, 0) },
  iv_rank_below: { group: "Volatility & Greeks", scope: "und", label: (p) => `IV rank below ${pct(p.level, 0)}`, params: { level: 0.2 }, test: (s, p) => s.ivRank != null && s.ivRank < p.level, value: (s) => pct(s.ivRank, 0) },
  iv_pct_above: { group: "Volatility & Greeks", scope: "und", label: (p) => `IV percentile above ${pct(p.level, 0)}`, params: { level: 0.9 }, test: (s, p) => s.ivPct > p.level, value: (s) => pct(s.ivPct, 0) },
  iv_crush: { group: "Volatility & Greeks", scope: "und", edgeOnly: true, label: (p) => `ATM IV falls more than ${pct(p.pct, 0)} in a session`, params: { pct: 0.15 }, test: (s, p, prev) => prev?.atmIv > 0 && s.atmIv > 0 && s.atmIv / prev.atmIv - 1 < -p.pct, value: (s, prev) => `${pct(prev?.atmIv)} → ${pct(s.atmIv)}` },
  iv_expansion: { group: "Volatility & Greeks", scope: "und", edgeOnly: true, label: (p) => `ATM IV rises more than ${pct(p.pct, 0)} in a session`, params: { pct: 0.15 }, test: (s, p, prev) => prev?.atmIv > 0 && s.atmIv > 0 && s.atmIv / prev.atmIv - 1 > p.pct, value: (s, prev) => `${pct(prev?.atmIv)} → ${pct(s.atmIv)}` },
  skew_shift: { group: "Volatility & Greeks", scope: "und", edgeOnly: true, label: (p) => `25-delta skew moves more than ${num(p.pts * 100, 1)} vol points`, params: { pts: 0.02 }, test: (s, p, prev) => prev?.skew25 != null && s.skew25 != null && Math.abs(s.skew25 - prev.skew25) > p.pts, value: (s, prev) => `${pct(prev?.skew25)} → ${pct(s.skew25)}` },
  term_inversion: { group: "Volatility & Greeks", scope: "und", label: () => "IV term structure inverts (near expiry above next)", params: {}, test: (s) => !!s.termInverted, value: (s) => `${pct(s.atmIv)} vs ${pct(s.atmIvNext)}` },
  gamma_flip_cross: { group: "Volatility & Greeks", scope: "und", edgeOnly: true, label: () => "Spot crosses the gamma-flip level (model estimate)", params: {}, test: (s, p, prev) => !!prev && s.gammaFlip > 0 && prev.spot > 0 && Math.sign(s.spot - s.gammaFlip) !== Math.sign(prev.spot - (prev.gammaFlip || s.gammaFlip)), value: (s) => `spot ${num(s.spot, 0)} · flip ${num(s.gammaFlip, 0)}` },
  // ---- flow & microstructure (end-of-day)
  unusual_options: { group: "Flow (end-of-day)", scope: "und", label: (p) => `Options volume z-score at or above ${p.z}`, params: { z: 3 }, test: (s, p) => s.optVolZ >= p.z, value: (s) => `z ${num(s.optVolZ, 1)}` },
  wall_breach_call: { group: "Flow (end-of-day)", scope: "und", edgeOnly: true, label: () => "Spot closes above the previous call OI wall", params: {}, test: (s) => s.callWallPrev > 0 && s.spot > s.callWallPrev, value: (s) => `wall ${s.callWallPrev}` },
  wall_breach_put: { group: "Flow (end-of-day)", scope: "und", edgeOnly: true, label: () => "Spot closes below the previous put OI wall", params: {}, test: (s) => s.putWallPrev > 0 && s.spot < s.putWallPrev, value: (s) => `wall ${s.putWallPrev}` },
  wall_shift: { group: "Flow (end-of-day)", scope: "und", edgeOnly: true, label: () => "Largest call or put OI wall moves to a new strike", params: {}, test: (s) => (s.callWallPrev && s.callWall !== s.callWallPrev) || (s.putWallPrev && s.putWall !== s.putWallPrev), value: (s) => `call ${s.callWallPrev}→${s.callWall} · put ${s.putWallPrev}→${s.putWall}` },
  price_oi_divergence: { group: "Flow (end-of-day)", scope: "und", label: (p) => `Price and futures OI move in opposite directions by more than ${pct(p.pct, 1)} / ${pct(p.oi, 0)}`, params: { pct: 0.01, oi: 0.05 }, test: (s, p) => s.spotChg != null && s.futOiChgPct != null && Math.abs(s.spotChg) > p.pct && Math.abs(s.futOiChgPct) > p.oi && Math.sign(s.spotChg) !== Math.sign(s.futOiChgPct), value: (s) => `price ${pct(s.spotChg)} · OI ${pct(s.futOiChgPct)}` },
  // ---- strategy & portfolio (saved practice positions)
  pnl_target: { group: "Strategy & portfolio", scope: "position", label: (p) => `Position P&L reaches +${p.amount}`, params: { amount: 5000 }, test: (x, p) => x.pnl >= p.amount, value: (x) => Math.round(x.pnl) },
  stop_loss: { group: "Strategy & portfolio", scope: "position", label: (p) => `Position P&L falls to -${p.amount}`, params: { amount: 5000 }, test: (x, p) => x.pnl <= -p.amount, value: (x) => Math.round(x.pnl) },
  breakeven_near: { group: "Strategy & portfolio", scope: "position", label: (p) => `Spot within ${pct(p.pct, 1)} of a breakeven`, params: { pct: 0.01 }, test: (x, p) => x.metrics?.breakevens.some((b) => Math.abs(x.spot / b - 1) < p.pct), value: (x) => x.metrics?.breakevens.map((b) => b.toFixed(0)).join(" / ") },
  pop_drop: { group: "Strategy & portfolio", scope: "position", label: (p) => `Probability of profit below ${pct(p.level, 0)}`, params: { level: 0.35 }, test: (x, p) => x.metrics?.pop < p.level, value: (x) => pct(x.metrics?.pop, 0) },
  margin_spike: { group: "Strategy & portfolio", scope: "position", label: (p) => `Estimated margin above ${p.amount}`, params: { amount: 200000 }, test: (x, p) => x.margin > p.amount, value: (x) => Math.round(x.margin) },
  physical_delivery: { group: "Strategy & portfolio", scope: "position", label: (p) => `Stock contract within ${p.days} days of expiry (physical settlement)`, params: { days: EXCHANGE_RULES.NSE.physicalWarnDays }, test: (x, p) => x.kind !== "index" && x.dte != null && x.dte <= p.days, value: (x) => `${x.dte} days to ${x.expiry}` },
};

function side(b) { return b === "long_buildup" || b === "short_covering" ? "long" : b === "short_buildup" || b === "long_unwinding" ? "short" : null; }

export const DERIV_ALERT_GROUPS = [...new Set(Object.values(DERIV_ALERT_RULES).map((r) => r.group))];
export const describeDerivRule = (rule, params) => { const R = DERIV_ALERT_RULES[rule]; return R ? R.label({ ...R.params, ...(params || {}) }) : rule; };

/** Market view of one underlying from the exchange's ban list and MWPL file. */
export function marketView(market, und) {
  if (!market) return null;
  const m = (market.mwpl || []).find((x) => x.symbol === und);
  return { date: market.date, pct: m?.pct ?? null, banned: (market.ban || []).includes(und) };
}

/** Position view at a session (chain = enriched chain of that session). */
export function positionView(pos, chain) {
  const metrics = strategyMetrics(pos.legs, chain);
  const pnl = positionPnl(pos.legs, chain.spot, chain, { t: 0 });
  const exps = pos.legs.map((l) => l.expiry).filter(Boolean).sort();
  const ex = chain.expiries.find((e) => e.expiry === exps[0]);
  return { pnl, metrics, margin: marginEstimate(pos.legs, chain).estimate, spot: chain.spot, kind: chain.kind, expiry: exps[0] || null, dte: ex?.dte ?? null, date: chain.date };
}

/**
 * Evaluate one rule. cur / prev: the latest and previous session's object for
 * the rule's scope (summary, market view or position view). Returns
 * {fired, holds, text, value, session}.
 */
export function evaluateDerivRule(rule, params, cur, prev) {
  const R = DERIV_ALERT_RULES[rule];
  if (!R || !cur) return { fired: false, holds: false };
  const p = { ...R.params, ...(params || {}) };
  const holds = !!R.test(cur, p, prev);
  const before = R.edgeOnly || !prev ? false : !!R.test(prev, p, null);
  return { fired: holds && !before, holds, text: R.label(p), value: R.value ? R.value(cur, prev) : null, session: cur.date };
}

/** Priority tiers decide channels: high = every channel, normal = Telegram + push + app, low = app only. */
export const PRIORITY_CHANNELS = { high: ["app", "telegram", "push", "email", "webhook"], normal: ["app", "telegram", "push", "webhook"], low: ["app"] };
