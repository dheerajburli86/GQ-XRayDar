// Derivatives market dashboard: index positioning, F&O rankings, sector OI,
// ban list and MWPL, participant-wise OI, and the data sources.
import { useMemo, useState } from "react";
import { PageHead, Badge, Kpi, Tabs, Seg } from "../../components/ui.jsx";
import { DataTable } from "../../components/DataTable.jsx";
import { TvChart, lineData } from "../../components/TvChart.jsx";
import { href } from "../../lib/router.js";
import { useDerivRows, DerivGate, DataNote, FP, fp, fn, fiv, BUILD_BADGE, pc } from "./common.jsx";
import { BUILDUP } from "../../../engine/deriv/positioning.js";
import { DERIV_SOURCES } from "../../../engine/deriv/sources.js";

const undLink = (r, page = "dchain") => <a href={href(page, { und: r.und })}>{r.und}</a>;

export default function DerivHome() {
  const { status, rows, market, loading, error } = useDerivRows();
  const [tab, setTab] = useState("rank");
  return (
    <div className="stack">
      <PageHead title="Derivatives dashboard" sub="Index and stock futures & options: positioning, open interest, volatility and the exchange's market-wide data." />
      <DerivGate status={status} loading={loading} error={error}>
        <DataNote status={status} />
        <IndexCards rows={rows} />
        <Tabs value={tab} onChange={setTab} tabs={[{ value: "rank", label: "Build-up rankings" }, { value: "sector", label: "Sector OI" }, { value: "ban", label: "Ban list & MWPL" }, { value: "part", label: "Participant OI" }, { value: "src", label: "Data sources" }]} />
        {tab === "rank" && <Rankings rows={rows} />}
        {tab === "sector" && <SectorOi rows={rows} />}
        {tab === "ban" && <BanMwpl market={market} />}
        {tab === "part" && <Participants market={market} />}
        {tab === "src" && <Sources status={status} />}
      </DerivGate>
    </div>
  );
}

function IndexCards({ rows }) {
  const idx = (rows || []).filter((r) => r.kind === "index");
  if (!idx.length) return null;
  return (
    <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))" }}>
      {idx.map((r) => (
        <div key={r.und} className="card">
          <div className="row between"><b>{undLink(r)}</b><Badge kind={BUILD_BADGE[r.s.buildup]} title={BUILDUP[r.s.buildup]?.read}>{BUILDUP[r.s.buildup]?.label}</Badge></div>
          <div className="row" style={{ gap: 14, marginTop: 6 }}>
            <Kpi label="Spot" value={fn(r.s.spot)} sub={<FP v={r.s.spotChg} d={2} />} />
            <Kpi label="PCR (OI)" value={r.s.pcrOi?.toFixed(2) ?? "—"} sub={`near ${r.s.pcrNear?.toFixed(2) ?? "—"}`} />
            <Kpi label="ATM IV" value={fiv(r.s.atmIv)} sub={`IV rank ${r.s.ivRank != null ? Math.round(r.s.ivRank * 100) : "—"}`} />
          </div>
          <div className="small muted" style={{ marginTop: 6 }}>Max pain {r.s.maxPain ?? "—"} · call wall {r.s.callWall ?? "—"} · put wall {r.s.putWall ?? "—"} · expected move {fp(r.s.expMovePct)} to {r.s.nearExpiry}</div>
        </div>
      ))}
    </div>
  );
}

function Rankings({ rows }) {
  const [k, setK] = useState("long_buildup");
  const list = useMemo(() => (rows || []).filter((r) => r.s.buildup === k).sort((a, b) => Math.abs(b.s.futOiChgPct || 0) - Math.abs(a.s.futOiChgPct || 0)), [rows, k]);
  const counts = useMemo(() => Object.fromEntries(Object.keys(BUILDUP).map((x) => [x, (rows || []).filter((r) => r.s.buildup === x).length])), [rows]);
  return (
    <div className="card">
      <Seg value={k} onChange={setK} options={Object.entries(BUILDUP).map(([key, v]) => ({ value: key, label: `${v.label} (${counts[key] || 0})`, title: v.read }))} />
      <p className="small muted">{BUILDUP[k].read} Each label is an interpretation of price and open interest, with a confidence score; open interest does not show who opened a position.</p>
      <DataTable rows={list} exportName={`fo-${k}`} pageSize={30} columns={[
        { key: "und", label: "Underlying", value: (r) => r.und, render: (r) => undLink(r) },
        { key: "sec", label: "Sector", value: (r) => r.sec?.sector || (r.kind === "index" ? "Index" : "—") },
        { key: "chg", label: "Price 1D", num: true, value: (r) => r.s.fut?.pxChg ?? r.s.spotChg, render: (r) => <FP v={r.s.fut?.pxChg ?? r.s.spotChg} d={2} /> },
        { key: "oi", label: "Fut OI chg", num: true, value: (r) => r.s.futOiChgPct, render: (r) => <FP v={r.s.futOiChgPct} /> },
        { key: "conf", label: "Confidence", num: true, value: (r) => r.s.buildupConf, render: (r) => (r.s.buildupConf != null ? `${Math.round(r.s.buildupConf * 100)}%` : "—") },
        { key: "vr", label: "Fut vol / 20d", num: true, value: (r) => r.s.futVolRatio, render: (r) => r.s.futVolRatio?.toFixed(2) ?? "—" },
        { key: "pcr", label: "PCR", num: true, value: (r) => r.s.pcrOi, render: (r) => r.s.pcrOi?.toFixed(2) ?? "—" },
        { key: "iv", label: "ATM IV", num: true, value: (r) => r.s.atmIv, render: (r) => fiv(r.s.atmIv) },
        { key: "cf", label: "Confluence", num: true, value: (r) => r.conf?.score, render: (r) => (r.conf?.score != null ? r.conf.score : "—") },
      ]} />
    </div>
  );
}

function SectorOi({ rows }) {
  const data = useMemo(() => {
    const g = new Map();
    for (const r of rows || []) {
      if (r.kind === "index") continue;
      const k = r.sec?.sector || "Unmapped";
      const x = g.get(k) || { id: k, sector: k, n: 0, oi: 0, chg: 0, long: 0, short: 0, cover: 0, unwind: 0 };
      x.n++; x.oi += r.s.futOi || 0; x.chg += r.s.futOiChg || 0;
      if (r.s.buildup === "long_buildup") x.long++; if (r.s.buildup === "short_buildup") x.short++; if (r.s.buildup === "short_covering") x.cover++; if (r.s.buildup === "long_unwinding") x.unwind++;
      g.set(k, x);
    }
    return [...g.values()].map((x) => ({ ...x, chgPct: x.oi - x.chg > 0 ? x.chg / (x.oi - x.chg) : null, tilt: x.n ? (x.long + x.cover - x.short - x.unwind) / x.n : 0 }));
  }, [rows]);
  return (
    <div className="card">
      <p className="small muted">Stock futures aggregated by sector. Tilt = (long build-up + short covering − short build-up − long unwinding) ÷ stocks.</p>
      <DataTable rows={data} exportName="fo-sector-oi" initialSort={{ key: "chgPct", dir: "desc" }} columns={[
        { key: "sector", label: "Sector", value: (r) => r.sector }, { key: "n", label: "F&O stocks", num: true, value: (r) => r.n },
        { key: "chgPct", label: "Futures OI change", num: true, value: (r) => r.chgPct, render: (r) => <FP v={r.chgPct} /> },
        { key: "tilt", label: "Positioning tilt", num: true, value: (r) => r.tilt, render: (r) => <FP v={r.tilt} d={0} /> },
        { key: "long", label: "Long build-up", num: true, value: (r) => r.long }, { key: "short", label: "Short build-up", num: true, value: (r) => r.short },
        { key: "cover", label: "Short covering", num: true, value: (r) => r.cover }, { key: "unwind", label: "Long unwinding", num: true, value: (r) => r.unwind },
      ]} />
    </div>
  );
}

function BanMwpl({ market }) {
  const m = market?.at(-1);
  const mw = (m?.mwpl || []).filter((x) => x.pct != null).sort((a, b) => b.pct - a.pct);
  return (
    <div className="grid g2">
      <div className="card">
        <div className="h3">In the F&O ban ({m?.date || "—"})</div>
        <p className="small muted">Exchange-published. A stock enters the ban when combined open interest crosses 95% of its market-wide position limit; only position-reducing trades are allowed until it falls below 80%.</p>
        {m?.ban?.length ? m.ban.map((s) => <Badge key={s} kind="r">{s}</Badge>) : <span className="muted">None</span>}
      </div>
      <div className="card">
        <div className="h3">MWPL used (early warning at 80%)</div>
        <DataTable compact rows={mw.map((x) => ({ ...x, id: x.symbol }))} exportName="mwpl" pageSize={20} columns={[
          { key: "s", label: "Stock", value: (r) => r.symbol, render: (r) => <a href={href("dchain", { und: r.symbol })}>{r.symbol}</a> },
          { key: "p", label: "MWPL used", num: true, value: (r) => r.pct, render: (r) => <span className={r.pct >= 0.95 ? "neg" : ""}>{pc(r.pct, 1)}</span> },
          { key: "f", label: "Flag", value: (r) => (r.pct >= 0.95 ? "Ban trigger" : r.pct >= 0.8 ? "Near ban" : ""), render: (r) => (r.pct >= 0.95 ? <Badge kind="r">ban trigger</Badge> : r.pct >= 0.8 ? <Badge kind="a">near ban</Badge> : null) },
          { key: "oi", label: "Combined OI", num: true, value: (r) => r.oi, render: (r) => fn(r.oi, 0) }, { key: "m", label: "MWPL", num: true, value: (r) => r.mwpl, render: (r) => fn(r.mwpl, 0) },
        ]} />
      </div>
    </div>
  );
}

const PCOLS = ["Future Index Long", "Future Index Short", "Option Index Call Long", "Option Index Call Short", "Option Index Put Long", "Option Index Put Short", "Future Stock Long", "Future Stock Short"];
function Participants({ market }) {
  const [who, setWho] = useState("FII");
  const days = (market || []).filter((m) => m.participants?.length);
  const series = useMemo(() => days.map((m) => {
    const r = m.participants.find((x) => String(x.type).toUpperCase() === who.toUpperCase()) || {};
    const fl = r["Future Index Long"] || 0, fs = r["Future Index Short"] || 0;
    return { date: m.date, netFut: fl - fs, ratio: fs > 0 ? fl / fs : null, row: r };
  }), [days, who]);
  if (!days.length) return <div className="empty">No participant-wise OI files stored yet.</div>;
  const last = series.at(-1), prev = series.at(-2);
  const sorted = series.map((x) => x.netFut).sort((a, b) => a - b);
  const pctile = sorted.length ? sorted.filter((x) => x < last.netFut).length / sorted.length : null;
  const types = days.at(-1).participants.map((x) => x.type).filter((t) => !/total/i.test(t));
  return (
    <div className="stack">
      <div className="card">
        <div className="row between"><Seg value={who} onChange={setWho} options={types} /><span className="small muted">Exchange-published end-of-day report (a fact, not an inferred flow)</span></div>
        <div className="kpis" style={{ marginTop: 8 }}>
          <Kpi label="Net index futures (long − short)" value={fn(last.netFut, 0)} sub={prev ? `change ${fn(last.netFut - prev.netFut, 0)}` : ""} />
          <Kpi label="Long / short ratio" value={last.ratio?.toFixed(2) ?? "—"} />
          <Kpi label="Percentile in stored history" value={pctile != null ? `${Math.round(pctile * 100)}` : "—"} sub={`${series.length} sessions`} />
        </div>
        <TvChart height={240} series={[{ id: "n", type: "histogram", data: lineData(series.map((x) => x.date), series.map((x) => x.netFut)).map((p) => ({ ...p, color: p.value >= 0 ? "#16a34a" : "#dc2626" })) }]} />
      </div>
      <div className="card">
        <div className="h3">All participants, {days.at(-1).date} (contracts)</div>
        <DataTable compact rows={days.at(-1).participants.map((x) => ({ ...x, id: x.type }))} exportName="participant-oi" columns={[{ key: "type", label: "Participant", value: (r) => r.type }, ...PCOLS.map((c) => ({ key: c, label: c.replace("Option ", "Opt ").replace("Future ", "Fut "), num: true, value: (r) => r[c], render: (r) => fn(r[c], 0) }))]} />
      </div>
    </div>
  );
}

function Sources({ status }) {
  const recent = (status?.days || []).slice(-15).reverse();
  return (
    <div className="grid g2">
      <div className="card">
        <div className="h3">Data sources</div>
        {DERIV_SOURCES.map((s) => (
          <div key={s.key} style={{ marginBottom: 10 }}>
            <div className="row"><b>{s.name}</b><Badge kind={s.status === "connected" ? "g" : ""}>{s.status}</Badge></div>
            {s.covers && <div className="small">{s.covers.join(" · ")}</div>}
            {s.needs && <div className="small muted">Needs: {s.needs}</div>}
            {s.unlocks && <div className="small muted">Would add: {s.unlocks.join(" · ")}</div>}
          </div>
        ))}
      </div>
      <div className="card">
        <div className="h3">Recent collection runs</div>
        <DataTable compact rows={recent.map((d) => ({ ...d, id: d.date }))} exportName="fo-collection" columns={[
          { key: "d", label: "Session", value: (r) => r.date }, { key: "s", label: "Status", value: (r) => r.status, render: (r) => <Badge kind={r.status === "ok" ? "g" : r.status === "error" ? "r" : ""}>{r.status}</Badge> },
          { key: "u", label: "Underlyings", num: true, value: (r) => r.underlyings }, { key: "un", label: "OI units", value: (r) => r.units || "—" },
          { key: "f", label: "Files", value: (r) => (r.files ? Object.entries(r.files).map(([k, v]) => `${k}: ${typeof v === "string" ? v : "ok"}`).join("; ") : "") },
        ]} />
      </div>
    </div>
  );
}
