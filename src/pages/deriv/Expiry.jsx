// Expiry & event war room: max pain and its drift, OI walls, pin risk,
// expected moves and probabilities, gamma flip, decay into expiry, a written
// synthesis in probabilistic language, the catalyst calendar, and the audit of
// implied vs realised expiry moves.
import { useMemo, useState } from "react";
import { PageHead, Kpi, Tabs, Select, Badge, Loading } from "../../components/ui.jsx";
import { DataTable } from "../../components/DataTable.jsx";
import { XYChart } from "../../components/XYChart.jsx";
import { TvChart, lineData } from "../../components/TvChart.jsx";
import { useAsync } from "../../lib/useAsync.js";
import { navigate } from "../../lib/router.js";
import { usePersistent, uid } from "../../lib/storage.js";
import { useData } from "../../data/store.jsx";
import { useDerivRows, DerivGate, UndSelect, DataNote, fp, fn, fiv, useUnderlyingSec, pc } from "./common.jsx";
import { enrichChain, maxPain, oiWalls, expectedMove, gexProfile, gex, probabilities, atmIv } from "../../../engine/deriv/chain.js";
import { gbs } from "../../../engine/deriv/pricing.js";

export default function Expiry({ route }) {
  const { api, status, rows, loading, error } = useDerivRows();
  const und = route.query.und || rows?.find((r) => r.und === "NIFTY")?.und || rows?.[0]?.und;
  const [tab, setTab] = useState("war");
  const day = useAsync(() => (und ? api.chain(und) : Promise.resolve(null)), [und]);
  const hist = useAsync(() => (und ? api.history(und) : Promise.resolve([])), [und]);
  const chain = useMemo(() => (day.data ? enrichChain(day.data) : null), [day.data]);
  return (
    <div className="stack">
      <PageHead title="Expiry & event war room" sub="Where open interest, gamma and implied moves concentrate into expiry, with the events that can move volatility." />
      <DerivGate status={status} loading={loading} error={error}>
        <div className="card row wrap" style={{ gap: 10 }}><UndSelect rows={rows} value={und} onChange={(u) => navigate("dexpiry", { und: u })} /></div>
        <DataNote status={status} />
        <Tabs value={tab} onChange={setTab} tabs={[{ value: "war", label: "War room" }, { value: "cal", label: "Catalyst calendar" }, { value: "audit", label: "Implied vs realised moves" }]} />
        {day.loading && <Loading />}
        {chain && tab === "war" && <WarRoom chain={chain} hist={hist.data || []} />}
        {tab === "cal" && <Calendar rows={rows} chain={chain} und={und} />}
        {tab === "audit" && hist.data && <MoveAudit hist={hist.data} />}
      </DerivGate>
    </div>
  );
}

function WarRoom({ chain, hist }) {
  const exps = chain.expiries.filter((e) => e.rows.length >= 3);
  const [exp, setExp] = useState(exps[0]?.expiry);
  const ex = exps.find((e) => e.expiry === exp) || exps[0];
  const mp = maxPain(ex), w = oiWalls(ex, chain.spot, 3), em = expectedMove(ex, chain.spot), gx = gex(ex, chain.spot, chain.lot);
  const prof = gexProfile(chain, { expiries: [ex.expiry], steps: 31 });
  const iv = atmIv(ex);
  const pr = em.range1 ? probabilities(ex.F, ex.T, iv, { low: em.range1[0], high: em.range1[1], above: w.resistance[0]?.strike, below: w.support[0]?.strike }) : null;
  const top = [...gx.byStrike].sort((a, b) => Math.abs(b.net) - Math.abs(a.net)).slice(0, 3);
  // Theta of the ATM straddle as expiry approaches (decay acceleration).
  const K = em.atm, decay = [];
  for (let dte = Math.max(1, ex.dte); dte >= 0; dte--) { const T = Math.max(dte, 0.25) / 365; const s = gbs(1, ex.F, K, T, 0.065, 0, iv || 0.15).price + gbs(-1, ex.F, K, T, 0.065, 0, iv || 0.15).price; decay.push({ x: dte, y: s }); }
  const drift = hist.filter((h) => h.nearExpiry === ex.expiry && h.maxPain != null);
  const pinZone = [w.support[0]?.strike, w.resistance[0]?.strike].filter((x) => x != null);
  const synth = [
    em.range1 ? `The ATM straddle prices a move of about ±${pc(em.straddlePct, 1)} to ${ex.expiry}; the 1-sd range from IV is ${fn(em.range1[0], 0)}–${fn(em.range1[1], 0)}${pr?.inside != null ? ` (about ${pc(pr.inside)} risk-neutral probability of finishing inside it)` : ""}.` : null,
    w.support[0] && w.resistance[0] ? `Open interest is heaviest at the ${w.support[0].strike} put and ${w.resistance[0].strike} call strikes. Settlements have often gravitated inside such walls into expiry, but walls move as positions roll; treat ${pinZone.join("–")} as a zone of interest, not a target.` : null,
    mp.strike ? `Max pain sits at ${mp.strike} (${fp(mp.strike / chain.spot - 1)} from spot)${drift.length > 1 ? `, having moved from ${drift[0].maxPain} on ${drift[0].date}` : ""}. It is one input; nothing here implies the price will settle there.` : null,
    prof.flip ? `Estimated dealer gamma flips near ${fn(prof.flip, 0)}: ${chain.spot >= prof.flip ? "above it hedging tends to dampen moves; a break below could see moves amplify" : "below it hedging tends to amplify moves; a recovery above could see them dampen"} (estimate from OI; dealer positions are not published).` : null,
    ex.dte <= 2 ? "Inside the last two sessions time decay accelerates sharply and high-gamma strikes near spot make P&L most sensitive to small moves (pin risk)." : null,
  ].filter(Boolean);
  return (
    <div className="stack">
      <div className="card row wrap"><Select value={ex.expiry} onChange={setExp} options={exps.map((e) => ({ value: e.expiry, label: `${e.expiry} (${e.dte}d)` }))} label="Expiry" /></div>
      <div className="kpis">
        <Kpi label="Spot" value={fn(chain.spot)} sub={`${ex.dte} days to expiry`} />
        <Kpi label="Max pain" value={mp.strike ?? "—"} sub={mp.strike ? fp(mp.strike / chain.spot - 1) : ""} />
        <Kpi label="Put wall / call wall" value={`${w.support[0]?.strike ?? "—"} / ${w.resistance[0]?.strike ?? "—"}`} />
        <Kpi label="Expected move (straddle)" value={`±${pc(em.straddlePct, 1)}`} sub={`±${fn(em.straddle, 0)} pts`} />
        <Kpi label="2-sd range" value={em.range2 ? `${fn(em.range2[0], 0)}–${fn(em.range2[1], 0)}` : "—"} />
        <Kpi label="Gamma flip" value={prof.flip ? fn(prof.flip, 0) : "—"} sub={prof.regime === "positive" ? "positive gamma at spot" : "negative gamma at spot"} />
        <Kpi label="High-gamma strikes" value={top.map((t) => t.strike).join(", ")} />
      </div>
      <div className="card"><div className="h3">Synthesis</div>{synth.map((s) => <p key={s} className="small">{s}</p>)}
        {pr && <p className="small muted">Probabilities (risk-neutral, from IV {fiv(iv)}): finish above the call wall {pc(pr.above)} (touch about {pc(pr.touchAbove)}); below the put wall {pc(pr.below)} (touch about {pc(pr.touchBelow)}).</p>}</div>
      <div className="grid g2">
        <div className="card"><div className="h3">OI walls and max pain</div>
          <XYChart height={240} series={[{ name: "Call OI", type: "bar", color: "#16a34a", points: ex.rows.map((x) => ({ x: x.strike, y: x.ce?.oi ?? null })) }, { name: "Put OI", type: "bar", color: "#dc2626", points: ex.rows.map((x) => ({ x: x.strike, y: x.pe?.oi ?? null })) }]}
            markers={[{ x: chain.spot, label: "spot", color: "var(--text)" }, { x: mp.strike, label: "max pain", color: "#d97706" }, ...(em.range1 || []).map((x, i) => ({ x, label: i ? "+1sd" : "−1sd", color: "#2563eb" }))]} /></div>
        <div className="card"><div className="h3">ATM straddle value into expiry (decay)</div>
          <XYChart height={240} series={[{ name: "Straddle", type: "line", color: "#7c3aed", points: decay }]} xLabel="days to expiry" /></div>
      </div>
      {drift.length > 1 && <div className="card"><div className="h3">Max pain drift for {ex.expiry}</div>
        <TvChart height={200} series={[{ id: "mp", type: "line", data: lineData(drift.map((h) => h.date), drift.map((h) => h.maxPain)), options: { color: "#d97706", title: "max pain" } }, { id: "s", type: "line", data: lineData(drift.map((h) => h.date), drift.map((h) => h.spot)), options: { color: "#64748b", title: "spot" } }]} /></div>}
    </div>
  );
}

function Calendar({ rows, chain, und }) {
  const d = useData();
  const secOf = useUnderlyingSec();
  const [mine, setMine] = usePersistent("deriv.events", []);
  const [draft, setDraft] = useState({ date: "", title: "", kind: "Macro" });
  const row = rows?.find((r) => r.und === und);
  const sec = row ? secOf(und, row.kind) : null;
  const snap = useAsync(() => (sec ? d.api.snapshot(sec.id) : Promise.resolve(null)), [sec?.id]);
  const acts = useAsync(() => (d.api.corporateActions ? d.api.corporateActions() : Promise.resolve([])), []);
  const events = [];
  for (const e of chain?.expiries || []) events.push({ date: e.expiry, kind: "Expiry", title: `${und} options expiry`, source: "exchange" });
  for (const f of chain?.futures || []) if (!events.some((x) => x.date === f.expiry)) events.push({ date: f.expiry, kind: "Expiry", title: `${und} futures expiry`, source: "exchange" });
  for (const r of snap.data?.f?.results || []) if (r.filed) events.push({ date: r.filed, kind: "Results", title: `${und} results filed${r.revenueYoY != null ? ` (revenue ${r.revenueYoY > 0 ? "+" : ""}${r.revenueYoY}% YoY)` : ""}`, source: "fundamentals" });
  for (const a of (acts.data || []).filter((x) => x.instrumentId === sec?.id)) events.push({ date: a.exDate, kind: "Corporate action", title: `${a.type} (factor ${a.factor})`, source: a.source || "corporate actions" });
  for (const m of mine) events.push({ ...m, source: "added by you" });
  events.sort((a, b) => (a.date < b.date ? 1 : -1));
  return (
    <div className="stack">
      <div className="card row wrap" style={{ gap: 8 }}>
        <input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
        <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>{["Macro", "RBI / central bank", "Fed", "Budget", "Election", "Dividend", "Results", "Other"].map((k) => <option key={k}>{k}</option>)}</select>
        <input placeholder="Event (e.g. RBI policy decision)" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} style={{ flex: 1, minWidth: 220 }} />
        <button className="btn sm primary" onClick={() => { if (draft.date && draft.title) { setMine([...mine, { id: uid(), ...draft }]); setDraft({ date: "", title: "", kind: "Macro" }); } }}>Add event</button>
      </div>
      <div className="card">
        <DataTable rows={events.map((e, i) => ({ ...e, id: e.id || i }))} exportName={`catalysts-${und}`} columns={[
          { key: "d", label: "Date", value: (e) => e.date }, { key: "k", label: "Type", value: (e) => e.kind, render: (e) => <Badge kind={e.kind === "Expiry" ? "b" : e.kind === "Results" ? "a" : ""}>{e.kind}</Badge> },
          { key: "t", label: "Event", value: (e) => e.title }, { key: "s", label: "Source", value: (e) => e.source },
          { key: "x", label: "", export: false, value: () => "", render: (e) => (e.source === "added by you" ? <a style={{ cursor: "pointer" }} onClick={() => setMine(mine.filter((m) => m.id !== e.id))}>remove</a> : null) },
        ]} />
        <p className="legend-note">Expiries come from the exchange's contract list, results dates from the fundamentals feed and corporate actions from this app's table. Macro and policy dates (RBI, Fed, budget, elections, data releases) need a calendar feed that is not connected yet; add them by hand meanwhile.</p>
      </div>
    </div>
  );
}

/** At each session about five days before an expiry, compare the straddle-implied move with what happened by expiry. */
function MoveAudit({ hist }) {
  const byExp = new Map();
  for (const h of hist) if (h.nearExpiry && h.expMovePct != null) { const a = byExp.get(h.nearExpiry) || []; a.push(h); byExp.set(h.nearExpiry, a); }
  const out = [];
  for (const [exp, hs] of byExp) {
    const start = hs.find((h) => h.nearDte != null && h.nearDte <= 7) || null;
    const end = hist.filter((h) => h.date <= exp).at(-1);
    if (!start || !end || end.date < exp || start === end) continue;
    const realised = Math.abs(end.spot / start.spot - 1);
    out.push({ id: exp, expiry: exp, from: start.date, implied: start.expMovePct, realised, ratio: start.expMovePct ? realised / start.expMovePct : null, inside: realised <= start.expMovePct });
  }
  const n = out.length, inside = out.filter((x) => x.inside).length;
  const avgRatio = n ? out.reduce((a, x) => a + (x.ratio || 0), 0) / n : null;
  return (
    <div className="card">
      <div className="kpis" style={{ border: 0 }}>
        <Kpi label="Expiries audited" value={n} />
        <Kpi label="Finished inside the implied move" value={n ? pc(inside / n) : "—"} sub="about 68% expected if the straddle is fair" />
        <Kpi label="Realised ÷ implied (average)" value={avgRatio?.toFixed(2) ?? "—"} sub={avgRatio == null ? "" : avgRatio < 0.85 ? "volatility has tended to be over-priced" : avgRatio > 1.15 ? "volatility has tended to be under-priced" : "roughly fair"} />
      </div>
      <DataTable compact rows={out} exportName="implied-vs-realised" columns={[{ key: "e", label: "Expiry", value: (x) => x.expiry }, { key: "f", label: "Measured from", value: (x) => x.from }, { key: "i", label: "Implied (straddle)", num: true, value: (x) => x.implied, render: (x) => `±${pc(x.implied, 1)}` }, { key: "r", label: "Realised", num: true, value: (x) => x.realised, render: (x) => fp(x.realised) }, { key: "in", label: "Inside?", value: (x) => (x.inside ? "yes" : "no") }]} />
      <p className="legend-note">Needs stored sessions spanning past expiries; the table fills in as history builds.</p>
    </div>
  );
}
