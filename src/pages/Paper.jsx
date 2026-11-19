// Practice portfolio (feature 6.6): pretend to buy and sell with imaginary
// money. Trades fill at the latest stored close (in the stock's currency,
// converted to USD with the stored close in USD), so it is a practice tool,
// not a simulation of real execution, costs or slippage.
import { useMemo, useState } from "react";
import { useData } from "../data/store.jsx";
import { PageHead, Kpi, Pct, StockLink, Empty, Badge } from "../components/ui.jsx";
import { DataTable } from "../components/DataTable.jsx";
import { InstrumentPicker } from "../components/pickers.jsx";
import { usePersistent, uid } from "../lib/storage.js";
import { fmtMoney } from "../lib/format.js";

const START = 100000;

export default function Paper() {
  const d = useData();
  const [book, setBook] = usePersistent("paper", { cash: START, start: START, trades: [], createdAt: new Date().toISOString() });
  const [inst, setInst] = useState(null);
  const [qty, setQty] = useState(10);
  const [err, setErr] = useState(null);
  const px = (id) => { const r = d.rowById.get(id); return r ? { usd: r.flat.closeUsd, local: r.flat.close, asOf: d.info.asOf } : null; };

  const positions = useMemo(() => {
    const m = new Map();
    for (const t of book.trades) {
      const p = m.get(t.id) || { id: t.id, qty: 0, cost: 0, realised: 0 };
      if (t.side === "buy") { p.cost += t.qty * t.priceUsd; p.qty += t.qty; }
      else { const avg = p.qty ? p.cost / p.qty : 0; p.realised += t.qty * (t.priceUsd - avg); p.cost -= avg * t.qty; p.qty -= t.qty; }
      m.set(t.id, p);
    }
    return [...m.values()].map((p) => { const q = px(p.id); const value = q?.usd != null ? p.qty * q.usd : null; return { ...p, sec: d.secById.get(p.id), avg: p.qty ? p.cost / p.qty : null, last: q?.usd ?? null, value, pnl: value != null ? value - p.cost : null, pnlPct: value != null && p.cost ? (value / p.cost - 1) * 100 : null }; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.trades, d.rowById]);
  const open = positions.filter((p) => p.qty > 0);
  const invested = open.reduce((s, p) => s + (p.value || 0), 0);
  const equity = book.cash + invested;
  const realised = positions.reduce((s, p) => s + p.realised, 0);

  const trade = (side) => {
    setErr(null);
    const q = px(inst?.id);
    const n = Math.floor(+qty);
    if (!q?.usd || !(n > 0)) { setErr("Pick a stock with a price and a whole number of shares."); return; }
    const held = positions.find((p) => p.id === inst.id)?.qty || 0;
    if (side === "buy" && n * q.usd > book.cash) { setErr(`Not enough practice cash: ${fmtMoney(book.cash)} available.`); return; }
    if (side === "sell" && n > held) { setErr(`You hold ${held} shares.`); return; }
    setBook({ ...book, cash: book.cash + (side === "buy" ? -1 : 1) * n * q.usd, trades: [...book.trades, { tid: uid(), id: inst.id, side, qty: n, priceUsd: q.usd, priceLocal: q.local, date: q.asOf, at: new Date().toISOString() }] });
  };

  return (
    <div className="stack">
      <PageHead title="Practice portfolio" sub={`Imaginary money: start with ${fmtMoney(START)}, buy and sell at the latest stored close (data to ${d.info.asOf}). No costs, no slippage; for practice only.`}>
        <button className="btn sm ghost" onClick={() => confirm("Reset the practice portfolio to the starting cash? Every practice trade is removed.") && setBook({ cash: START, start: START, trades: [], createdAt: new Date().toISOString() })}>Reset</button>
      </PageHead>
      <div className="grid" style={{ gridTemplateColumns: "repeat(4, minmax(0,1fr))" }}>
        <Kpi label="Total value" value={fmtMoney(equity)} sub={<Pct v={(equity / book.start - 1) * 100} />} />
        <Kpi label="Practice cash" value={fmtMoney(book.cash)} />
        <Kpi label="In positions" value={fmtMoney(invested)} sub={`${open.length} holding${open.length === 1 ? "" : "s"}`} />
        <Kpi label="Realised gain" value={fmtMoney(realised)} cls={realised >= 0 ? "pos" : "neg"} />
      </div>
      <div className="card row" style={{ flexWrap: "wrap", gap: 8 }}>
        <InstrumentPicker secOnly value={inst} onChange={setInst} width={280} />
        <label className="lbl-ctl">Shares<input type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} style={{ width: 90 }} /></label>
        {inst && px(inst.id)?.usd && <span className="small muted">{px(inst.id).local} {d.secById.get(inst.id)?.currency} · ≈ {fmtMoney(px(inst.id).usd * (+qty || 0))}</span>}
        <button className="btn sm primary" onClick={() => trade("buy")}>Buy</button>
        <button className="btn sm" onClick={() => trade("sell")}>Sell</button>
        {err && <span className="small neg">{err}</span>}
      </div>
      {open.length ? (
        <div className="card"><h3>Holdings</h3>
          <DataTable rows={open} exportName="practice_holdings" columns={[
            { key: "s", label: "Stock", value: (p) => p.sec?.symbol, render: (p) => <StockLink sec={p.sec} /> },
            { key: "q", label: "Shares", num: true, value: (p) => p.qty },
            { key: "a", label: "Avg cost (USD)", num: true, value: (p) => p.avg, render: (p) => p.avg?.toFixed(2) },
            { key: "l", label: "Last (USD)", num: true, value: (p) => p.last, render: (p) => p.last?.toFixed(2) },
            { key: "v", label: "Value", num: true, value: (p) => p.value, render: (p) => fmtMoney(p.value) },
            { key: "p", label: "Gain", num: true, value: (p) => p.pnlPct, render: (p) => <Pct v={p.pnlPct} /> },
            { key: "w", label: "Weekly trend", value: (p) => d.rowById.get(p.id)?.flat.mmaW, render: (p) => <Badge kind={d.rowById.get(p.id)?.flat.mmaBullW ? "g" : ""}>{d.rowById.get(p.id)?.flat.mmaW || "—"}</Badge> },
          ]} />
        </div>
      ) : <Empty>No practice holdings yet. Pick a stock and press Buy.</Empty>}
      {book.trades.length > 0 && (
        <div className="card"><h3>Practice trades</h3>
          <DataTable compact pageSize={20} exportName="practice_trades" rows={[...book.trades].reverse().map((t) => ({ ...t, idx: t.tid }))} rowKey={(t) => t.tid} columns={[
            { key: "d", label: "Price date", value: (t) => t.date }, { key: "side", label: "Side", value: (t) => t.side, render: (t) => <Badge kind={t.side === "buy" ? "g" : "r"}>{t.side}</Badge> },
            { key: "s", label: "Stock", value: (t) => d.secById.get(t.id)?.symbol, render: (t) => <StockLink sec={d.secById.get(t.id)} /> },
            { key: "q", label: "Shares", num: true, value: (t) => t.qty }, { key: "p", label: "Price (USD)", num: true, value: (t) => t.priceUsd, render: (t) => t.priceUsd.toFixed(2) },
          ]} />
        </div>
      )}
    </div>
  );
}
