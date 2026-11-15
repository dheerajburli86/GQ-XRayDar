// Unusual activity: market-wide spikes in option volume, futures volume and
// open interest, then contract-level anomalies for one underlying against its
// own recent baseline, with a hedged attribution of the likely flow.
import { useMemo, useState } from "react";
import { PageHead, Badge, Loading, Tabs } from "../../components/ui.jsx";
import { DataTable } from "../../components/DataTable.jsx";
import { useAsync } from "../../lib/useAsync.js";
import { navigate, href } from "../../lib/router.js";
import { useDerivRows, DerivGate, UndSelect, DataNote, FP, fp, fn, fiv } from "./common.jsx";
import { enrichChain } from "../../../engine/deriv/chain.js";
import { chainAnomalies, attributeFlow, optionFlow } from "../../../engine/deriv/positioning.js";

export default function Unusual({ route }) {
  const { api, status, rows, loading, error } = useDerivRows();
  const und = route.query.und || rows?.find((r) => r.und === "NIFTY")?.und || rows?.[0]?.und;
  const [tab, setTab] = useState(route.query.und ? "contract" : "market");
  return (
    <div className="stack">
      <PageHead title="Unusual activity" sub="Statistically unusual volume, open interest and premium, against each instrument's own baseline (end-of-day)." />
      <DerivGate status={status} loading={loading} error={error}>
        <DataNote status={status} />
        <Tabs value={tab} onChange={setTab} tabs={[{ value: "market", label: "Market-wide" }, { value: "contract", label: "By contract" }]} />
        {tab === "market" && <Market rows={rows} />}
        {tab === "contract" && <Contracts api={api} und={und} rows={rows} />}
        <p className="legend-note">Not available from end-of-day files and therefore not shown: the live tape, block and sweep detection across strikes, multi-leg prints and aggressive buyer / seller classification. They need the live feed listed under Data sources.</p>
      </DerivGate>
    </div>
  );
}

function Market({ rows }) {
  const list = useMemo(() => (rows || []).map((r) => {
    const tags = [];
    if (r.s.optVolZ >= 2.5) tags.push(`option volume ${r.s.optVolZ.toFixed(1)} sd above its 20-session norm`);
    if (r.s.futVolRatio >= 2) tags.push(`futures volume ${r.s.futVolRatio.toFixed(1)}x its 20-session average`);
    if (Math.abs(r.s.futOiChgPct || 0) >= 0.08) tags.push(`futures OI ${fp(r.s.futOiChgPct)} in a session`);
    if (r.s.pcrZ != null && Math.abs(r.s.pcrZ) >= 2) tags.push(`PCR ${r.s.pcrZ.toFixed(1)} sd from its norm`);
    if (r.s.callWallPrev != null && r.s.callWall !== r.s.callWallPrev) tags.push(`call wall ${r.s.callWallPrev} → ${r.s.callWall}`);
    if (r.s.putWallPrev != null && r.s.putWall !== r.s.putWallPrev) tags.push(`put wall ${r.s.putWallPrev} → ${r.s.putWall}`);
    return tags.length ? { ...r, tags } : null;
  }).filter(Boolean), [rows]);
  return (
    <div className="card">
      <DataTable rows={list} exportName="unusual-market" initialSort={{ key: "z", dir: "desc" }} columns={[
        { key: "u", label: "Underlying", value: (r) => r.und, render: (r) => <a href={href("dunusual", { und: r.und })}>{r.und}</a> },
        { key: "z", label: "Option vol z", num: true, value: (r) => r.s.optVolZ, render: (r) => r.s.optVolZ?.toFixed(1) ?? "—" },
        { key: "p", label: "Premium traded (₹ Cr)", num: true, value: (r) => r.s.optTurnover, render: (r) => fn((r.s.optTurnover || 0) / 1e7, 1) },
        { key: "c", label: "Price 1D", num: true, value: (r) => r.s.spotChg, render: (r) => <FP v={r.s.spotChg} d={2} /> },
        { key: "t", label: "What is unusual", value: (r) => r.tags.join("; ") },
      ]} />
    </div>
  );
}

function Contracts({ api, und, rows }) {
  const dates = useAsync(() => api.chainDates(und), [und]);
  const data = useAsync(async () => {
    const ds = (dates.data || []).slice(-11);
    if (!ds.length) return null;
    const days = await Promise.all(ds.map((d) => api.chain(und, d)));
    const chains = days.filter(Boolean).map((d) => enrichChain(d));
    const cur = chains.at(-1), prev = chains.at(-2);
    const base = new Map();
    for (const c of chains.slice(0, -1)) for (const ex of c.expiries) for (const r of ex.rows) for (const l of [r.ce, r.pe]) if (l) { const k = `${ex.expiry}|${r.strike}|${l.cp}`; const b = base.get(k) || { vol: [], oi: [] }; b.vol.push(l.vol || 0); b.oi.push(l.oi || 0); base.set(k, b); }
    const an = chainAnomalies(cur, base);
    const ivPrev = (a) => { const ex = prev?.expiries.find((e) => e.expiry === a.expiry); const row = ex?.rows.find((r) => r.strike === a.strike); return (a.type === "CE" ? row?.ce : row?.pe)?.iv ?? null; };
    return an.map((a) => {
      const ex = cur.expiries.find((e) => e.expiry === a.expiry); const row = ex.rows.find((r) => r.strike === a.strike); const leg = a.type === "CE" ? row.ce : row.pe;
      const flow = optionFlow(leg, { ivPrev: ivPrev(a) });
      return { ...a, id: `${a.expiry}${a.strike}${a.type}`, flow, attr: attributeFlow(a, flow) };
    });
  }, [dates.data]);
  return (
    <div className="card">
      <UndSelect rows={rows} value={und} onChange={(u) => navigate("dunusual", { und: u })} />
      {!data.data ? <Loading what="recent chains" /> : (
        <DataTable rows={data.data} exportName={`unusual-${und}`} columns={[
          { key: "e", label: "Expiry", value: (a) => a.expiry }, { key: "k", label: "Strike", num: true, value: (a) => a.strike }, { key: "t", label: "Type", value: (a) => a.type },
          { key: "v", label: "Volume", num: true, value: (a) => a.vol, render: (a) => fn(a.vol, 0) }, { key: "z", label: "Vol z", num: true, value: (a) => a.zVol, render: (a) => a.zVol?.toFixed(1) ?? "—" },
          { key: "voi", label: "Vol / OI", num: true, value: (a) => a.voi, render: (a) => a.voi?.toFixed(2) ?? "—" }, { key: "pr", label: "Premium (₹ L)", num: true, value: (a) => a.premium, render: (a) => fn(a.premium / 1e5, 1) },
          { key: "iv", label: "IV", num: true, value: (a) => a.iv, render: (a) => fiv(a.iv) },
          { key: "f", label: "Likely flow", value: (a) => a.attr.label, render: (a) => <span><Badge>{a.attr.label}</Badge> <span className="muted small">{Math.round(a.attr.confidence * 100)}%</span></span> },
          { key: "w", label: "Why flagged", value: (a) => a.tags.join("; ") },
        ]} />
      )}
      <p className="legend-note">Baseline = the same contract over the previous {Math.max(0, (dates.data?.length || 1) - 1 > 10 ? 10 : (dates.data?.length || 1) - 1)} stored sessions. Attribution is a likelihood with a confidence score, never a claim about who traded.</p>
    </div>
  );
}
