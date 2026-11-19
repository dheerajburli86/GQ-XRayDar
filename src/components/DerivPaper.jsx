// Practice futures and options (rupees). Fills at the latest stored end-of-day price,
// with estimated Indian costs; no margin check, no slippage. Never touches a real account.
import { useEffect, useMemo, useState } from "react";
import { getDerivApi } from "../data/derivApi.js";
import { Kpi, Badge, Empty } from "./ui.jsx";
import { DataTable } from "./DataTable.jsx";
import { usePersistent } from "../lib/storage.js";
import { newDerivBook, placeOrder, markBook, quoteFrom, contractName, contractKey, PAPER_DERIV_START } from "../../engine/deriv/paperBook.js";

const inr = (v) => (v == null ? "—" : `₹${Math.round(v).toLocaleString("en-IN")}`);

export default function DerivPaper() {
  const api = useMemo(() => getDerivApi(), []);
  const [book, setBook] = usePersistent("paper.deriv", newDerivBook());
  const [unds, setUnds] = useState([]);
  const [und, setUnd] = useState("");
  const [days, setDays] = useState({});
  const [kind, setKind] = useState("FUT");
  const [expiry, setExpiry] = useState("");
  const [strike, setStrike] = useState("");
  const [cp, setCp] = useState(1);
  const [lots, setLots] = useState(1);
  const [err, setErr] = useState(null);
  const [state, setState] = useState("loading");

  useEffect(() => { let on = true; api.latest().then((r) => { if (!on) return; const u = [...new Set(r.map((x) => x.und))]; setUnds(u); setUnd((x) => x || u.find((n) => n === "NIFTY") || u[0] || ""); setState(u.length ? "ok" : "empty"); }).catch(() => on && setState("error")); return () => { on = false; }; }, [api]);
  // the latest stored session for the chosen underlying and for each one held
  const needed = useMemo(() => [...new Set([und, ...book.trades.map((t) => t.und)].filter(Boolean))], [und, book.trades]);
  useEffect(() => { let on = true; Promise.all(needed.map((u) => days[u] ? [u, days[u]] : api.chain(u).then((c) => [u, c]).catch(() => [u, null]))).then((r) => on && setDays((d) => ({ ...d, ...Object.fromEntries(r.filter(([, c]) => c)) }))); return () => { on = false; }; // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needed.join(","), api]);

  const day = days[und];
  const expiries = useMemo(() => [...new Set([...(kind === "FUT" ? day?.futures || [] : day?.options || [])].map((x) => x.expiry))].filter((e) => e > (day?.date || "")).sort(), [day, kind]);
  const strikes = useMemo(() => [...new Set((day?.options || []).filter((o) => o.expiry === (expiry || expiries[0])).map((o) => o.strike))].sort((a, b) => a - b), [day, expiry, expiries]);
  const ex = expiry && expiries.includes(expiry) ? expiry : expiries[0] || "";
  const k = strike && strikes.includes(+strike) ? +strike : strikes.length ? strikes.reduce((a, b) => (Math.abs(b - day.spot) < Math.abs(a - day.spot) ? b : a)) : null;
  const contract = { und, kind, expiry: ex, strike: kind === "OPT" ? k : null, cp: kind === "OPT" ? cp : null };
  const quote = day && ex ? quoteFrom(day, contract) : null;

  const m = useMemo(() => markBook(book, days), [book, days]);
  const open = m.positions.filter((p) => p.open);
  const trade = (side) => {
    setErr(null);
    const r = placeOrder(book, { ...contract, side, lots }, quote);
    if (r.error) setErr(r.error); else setBook(r.book);
  };
  const closeOut = (p) => {
    const day2 = days[p.und]; const q = day2 && !p.expired ? quoteFrom(day2, p) : null;
    const r = placeOrder(book, { ...p, side: p.net > 0 ? -1 : 1, lots: Math.abs(p.net) / p.lot }, q);
    if (r.error) setErr(r.error); else setBook(r.book);
  };

  if (state === "loading") return <div className="small muted">Loading the stored derivatives sessions…</div>;
  if (state !== "ok") return <Empty>{state === "error" ? "The derivatives data could not be loaded. Try again shortly." : "No derivatives sessions are stored yet, so there is nothing to practise on."}</Empty>;
  return (
    <div className="stack">
      <div className="small muted">Futures and options practice in rupees: start with {inr(PAPER_DERIV_START)}. Orders fill at the stored end-of-day price of the latest session ({day?.date || "…"}), with estimated brokerage, STT, exchange and stamp costs. There is no margin check, no live quote and no slippage, so a short option here is far easier than the real thing. Futures settle into cash when you close them.</div>
      <div className="grid" style={{ gridTemplateColumns: "repeat(4, minmax(0,1fr))" }}>
        <Kpi label="Total value" value={inr(m.equity)} cls={m.equity >= book.start ? "pos" : "neg"} sub={`${((m.equity / book.start - 1) * 100).toFixed(2)}%`} />
        <Kpi label="Practice cash" value={inr(book.cash)} />
        <Kpi label="Open (marked)" value={inr(m.optValue + m.futUnreal)} sub={`${open.length} position${open.length === 1 ? "" : "s"}${m.unmarked ? `, ${m.unmarked} unmarked` : ""}`} />
        <Kpi label="Costs paid" value={inr(m.fees)} />
      </div>
      <div className="card row" style={{ flexWrap: "wrap", gap: 8 }}>
        <label className="lbl-ctl">Underlying<select value={und} onChange={(e) => { setUnd(e.target.value); setExpiry(""); setStrike(""); }}>{unds.map((u) => <option key={u}>{u}</option>)}</select></label>
        <label className="lbl-ctl">Type<select value={kind} onChange={(e) => { setKind(e.target.value); setExpiry(""); }}><option value="FUT">Future</option><option value="OPT">Option</option></select></label>
        <label className="lbl-ctl">Expiry<select value={ex} onChange={(e) => setExpiry(e.target.value)}>{expiries.map((e) => <option key={e}>{e}</option>)}</select></label>
        {kind === "OPT" && <label className="lbl-ctl">Strike<select value={k ?? ""} onChange={(e) => setStrike(e.target.value)}>{strikes.map((s) => <option key={s}>{s}</option>)}</select></label>}
        {kind === "OPT" && <label className="lbl-ctl">Call / put<select value={cp} onChange={(e) => setCp(+e.target.value)}><option value={1}>Call</option><option value={-1}>Put</option></select></label>}
        <label className="lbl-ctl">Lots<input type="number" min="1" value={lots} onChange={(e) => setLots(e.target.value)} style={{ width: 70 }} /></label>
        <span className="small muted">{quote ? `${quote.price} × ${quote.lot} per lot · ${quote.traded ? "last traded" : "settlement price"}` : "no stored price for this contract"}</span>
        <button className="btn sm primary" disabled={!quote} onClick={() => trade(1)}>Buy</button>
        <button className="btn sm" disabled={!quote} onClick={() => trade(-1)}>Sell</button>
        <button className="btn sm ghost" onClick={() => confirm("Reset the futures and options practice book? Every practice trade is removed.") && setBook(newDerivBook())}>Reset</button>
        {err && <span className="small neg">{err}</span>}
      </div>
      {open.length ? (
        <div className="card"><h3>Open positions</h3>
          <DataTable rows={open} rowKey={(p) => p.key} exportName="practice_deriv_positions" columns={[
            { key: "c", label: "Contract", value: (p) => contractName(p) },
            { key: "q", label: "Lots", num: true, value: (p) => p.net / p.lot, render: (p) => (p.net > 0 ? "+" : "") + p.net / p.lot },
            { key: "a", label: "Avg price", num: true, value: (p) => p.avg, render: (p) => p.avg.toFixed(2) },
            { key: "l", label: "Last", num: true, value: (p) => p.last, render: (p) => (p.last == null ? "—" : p.last.toFixed(2)) },
            { key: "s", label: "Price from", value: (p) => p.source, render: (p) => <Badge kind={p.expired ? "r" : ""}>{p.source}</Badge> },
            { key: "u", label: "Open gain / loss", num: true, value: (p) => p.unreal, render: (p) => <span className={p.unreal >= 0 ? "pos" : "neg"}>{inr(p.unreal)}</span> },
            { key: "x", label: "", value: () => "", render: (p) => (p.expired ? <span className="small muted">expired</span> : <button className="btn sm" onClick={() => closeOut(p)}>Close</button>) },
          ]} />
          {open.some((p) => p.expired) && <div className="small muted" style={{ marginTop: 6 }}>Expired contracts are valued at their expiry value (spot for futures, intrinsic for options). Settling them into cash is not automatic yet; they stay in the open value until the book is reset.</div>}
        </div>
      ) : <Empty>No open derivative positions. Pick a contract and press Buy or Sell.</Empty>}
      {book.trades.length > 0 && (
        <div className="card"><h3>Practice derivative trades</h3>
          <DataTable compact pageSize={15} exportName="practice_deriv_trades" rowKey={(t) => t.tid} rows={[...book.trades].reverse()} columns={[
            { key: "d", label: "Price date", value: (t) => t.date },
            { key: "s", label: "Side", value: (t) => t.side, render: (t) => <Badge kind={t.side > 0 ? "g" : "r"}>{t.side > 0 ? "buy" : "sell"}</Badge> },
            { key: "c", label: "Contract", value: (t) => contractKey(t), render: (t) => contractName(t) },
            { key: "q", label: "Lots", num: true, value: (t) => t.lots },
            { key: "p", label: "Price", num: true, value: (t) => t.price, render: (t) => t.price.toFixed(2) },
            { key: "f", label: "Costs", num: true, value: (t) => t.fee, render: (t) => inr(t.fee) },
          ]} />
        </div>
      )}
    </div>
  );
}
