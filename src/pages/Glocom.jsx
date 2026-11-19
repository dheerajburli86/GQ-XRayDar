// GLOCOM / LOCOM: industry and sector bands from the heatmap's rule sheet, the
// rank of every group, and every move up or down (how many places, which band).
import { useMemo } from "react";
import { useData } from "../data/store.jsx";
import { useAsync } from "../lib/useAsync.js";
import { navigate } from "../lib/router.js";
import { PageHead, Select, Seg, Loading, Empty, Pct, StockLink } from "../components/ui.jsx";
import { DataTable } from "../components/DataTable.jsx";
import { glocomBand, groupMoves, groupTimeline, GLOCOM_RULES, NEUTRAL } from "../../engine/glocom.js";

const BACK = [{ value: "1", label: "vs 1 session" }, { value: "5", label: "vs 1 week" }, { value: "21", label: "vs 1 month" }, { value: "63", label: "vs 3 months" }];
import { GBadge, Jump, UP, DOWN, comName } from "../components/glocomUi.jsx";

const pct01 = (v) => (v == null ? "—" : Math.round(v * 100));

export default function Glocom({ route }) {
  const d = useData();
  const q = route.query;
  const { data: scopes } = useAsync(() => d.api.glocomScopes(), []);
  const markets = useMemo(() => [...new Set((scopes || []).map((k) => k.split("|")[0]))].sort((a, b) => (a === "G" ? -1 : b === "G" ? 1 : a.localeCompare(b))), [scopes]);
  const market = q.m || (markets.includes("C:India") ? "C:India" : markets[0] || "G");
  const level = q.lv || "industry";
  const back = +(q.back || 1);
  const sel = q.g || null;
  const set = (p) => navigate("glocom", { ...q, ...p });
  const { data: hist, loading } = useAsync(() => d.api.glocomGroups(`${market}|${level}`), [market, level]);

  const moves = useMemo(() => (hist ? groupMoves(hist, back) : []), [hist, back]);
  // owner: the groups that gained strength first, in rank order (the one now #1 first), then the
  // ones that lost it, again in rank order, so the weakest sits at the bottom
  const movers = useMemo(() => {
    const gained = (x) => (x.bandMove || 0) > 0 || (!x.bandMove && (x.jump || 0) > 0);
    return moves.filter((x) => x.jump || x.bandMove).sort((a, b) => (gained(b) - gained(a)) || a.rank - b.rank);
  }, [moves]);
  const nm = comName(market);
  const tooShort = hist && hist.dates.length - 1 - back < 0;
  const asOf = hist?.dates?.at(-1), prevDate = hist?.dates?.[hist.dates.length - 1 - back];
  const label = (k) => (k === "G" ? "Global (all markets, USD)" : k.slice(2));
  const noun = level === "industry" ? "Industry" : "Sector";
  const nouns = level === "industry" ? "industries" : "sectors";

  return (
    <div className="stack">
      <PageHead title={`${nm} · ${label(market)}`} sub={`Each ${noun.toLowerCase()} is rated against the other ${nouns} of the market on its average 1-week, 6-month and 1-year return percentiles (heatmap rule sheet). Rank 1 = best: band first, then score. GLOCOM and LOCOM are the same rule sheet: it is called LOCOM for Indian industries and sectors, GLOCOM everywhere else.`}>
        <Select label="Market" value={market} options={markets.map((k) => ({ value: k, label: label(k) }))} onChange={(v) => set({ m: v, g: undefined })} />
        <Seg value={level} options={[{ value: "industry", label: "Industries" }, { value: "sector", label: "Sectors" }]} onChange={(v) => set({ lv: v, g: undefined })} />
        <Seg value={String(back)} options={BACK} onChange={(v) => set({ back: v })} />
      </PageHead>
      {loading ? <Loading /> : !hist ? <Empty>No GLOCOM history yet for this market. It is written by the nightly engine run.</Empty> : (
        <>
          <div className="card">
            <h3>Moves {prevDate ? `${prevDate} → ${asOf}` : `to ${asOf}`} <span className="small muted">({movers.length} of {moves.length} {nouns} moved · gainers first in rank order, then losers, weakest last)</span></h3>
            {tooShort && <div className="note warn small">Not enough stored history for this comparison yet: the engine keeps {hist.dates.length} sessions; the 3-month view fills in after the next engine run.</div>}
            {!movers.length ? <div className="small muted">No {noun.toLowerCase()} changed rank or band.</div> : (
              <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
                {movers.map((x) => {
                  const up = (x.bandMove || 0) > 0 || (!x.bandMove && x.jump > 0);
                  return (
                    <button key={x.name} onClick={() => set({ g: x.name })} title="Show history and stocks"
                      style={{ textAlign: "left", border: `2px solid ${up ? UP : DOWN}`, background: up ? "rgba(22,163,74,.10)" : "rgba(220,38,38,.10)", borderRadius: 8, padding: "6px 10px", cursor: "pointer", color: "inherit" }}>
                      <div style={{ fontWeight: 700 }}>{x.name}</div>
                      <div className="small">#{x.prevRank} → #{x.rank} <Jump v={x.jump} unit={Math.abs(x.jump) === 1 ? " place" : " places"} /></div>
                      {x.bandMove ? <div className="small" style={{ marginTop: 2 }}><GBadge small code={x.prevCode} label={x.prevLabel} /> → <GBadge small code={x.code} label={x.label} /></div> : null}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="grid" style={{ gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)" }}>
            <DataTable exportName={`glocom_${market}_${level}`} rows={moves} rowKey={(x) => x.name} pageSize={50} initialSort={{ key: "rank", dir: "asc" }}
              onRowClick={(x) => set({ g: x.name })} selectedId={sel}
              columns={[
                { key: "rank", label: "Rank", num: true, value: (x) => x.rank },
                { key: "jump", label: "Move", num: true, value: (x) => x.jump, render: (x) => <Jump v={x.jump} /> },
                { key: "name", label: noun, value: (x) => x.name, render: (x) => <span style={{ borderLeft: `4px solid ${x.jump > 0 || x.bandMove > 0 ? UP : x.jump < 0 || x.bandMove < 0 ? DOWN : "transparent"}`, paddingLeft: 6, fontWeight: x.jump || x.bandMove ? 700 : 400 }}>{x.name}</span> },
                { key: "label", label: nm, value: (x) => x.code, render: (x) => <GBadge code={x.code} label={x.label} /> },
                { key: "prev", label: "Before", value: (x) => x.prevCode, render: (x) => (x.bandMove ? <GBadge small code={x.prevCode} label={x.prevLabel} /> : <span className="muted">same</span>) },
                { key: "w", label: "1W avg", num: true, value: (x) => x.w, render: (x) => <Pct v={x.w == null ? null : x.w * 100} /> },
                { key: "m6", label: "6M", num: true, value: (x) => x.m6, render: (x) => <Pct v={x.m6 == null ? null : x.m6 * 100} /> },
                { key: "y", label: "1Y", num: true, value: (x) => x.y, render: (x) => <Pct v={x.y == null ? null : x.y * 100} /> },
                { key: "pc", label: "%ile W/6M/1Y", value: (x) => x.score, render: (x) => <span className="mono small">{pct01(x.pW)} / {pct01(x.p6m)} / {pct01(x.p1y)}</span> },
                { key: "n", label: "Stocks", num: true, value: (x) => x.n },
              ]} />
            <div className="stack">
              {sel ? <GroupDetail hist={hist} name={sel} market={market} level={level} rows={d.rows} onClose={() => set({ g: undefined })} /> : <Sheet />}
            </div>
          </div>

          <div className="card"><h3>Band and rank over the last {hist.dates.length} sessions <span className="small muted">(hover a cell for the rank)</span></h3>
            {moves.map((x) => {
              const g = hist.groups[x.name];
              return (
                <div key={x.name} className="row small" style={{ gap: 1, marginBottom: 3, cursor: "pointer" }} onClick={() => set({ g: x.name })}>
                  <span style={{ width: 210, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: x.name === sel ? 700 : 400 }}>#{x.rank} {x.name}</span>
                  {hist.dates.map((dt, t) => <span key={dt} title={`${dt}: #${g.rank[t] ?? "—"} ${g.label[t] ?? ""}`}
                    style={{ width: 8, height: 13, display: "inline-block", borderRadius: 2, background: g.code[t] ? glocomBand(g.code[t]).bg : "transparent", outline: t > 0 && g.rank[t] != null && g.rank[t - 1] != null && g.rank[t] !== g.rank[t - 1] ? `1px solid ${g.rank[t] < g.rank[t - 1] ? UP : DOWN}` : "none" }} />)}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function GroupDetail({ hist, name, market, level, rows, onClose }) {
  const tl = useMemo(() => groupTimeline(hist, name), [hist, name]);
  const stocks = useMemo(() => rows.filter((r) => (r.sec.assetClass || "Stock") === "Stock" && (market === "G" || r.sec.country === market.slice(2)) && (level === "industry" ? r.sec.industryGroup : r.sec.sector) === name), [rows, market, level, name]);
  return (
    <>
      <div className="card">
        <div className="row between"><h3>{name}</h3><button className="btn sm" onClick={onClose}>Close</button></div>
        <div className="small muted" style={{ marginBottom: 6 }}>Every change of rank or band, newest first.</div>
        {!tl.length ? <div className="small muted">No change in the stored window.</div> : (
          <div style={{ maxHeight: 240, overflow: "auto" }}>
            {tl.map((e) => (
              <div key={e.date} className="row between small" style={{ padding: "2px 0", borderBottom: "1px solid var(--line)" }}>
                <span className="mono">{e.date}</span>
                <span>#{e.prevRank} → #{e.rank} <Jump v={e.jump} /></span>
                <span>{e.bandMove ? <><GBadge small code={e.prevCode} label={e.prevLabel} /> → <GBadge small code={e.code} label={e.label} /></> : <GBadge small code={e.code} label={e.label} />}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="card"><h3>Stocks ({stocks.length})</h3>
        <DataTable exportName={`glocom_${name}`} rows={stocks} pageSize={15} compact maxHeight={360} onRowClick={(r) => navigate(`stock/${r.id}`)} initialSort={{ key: "g", dir: "asc" }}
          columns={[
            { key: "s", label: "Stock", value: (r) => r.sec.symbol, render: (r) => <StockLink sec={r.sec} /> },
            { key: "g", label: "GLOCOM", value: (r) => r.flat.glocomCode, render: (r) => <GBadge small code={r.flat.glocomCode} label={r.flat.glocom} /> },
            { key: "l", label: "Within industry", value: (r) => r.flat.locomCode, render: (r) => <GBadge small code={r.flat.locomCode} label={r.flat.locom} /> },
            { key: "w", label: "1W", num: true, value: (r) => r.flat.ret1W, render: (r) => <Pct v={r.flat.ret1W} /> },
          ]} />
      </div>
    </>
  );
}

function Sheet() {
  const rows = [...GLOCOM_RULES.map((r) => ({ label: r.label, code: r.code })), NEUTRAL];
  const text = { "US 80 80": "W > 0.8 · 6M > 0.4 · 1Y > 0.8", "LTS 80": "W ≤ 0.8 · 6M > 0.4 · 1Y > 0.8", "US 60 60": "W > 0.6 · 6M > 0.4 · 0.6 < 1Y ≤ 0.8", "LTS 60": "W ≤ 0.6 · 6M > 0.4 · 0.6 < 1Y ≤ 0.8",
    "UW 30 30": "W < 0.3 · 6M < 0.3", "LTW 30": "W ≤ 0.3 · 6M ≥ 0.3", "UW 40 40": "W < 0.4 · 6M < 0.4", "LTW 40": "W ≤ 0.4 · 6M ≥ 0.4", "Neutral 40 60": "everything else" };
  return (
    <div className="card"><h3>Rule sheet (percentiles, first match wins)</h3>
      {rows.map((r) => <div key={r.label} className="row between small" style={{ padding: "3px 0" }}><GBadge code={r.code} label={r.label} /><span className="mono">{text[r.label]}</span></div>)}
      <div className="small muted" style={{ marginTop: 8 }}>Click a row or a mover to see its history and its stocks.</div>
    </div>
  );
}
