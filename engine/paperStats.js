// Practice-trade performance (owner's feature list, item 5): every sale (or cover) closes part
// of a position at its average cost; the closed pieces give win rate, average win / loss,
// expectancy and the deepest drop of cumulative realised profit (max drawdown). Same measures
// the alert report card uses. Long and short positions; prices in one currency (USD here).
export function paperStats(trades) {
  const pos = new Map(), closed = [];
  for (const t of trades) {
    const p = pos.get(t.id) || { qty: 0, cost: 0 }; // qty < 0 = short
    const q = t.side === "buy" ? t.qty : -t.qty;
    if (p.qty === 0 || Math.sign(p.qty) === Math.sign(q)) { p.cost += Math.abs(q) * t.price; p.qty += q; }
    else {
      const avg = p.cost / Math.abs(p.qty);
      const n = Math.min(Math.abs(q), Math.abs(p.qty));
      const pnl = (p.qty > 0 ? t.price - avg : avg - t.price) * n;
      closed.push({ id: t.id, date: t.date, qty: n, entry: avg, exit: t.price, pnl, ret: (p.qty > 0 ? t.price / avg - 1 : avg / t.price - 1) });
      p.cost -= avg * n; p.qty += p.qty > 0 ? -n : n;
      const rest = Math.abs(q) - n;
      if (rest > 0) { p.qty = Math.sign(q) * rest; p.cost = rest * t.price; }
    }
    pos.set(t.id, p);
  }
  const wins = closed.filter((x) => x.pnl > 0), losses = closed.filter((x) => x.pnl <= 0);
  let cum = 0, peak = 0, maxDd = 0;
  for (const x of closed) { cum += x.pnl; peak = Math.max(peak, cum); maxDd = Math.min(maxDd, cum - peak); }
  const avgW = wins.length ? wins.reduce((s, x) => s + x.pnl, 0) / wins.length : 0, avgL = losses.length ? losses.reduce((s, x) => s + x.pnl, 0) / losses.length : 0;
  const wr = closed.length ? wins.length / closed.length : null;
  return { closed, n: closed.length, winRate: wr, avgWin: avgW, avgLoss: avgL, expectancy: wr == null ? null : wr * avgW + (1 - wr) * avgL, realised: cum, maxDrawdown: maxDd,
    open: [...pos].filter(([, p]) => p.qty !== 0).map(([id, p]) => ({ id, qty: p.qty, avg: p.cost / Math.abs(p.qty) })) };
}
