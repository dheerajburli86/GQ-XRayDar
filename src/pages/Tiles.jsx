// Multi-tile screen (owner, Nov 2026): 6-8 charts on one screen, made from a written command
//   "Show us the Semiconductor sector in US, top 8 market cap companies relative to the
//    semiconductor sector index, daily charts in MMA format"
// or by hand. One timeframe toggle for every tile (keys D W M Q H Y), absolute price or
// relative to a comparison series, MMA / ACC / plain. Click a tile's ⤢ to maximise it; with
// Shift, a second one opens beside it. Charts are the Analyst panes (engine/analyst.js).
import { rowBars } from "../lib/dataWindow.js";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useData } from "../data/store.jsx";
import { useAsync } from "../lib/useAsync.js";
import { navigate } from "../lib/router.js";
import { Seg, Check, Badge, Loading, Empty } from "../components/ui.jsx";
import { ChartSync } from "../components/TvChart.jsx";
import { InstrumentPicker, TfPicker } from "../components/pickers.jsx";
import { QuickTicker } from "../components/QuickTicker.jsx";
import { Pane, DEFAULT_VIEW } from "../components/AnalystPane.jsx";
import { loadInstrument, alignCurrency } from "../lib/series.js";
import { usePersistent } from "../lib/storage.js";
import { useChartKeys } from "../lib/chartKeys.js";
import { decodeRef, encodeRef } from "../lib/instruments.js";
import { PRICE_STYLES } from "../lib/chartStyle.js";
import { captureStack, savePng, savePdf } from "../lib/snapshot.js";
import { parseTilesCommand, selectTiles, pickBenchmark } from "../../engine/tiles.js";
import { rankedByTurnover } from "../../engine/turnover.js";
import { buildAnalystColumn, analystDate } from "../../engine/analyst.js";
import { tfLabel } from "../../engine/calendar.js";
import { fmtCapOf } from "../lib/format.js";
import { useIndSettings } from "../lib/indSettings.js";

const TFS = ["D", "W", "M", "Q", "H", "Y"];
const EXAMPLE = "Show us the Semiconductor sector in US, top 8 market cap companies relative to the semiconductor sector index, daily charts in MMA format";
const DEFAULT = { refs: [], tf: "D", format: "MMA", relative: false, bench: null, cols: 4, price: "line", log: true, rsi: false, title: "" };

export default function Tiles({ route }) {
  const d = useData();
  const [st, setSt] = usePersistent("tiles.current", DEFAULT);
  const s = { ...DEFAULT, ...(st || {}) };
  const set = (patch) => setSt({ ...s, ...patch });
  const [shortcuts, setShortcuts] = usePersistent("tiles.shortcuts", {});
  const [cmd, setCmd] = useState(route.query.q || "");
  const [note, setNote] = useState(null);
  const [max, setMax] = useState([]); // indexes of maximised tiles (0, 1 or 2)
  const [picking, setPicking] = useState(null); // {index|null, initial}
  const [sync] = useState(() => new ChartSync());

  // run a command (typed here, or arriving from the main search box as ?q=)
  const run = (text) => {
    const c = parseTilesCommand(text, { secs: d.secs });
    const picked = selectTiles(d.secs, c);
    if (!picked.length) { setNote({ kind: "warn", text: `Nothing matched (${c.understood.join(" · ")}). Try naming a country and an industry, e.g. "${EXAMPLE}".` }); return; }
    const bm = c.relative ? pickBenchmark(d.secs, d.indices, c) : null;
    setMax([]);
    setSt({ ...s, refs: picked.map((x) => `s:${x.id}`), tf: c.tf || s.tf, format: c.format, relative: c.relative, bench: bm ? encodeRef(bm.ref) : s.bench,
      title: `${c.group?.name || "Largest stocks"}${c.country ? ` · ${c.country}` : ""} · top ${picked.length} by ${rankedByTurnover(picked) ? "turnover (traded value, not market cap)" : "market cap"}` });
    setNote({ kind: "", text: `Read as: ${c.understood.join(" · ")}${bm ? ` · comparison: ${bm.ref.label} (${bm.why})` : ""}. ${picked.length < c.n ? `Only ${picked.length} found.` : ""}` });
  };
  useEffect(() => { if (route.query.q) run(route.query.q); }, [route.query.q]); // eslint-disable-line react-hooks/exhaustive-deps
  // opened from a chart screen with ?inst=: that instrument and its largest industry peers
  useEffect(() => {
    if (!route.query.inst) return;
    const r = decodeRef(route.query.inst, d);
    const sec = r?.kind === "sec" ? d.secById.get(r.id) : null;
    if (!sec) { set({ refs: [route.query.inst] }); return; }
    const peers = selectTiles(d.secs, { country: sec.country, group: { level: "industryGroup", name: sec.industryGroup }, n: 8 }).filter((x) => x.id !== sec.id).slice(0, 7);
    set({ refs: [`s:${sec.id}`, ...peers.map((x) => `s:${x.id}`)], title: `${sec.symbol} and its ${sec.industryGroup} peers · ${sec.country}`, format: route.query.mode?.includes("ACC") ? "ACC" : "MMA", relative: route.query.mode?.startsWith("RSC") || s.relative });
  }, [route.query.inst]); // eslint-disable-line react-hooks/exhaustive-deps

  const refs = useMemo(() => s.refs.map((k) => decodeRef(k, d)).filter(Boolean), [s.refs, d]);
  const benchRef = useMemo(() => (s.bench ? decodeRef(s.bench, d) : null), [s.bench, d]);
  const mode = s.relative ? (s.format === "ACC" ? "RSCACC" : "RSCMMA") : (s.format === "ACC" ? "RSIACC" : "RSIMMA");
  const view = useMemo(() => ({ ...DEFAULT_VIEW, log: s.log, price: s.price, short: s.format !== "PLAIN", long: s.format !== "PLAIN" }), [s.log, s.price, s.format]);

  useChartKeys({ onTf: (tf) => set({ tf }), onSearch: (ch) => setPicking({ index: null, initial: ch }) });

  // layout: every tile fits the window
  const gridRef = useRef(null);
  const [top, setTop] = useState(220);
  const [vh, setVh] = useState(window.innerHeight);
  useEffect(() => { const h = () => setVh(window.innerHeight); window.addEventListener("resize", h); return () => window.removeEventListener("resize", h); }, []);
  useLayoutEffect(() => { if (gridRef.current) setTop(gridRef.current.getBoundingClientRect().top + window.scrollY); }, [note, refs.length, max.length, s.relative]);
  const shown = max.length ? max.filter((i) => i < refs.length) : refs.map((_, i) => i);
  const cols = max.length ? max.length : Math.min(s.cols, Math.max(1, refs.length));
  const rowsN = Math.max(1, Math.ceil(shown.length / cols));
  const tileH = Math.max(150, Math.floor((vh - top - 16) / rowsN) - 6);

  // ⤢ maximises a tile; Shift + ⤢ marks it, so the next ⤢ opens the marked tile and that one
  // side by side. A maximised tile can also take a second one beside it from the list.
  const [marked, setMarked] = useState(null);
  const toggleMax = (i, e) => {
    if (max.includes(i)) { setMax(max.filter((x) => x !== i)); return; }
    if (e?.shiftKey) { setMarked(marked === i ? null : i); return; }
    if (marked != null && marked !== i) { setMax([marked, i]); setMarked(null); return; }
    setMax(max.length === 1 ? [max[0], i] : [i]);
  };
  const replace = (i, r) => { const k = encodeRef(r); set({ refs: i == null ? [...s.refs, k].slice(0, 12) : s.refs.map((x, j) => (j === i ? k : x)) }); };
  const remove = (i) => { set({ refs: s.refs.filter((_, j) => j !== i) }); setMax(max.filter((x) => x !== i).map((x) => (x > i ? x - 1 : x))); };

  const savePicture = async (kind) => {
    if (!gridRef.current) return;
    const title = `${s.title || "Multi-tile screen"} · ${tfLabel(s.tf)} · ${s.relative ? `relative to ${benchRef?.label || "comparison"}` : "absolute"} · ${s.format}`;
    const c = captureStack(gridRef.current, { title, subtitle: `GQ XRayDar · ${new Date().toISOString().slice(0, 10)}` });
    const name = `tiles_${(s.title || "screen").replace(/[^\w]+/g, "_").slice(0, 40)}_${s.tf}`;
    if (kind === "png") await savePng(c, `${name}.png`); else await savePdf(c, `${name}.pdf`, { footer: title });
  };

  return (
    <div className="stack" style={{ gap: 6 }}>
      {picking && <QuickTicker initial={picking.initial} title={picking.index == null ? "Add a tile" : "Change this tile"} onClose={() => setPicking(null)} onPick={(r) => replace(picking.index, r)} />}
      <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
        <input className="input" style={{ flex: 1, minWidth: 200 }} value={cmd} placeholder={`Type a command, e.g. "${EXAMPLE}"`} onChange={(e) => setCmd(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && cmd.trim()) run(cmd.trim()); }} />
        <button className="btn sm primary" disabled={!cmd.trim()} onClick={() => run(cmd.trim())}>Show</button>
        <select className="input sm" value="" title="Saved shortcuts" onChange={(e) => { const k = e.target.value; if (k && shortcuts[k]) { setSt({ ...DEFAULT, ...shortcuts[k] }); setMax([]); setNote(null); } }}>
          <option value="">Shortcuts…</option>
          {Object.keys(shortcuts).map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <button className="btn sm" disabled={!refs.length} title="Save this screen as a shortcut" onClick={() => { const n = prompt("Shortcut name", s.title || "My tiles"); if (n) setShortcuts({ ...shortcuts, [n.slice(0, 40)]: s }); }}>Save shortcut</button>
        {Object.keys(shortcuts).length > 0 && <button className="btn sm ghost" title="Delete a shortcut" onClick={() => { const n = prompt(`Delete which shortcut? (${Object.keys(shortcuts).join(", ")})`); if (n && shortcuts[n]) { const c = { ...shortcuts }; delete c[n]; setShortcuts(c); } }}>✕</button>}
      </div>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <div className="seg" title="Period of every tile (keys D W M Q H Y)">{TFS.map((t) => <button key={t} className={s.tf === t ? "on" : ""} onClick={() => set({ tf: t })}>{tfLabel(t)}</button>)}</div>
        <TfPicker value={s.tf} onChange={(tf) => set({ tf })} />
        <Seg value={s.relative ? "rel" : "abs"} options={[{ value: "abs", label: "Absolute price" }, { value: "rel", label: "Relative" }]} onChange={(x) => set({ relative: x === "rel" })} />
        {s.relative && <><span className="small muted">vs</span><InstrumentPicker value={benchRef ? { label: benchRef.label } : null} onChange={(r) => set({ bench: encodeRef(r) })} placeholder="Comparison index or stock…" width={200} category={false} /></>}
        <Seg value={s.format} options={[{ value: "MMA", label: "MMA" }, { value: "ACC", label: "ACC" }, { value: "PLAIN", label: "Plain" }]} onChange={(format) => set({ format })} />
        {!s.relative && <select className="input sm" value={s.price} onChange={(e) => set({ price: e.target.value })} title="Price as a line (green up / red down), bars or candles">{PRICE_STYLES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>}
        <Check checked={s.log} onChange={(x) => set({ log: x })}>Log</Check>
        <Check checked={s.rsi} onChange={(x) => set({ rsi: x })}>RSI pane</Check>
        {!max.length && <Seg value={s.cols} options={[2, 3, 4].map((c) => ({ value: c, label: `${c} col` }))} onChange={(c) => set({ cols: c })} />}
        <button className="btn sm" onClick={() => setPicking({ index: null, initial: "" })} disabled={refs.length >= 12}>+ Tile</button>
        {max.length > 0 && <button className="btn sm primary" onClick={() => setMax([])}>Back to all tiles</button>}
        {max.length === 1 && refs.length > 1 && <select className="input sm" value="" title="Open a second tile beside this one" onChange={(e) => e.target.value !== "" && setMax([max[0], +e.target.value])}>
          <option value="">Add beside…</option>
          {refs.map((r, j) => (j === max[0] ? null : <option key={j} value={j}>{j + 1}. {(r.kind === "sec" ? d.secById.get(r.id)?.symbol : r.label) || r.label}</option>))}
        </select>}
        {refs.length > 0 && <><button className="btn sm" onClick={() => savePicture("png")}>Download PNG</button><button className="btn sm" onClick={() => savePicture("pdf")}>Download PDF</button></>}
      </div>
      {note && <div className={`note small ${note.kind}`}>{note.text}</div>}
      {!refs.length ? <Empty>Type a command above (for example: “{EXAMPLE}”), pick a saved shortcut, or add tiles one by one.</Empty> : (
        <div ref={gridRef} className="anl tiles" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {shown.map((i) => (
            <Tile key={s.refs[i] + i} r={refs[i]} i={i} bench={s.relative ? benchRef : null} mode={mode} tf={s.tf} v={view} rsiPane={s.rsi} full={max.length > 0}
              height={tileH} sync={max.length ? null : sync} maximised={max.includes(i)} marked={marked === i}
              onMax={(e) => toggleMax(i, e)} onChange={() => setPicking({ index: i, initial: "" })} onRemove={() => remove(i)} />
          ))}
        </div>
      )}
      <div className="small muted">Keys: D W M Q H Y change every tile's period · C adds a tile. ⤢ maximises a tile with all its RSI panes; Shift + ⤢ marks a tile, then ⤢ on another opens the two side by side (or use “Add beside” when one is open). {s.relative ? "Relative = the instrument divided by the comparison series, in one currency." : ""}</div>
    </div>
  );
}

function Tile({ r, i, bench, mode, tf, v, rsiPane, full, height, sync, maximised, marked, onMax, onChange, onRemove }) {
  const [ind] = useIndSettings();
  const d = useData();
  const sec = r.kind === "sec" ? d.secById.get(r.id) : null;
  const { data, loading, error } = useAsync(async () => {
    const bars = await loadInstrument(d.api, r, d);
    if (!bars) return { bars: null };
    let b = null, aligned = null;
    if (bench) { b = await loadInstrument(d.api, bench, d); if (b) aligned = await alignCurrency(d.api, bars, b); }
    return { bars, b, aligned };
  }, [r.kind, r.id, r.key, bench?.kind, bench?.id, bench?.key]);
  const m0 = d.info.methodology.indicators;
  const col = useMemo(() => {
    if (!data?.bars) return null;
    return buildAnalystColumn({ mode, tf, bars: data.bars, benchLabel: bench?.label?.split(" · ")[0] || "", bench: data.b && data.aligned ? { time: data.b.time, close: data.aligned.b } : null, rscCloses: data.aligned?.a,
      rsiPeriod: ind.rsi, rsiMethod: m0.rsiMethod, rscBase: ind.rscBase, mmaShort: ind.mmaShort, mmaLong: ind.mmaLong, accPeriods: ind.acc });
  }, [data, mode, tf, bench?.label, m0, ind]);
  const relative = mode.startsWith("RSC");
  const mainIdx = relative ? 1 : 0;
  // a maximised tile shows its whole Analyst column; a small one its main pane (+ RSI if asked)
  const rowIdx = col ? (full ? col.rows.map((_, k) => k) : rsiPane ? [mainIdx, mainIdx + 1] : [mainIdx]) : [];
  const head = col?.header;
  const hH = 20;
  const avail = height - hH - 3 * rowIdx.length - 3 * Math.max(0, rowIdx.length - 1); // column gaps and pane borders
  const hs = rowIdx.length <= 1 ? [avail] : rowIdx.map((_, k) => Math.floor(k === 0 ? avail * (full ? 0.34 : 0.62) : (avail * (full ? 0.66 : 0.38)) / (rowIdx.length - 1)));
  const name = sec ? sec.symbol : (r.label || "").split(" · ")[0];
  return (
    <div className="anl-col tile" style={{ height }}>
      <div className={`anl-head ${marked ? "on" : ""}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", height: 20, minHeight: 20, flex: "0 0 20px" }} title={sec ? `${sec.symbol} · ${sec.name} · ${sec.country}${sec.capUsdNow ? ` · cap ${fmtCapOf(sec)}` : ""}` : r.label}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{i + 1}. {name}{head ? `  ${head.close.toFixed(2)}  [${head.chg == null ? "—" : `${head.chg >= 0 ? "+" : ""}${(head.chg * 100).toFixed(2)}%`}]  ${analystDate(head.date)}` : ""}{sec?.capUsdNow ? `  · ${fmtCapOf(sec)}` : ""}</span>
        <span className="tile-tools" data-html2canvas-ignore>
          {sec && <a title="Open in the Analyst screens" onClick={() => navigate(`screens/${mode}/${encodeURIComponent(`s:${sec.id}`)}`, bench ? { bench: bench.kind === "index" ? `idx:${bench.key}` : bench.kind === "x" ? `x:${bench.key}` : bench.id } : undefined)}>↗</a>}
          <a title="Change instrument" onClick={onChange}>✎</a>
          <a title={maximised ? "Back to all tiles" : marked ? "Marked: click ⤢ on another tile to open both" : "Maximise (Shift + click marks it to open with another)"} onClick={onMax}>{maximised ? "⤡" : "⤢"}</a>
          <a title="Remove" onClick={onRemove}>✕</a>
        </span>
      </div>
      {loading ? <div className="anl-empty" style={{ height: avail }}><Loading /></div> : error ? <div className="anl-empty" style={{ height: avail }}>{String(error.message)}</div>
        : !col ? <div className="anl-empty" style={{ height: avail }}>no price history</div>
        : rowIdx.map((k, j) => (
          <Pane key={k} row={col.rows[k]} ri={k} last={j === rowIdx.length - 1} mode={mode} overlay={mode.endsWith("ACC") ? "acc" : "mma"} v={v} tf={tf} from=""
            height={Math.max(60, hs[j])} sync={sync} rangeKey={`${tf}|${mode}|${r.id || r.key}`}
            dw={rowBars(col.rows.find((x) => x.kind === "price")) ? { name: sec?.symbol || r.label || r.key || "", tf, bars: rowBars(col.rows.find((x) => x.kind === "price")) } : null} />
        ))}
      {relative && col && !col.rows[1]?.time?.length && <Badge kind="r">no comparison series</Badge>}
    </div>
  );
}
