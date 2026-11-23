// The chart lab's tool panels (owner's additional feature list): indicators, own formulas,
// drawings (with alerts), conditional projections, bar replay with practice orders,
// seasonality and market profile. They only edit settings; every number comes from engine/.
import { useMemo, useState } from "react";
import { Check, Badge, Seg } from "./ui.jsx";
import { STUDIES, MA_KINDS, SOURCE_STUDIES, SOURCES } from "../../engine/studies.js";
import { DRAW_TOOLS, alertLevels } from "../../engine/drawings.js";
import { FORMULA_HELP, parseFormula, isCondition, importFormulas, exportFormulas } from "../../engine/formula.js";
import { confluenceAcross } from "../../engine/confluence.js";
import { METHODS, parseProjectionText } from "../../engine/projection.js";
import { paperStats } from "../../engine/paperStats.js";
import { seasonality } from "../../engine/seasonality.js";
import { tpoProfiles } from "../../engine/chartTools.js";
import { exportCsv } from "../lib/exporters.js";
import { usePersistent, uid } from "../lib/storage.js";
import { indexAt } from "../lib/chartOverlays.js";

const pct = (v, d = 2) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(d)}%`);

/** Indicator library: show / hide, parameters, colour. */
export function StudiesPanel({ studies = {}, onChange }) {
  const set = (k, patch) => onChange({ ...studies, [k]: { ...(studies[k] || {}), ...patch } });
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="small muted">Calculated on the candles of the chart's timeframe (a weekly ADX uses weekly candles). Price-pane studies sit on the chart; the others get their own pane.</div>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 6 }}>
        {STUDIES.filter((s) => s.key !== "avwap").map((s) => {
          const st = studies[s.key] || {};
          const params = { ...s.params, ...(st.params || {}) };
          return (
            <div key={s.key} className="row" style={{ gap: 6, flexWrap: "wrap", border: "1px solid var(--line)", borderRadius: 6, padding: "4px 6px" }}>
              <Check checked={!!st.on} onChange={(on) => set(s.key, { on })}>{s.label}</Check>
              {Object.entries(params).map(([k, val]) => k === "kind"
                ? <select key={k} className="input sm" value={val} onChange={(e) => set(s.key, { params: { ...params, kind: e.target.value } })}>{(s.key === "pivots" ? ["standard", "fibonacci", "camarilla", "woodie", "demark"] : MA_KINDS).map((x) => <option key={x}>{x}</option>)}</select>
                : k === "session"
                  ? <label key={k} className="small muted">session <select className="input sm" value={val} onChange={(e) => set(s.key, { params: { ...params, session: e.target.value } })}>{[["Auto", "auto"], ["D", "day"], ["W", "week"], ["M", "month"], ["Q", "quarter"], ["Y", "year"]].map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
                  : k === "centered"
                    ? <Check key={k} checked={!!+val} onChange={(on) => set(s.key, { params: { ...params, centered: on ? 1 : 0 } })}>centred</Check>
                    : <label key={k} className="small muted">{k} <input className="input sm" style={{ width: 52 }} value={val ?? ""} onChange={(e) => set(s.key, { params: { ...params, [k]: e.target.value } })} /></label>)}
              {SOURCE_STUDIES.has(s.key) && <label className="small muted">source <select className="input sm" value={params.source || "close"} onChange={(e) => set(s.key, { params: { ...params, source: e.target.value } })}>{SOURCES.map((x) => <option key={x}>{x}</option>)}</select></label>}
              {s.key !== "pivots" && <label className="small muted" title="Line width">width <select className="input sm" value={st.width || ""} onChange={(e) => set(s.key, { width: e.target.value })}><option value="">auto</option>{[1, 2, 3, 4].map((x) => <option key={x}>{x}</option>)}</select></label>}
              {!["psar", "supertrend", "pivots"].includes(s.key) && <input type="color" value={st.color || "#38bdf8"} onChange={(e) => set(s.key, { color: e.target.value })} title="Colour of the main line" />}
              {["psar", "supertrend"].includes(s.key) && <>
                <label className="small muted">up <input type="color" value={st.upColor || "#16a34a"} onChange={(e) => set(s.key, { upColor: e.target.value })} /></label>
                <label className="small muted">down <input type="color" value={st.downColor || "#dc2626"} onChange={(e) => set(s.key, { downColor: e.target.value })} /></label></>}
              {(st.color || st.width || st.params || st.upColor || st.downColor) && <button className="btn sm" title="Back to the starting values" onClick={() => set(s.key, { color: undefined, width: undefined, params: undefined, upColor: undefined, downColor: undefined })}>↺</button>}
            </div>
          );
        })}
      </div>
      <div className="small muted">Anchored VWAP and anchored volume profile are drawing tools: pick them under Draw and click the candle to anchor on.</div>
    </div>
  );
}

/** Own indicators written as formulas; saved for every chart. */
export function FormulaPanel({ list, setList, onScan }) {
  const [draft, setDraft] = useState({ name: "", formula: "", pane: "own", color: "#22d3ee" });
  const [imp, setImp] = useState(null);
  let err = null;
  try { if (draft.formula.trim()) parseFormula(draft.formula); } catch (e) { err = e.message; }
  const add = () => { if (err || !draft.formula.trim()) return; setList([...list, { id: uid(), on: true, name: draft.name || draft.formula.slice(0, 24), formula: draft.formula, pane: draft.pane, color: draft.color }]); setDraft({ ...draft, name: "", formula: "" }); };
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        <input className="input sm" style={{ width: 140 }} placeholder="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <input className="input sm" style={{ flex: 1, minWidth: 260, fontFamily: "monospace" }} placeholder="e.g. ema(close, 10) - ema(close, 30)   or   rsi(close, 14) > 60 and close > ema(close, 50)" value={draft.formula} onChange={(e) => setDraft({ ...draft, formula: e.target.value })} onKeyDown={(e) => e.key === "Enter" && add()} />
        <Seg value={draft.pane} options={[{ value: "own", label: "Own pane" }, { value: "price", label: "On price" }]} onChange={(pane) => setDraft({ ...draft, pane })} />
        <input type="color" value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} />
        <button className="btn sm primary" disabled={!!err || !draft.formula.trim()} onClick={add}>Add</button>
      </div>
      {err && <div className="note warn small">{err}</div>}
      <div className="row small" style={{ gap: 6 }}>
        <label className="btn sm" title="Import formulas from a .txt or .json file: one 'name = formula' per line, or a JSON list. Only this formula language is read; Pine, AFL or JavaScript is not run.">
          Import file…<input type="file" accept=".txt,.json,.csv,.formula" style={{ display: "none" }} onChange={async (e) => {
            const f = e.target.files?.[0]; e.target.value = "";
            if (!f) return;
            const r = importFormulas(await f.text());
            const have = new Set(list.map((x) => `${x.name}|${x.formula}`));
            const fresh = r.items.filter((x) => !have.has(`${x.name}|${x.formula}`));
            if (fresh.length) setList([...list, ...fresh.map((x) => ({ id: uid(), on: true, ...x }))]);
            setImp({ added: fresh.length, dup: r.items.length - fresh.length, errors: r.errors, file: f.name });
          }} /></label>
        {list.length > 0 && <button className="btn sm" onClick={() => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([exportFormulas(list)], { type: "application/json" })); a.download = "my_formulas.json"; a.click(); }}>Export my formulas</button>}
        {imp && <span className={imp.errors.length ? "warn" : "muted"}>{imp.file}: {imp.added} added{imp.dup ? `, ${imp.dup} already there` : ""}{imp.errors.length ? `, ${imp.errors.length} not read` : ""}</span>}
      </div>
      {imp?.errors?.length > 0 && <div className="note warn small">{imp.errors.slice(0, 6).map((m, i) => <div key={i}>{m}</div>)}{imp.errors.length > 6 && <div>…and {imp.errors.length - 6} more</div>}</div>}
      {list.map((f) => (
        <div key={f.id} className="row small" style={{ gap: 6 }}>
          <Check checked={f.on} onChange={(on) => setList(list.map((x) => (x.id === f.id ? { ...x, on } : x)))} color={f.color}><b>{f.name}</b></Check>
          <span className="mono muted">{f.formula}</span>
          <Badge>{isCondition(f.formula) ? "condition: arrows where it starts" : f.pane === "price" ? "line on price" : "own pane"}</Badge>
          {isCondition(f.formula) && onScan && <button className="btn sm" onClick={() => onScan(f)}>Scan a watchlist</button>}
          <button className="btn sm ghost" onClick={() => setList(list.filter((x) => x.id !== f.id))}>✕</button>
        </div>
      ))}
      <details className="small"><summary>What a formula can use</summary>
        <div className="muted">Series: {FORMULA_HELP.series.join(", ")}, rsc (relative strength vs the "Compare with" series). Operators: + - * / &gt; &lt; &gt;= &lt;= == != and or not, a ? b : c.</div>
        <ul className="muted">{FORMULA_HELP.functions.map((x) => <li key={x} className="mono">{x}</li>)}</ul>
      </details>
    </div>
  );
}

/** Drawings on this instrument: hide, delete, set an alert. */
export function DrawingsPanel({ drawings, setDrawings, bars, sec, onAlert, notes = [] }) {
  const label = (t) => DRAW_TOOLS.find((x) => x.value === t)?.label || t;
  return (
    <div className="stack" style={{ gap: 4 }}>
      {!drawings.length && <div className="small muted">Nothing drawn on {sec.symbol} yet. Pick a tool under Draw and click on the chart. Drawings are saved for this instrument and come back next time.</div>}
      {drawings.map((dw) => {
        const lv = dw.type === "trend" || dw.type === "channel" ? "line" : alertLevels({ ...dw, a: dw.a && { i: indexAt(bars.time, dw.a.time), price: dw.a.price }, b: dw.b && { i: indexAt(bars.time, dw.b.time), price: dw.b.price }, c: dw.c && { i: indexAt(bars.time, dw.c.time), price: dw.c.price } }, bars.time.length - 1);
        return (
          <div key={dw.id} className="row small" style={{ gap: 6 }}>
            <Check checked={!dw.hidden} onChange={(on) => setDrawings(drawings.map((x) => (x.id === dw.id ? { ...x, hidden: !on } : x)))}><b>{label(dw.type)}</b></Check>
            <span className="muted mono">{[dw.a, dw.b, dw.c].filter(Boolean).map((p) => `${p.time} ${(+p.price).toFixed(2)}`).join(" → ")}{dw.text ? ` "${dw.text}"` : ""}</span>
            {(lv === "line" || lv.length > 0) && <button className="btn sm" title="Alert when the close crosses this drawing" onClick={() => onAlert(dw, lv)}>Alert</button>}
            <button className="btn sm ghost" onClick={() => setDrawings(drawings.filter((x) => x.id !== dw.id))}>✕</button>
          </div>
        );
      })}
      {notes.map((n, i) => <div key={i} className="small muted">{n}</div>)}
    </div>
  );
}

/** Conditional projections for this instrument. */
export function ProjectionPanel({ list, setList, results, bars, tf, onAlert }) {
  const blank = { name: "", side: "up", condition: "", targetKind: "price", targetValue: "", method: "atr", methodValue: "", horizon: 20, invalidate: "", onInvalid: "mark" };
  const [f, setF] = useState(blank);
  const [text, setText] = useState("");
  const [msg, setMsg] = useState(null);
  let err = null;
  try { if (f.condition.trim()) parseFormula(f.condition); } catch (e) { err = e.message; }
  const add = (spec) => { setList([...list, { id: uid(), since: bars.time.at(-1), ...spec }]); };
  const fromForm = () => add({ name: f.name || (f.targetValue ? `${f.side} to ${f.targetValue}` : `${f.side} (${f.method})`), side: f.side, condition: f.condition,
    target: f.targetValue !== "" ? { kind: f.targetKind, value: +f.targetValue } : null, method: f.method, methodValue: f.methodValue, horizon: +f.horizon || 20, invalidate: f.invalidate, onInvalid: f.onInvalid });
  const fromText = () => { const r = parseProjectionText(text); setMsg(`Read as: ${r.understood.join(" · ")}${r.tf && r.tf !== tf ? ` — note: the chart is on ${tf}; switch the timeframe to ${r.tf} to run it there` : ""}`); add({ name: text.slice(0, 40), ...r.spec }); setText(""); };
  const res = new Map((results || []).map((r) => [r.id, r]));
  const csv = (p) => { const r = res.get(p.id); if (r?.path) exportCsv(`projection_${(p.name || "path").replace(/\W+/g, "_")}`, [{ label: "date", value: (x) => x.time }, { label: "projected", value: (x) => +x.value.toFixed(4) }, { label: "future", value: (x) => (x.future ? "yes" : "no") }], r.path); };
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row" style={{ gap: 6 }}>
        <input className="input sm" style={{ flex: 1 }} value={text} placeholder='Write it: "Project price to 2450 if RSC turns up and price breaks 2380" · "down 8% if close falls below 410, invalid above 432, 30 candles"' onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && text.trim() && fromText()} />
        <button className="btn sm primary" disabled={!text.trim()} onClick={fromText}>Add from sentence</button>
      </div>
      {msg && <div className="small muted">{msg}</div>}
      <div className="row small" style={{ gap: 6, flexWrap: "wrap" }}>
        <input className="input sm" style={{ width: 110 }} placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Seg value={f.side} options={[{ value: "up", label: "Up" }, { value: "down", label: "Down" }]} onChange={(side) => setF({ ...f, side })} />
        <input className="input sm mono" style={{ width: 260 }} placeholder="Condition (formula), empty = from now" value={f.condition} onChange={(e) => setF({ ...f, condition: e.target.value })} />
        <select className="input sm" value={f.targetKind} onChange={(e) => setF({ ...f, targetKind: e.target.value })}><option value="price">Target price</option><option value="pct">Target %</option><option value="atr">Target x ATR</option></select>
        <input className="input sm" style={{ width: 70 }} placeholder="(none)" value={f.targetValue} onChange={(e) => setF({ ...f, targetValue: e.target.value })} />
        <select className="input sm" value={f.method} disabled={f.targetValue !== ""} title="Used when there is no target" onChange={(e) => setF({ ...f, method: e.target.value })}>{METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select>
        {["atr", "pct", "slope"].includes(f.method) && f.targetValue === "" && <input className="input sm" style={{ width: 54 }} placeholder={f.method === "atr" ? "2" : f.method === "pct" ? "5" : "0.25"} value={f.methodValue} onChange={(e) => setF({ ...f, methodValue: e.target.value })} />}
        <label className="muted">candles <input className="input sm" style={{ width: 48 }} value={f.horizon} onChange={(e) => setF({ ...f, horizon: e.target.value })} /></label>
        <input className="input sm" style={{ width: 90 }} placeholder="Invalidation" value={f.invalidate} onChange={(e) => setF({ ...f, invalidate: e.target.value })} />
        <select className="input sm" value={f.onInvalid} onChange={(e) => setF({ ...f, onInvalid: e.target.value })} title="When the condition fails"><option value="mark">Invalid: mark red</option><option value="remove">Invalid: remove</option></select>
        <button className="btn sm primary" disabled={!!err} onClick={fromForm}>Add projection</button>
      </div>
      {err && <div className="note warn small">{err}</div>}
      {list.map((p) => { const r = res.get(p.id); return (
        <div key={p.id} className="row small" style={{ gap: 6, flexWrap: "wrap" }}>
          <Check checked={!p.hidden} onChange={(on) => setList(list.map((x) => (x.id === p.id ? { ...x, hidden: !on } : x)))}><b>{p.name}</b></Check>
          {r && <Badge kind={r.status === "reached" ? "g" : r.status === "invalidated" ? "r" : r.status === "active" ? "b" : ""}>{r.status}</Badge>}
          <span className="muted">{r?.statusText}{r?.methodNote ? ` · method: ${r.methodNote}` : ""}{r?.stats ? ` · best ${pct(r.stats.best)}, worst ${pct(r.stats.worst)}` : ""}</span>
          {onAlert && r?.target && <button className="btn sm" title="Alert when the close reaches the projected target" onClick={() => onAlert({ type: "projection", name: p.name }, [{ price: r.target, label: `projection target (${p.name})` }])}>Alert at target</button>}
          <button className="btn sm" onClick={() => csv(p)}>CSV</button>
          <button className="btn sm ghost" onClick={() => setList(list.filter((x) => x.id !== p.id))}>✕</button>
        </div>); })}
      <div className="small muted">Recomputed from the candles every time they change (new data, another timeframe), so a triggered, reached or failed projection updates itself. Solid = candles already passed, dashed = still ahead.</div>
    </div>
  );
}

/** Replay controls and practice orders on the replayed candles. */
export function ReplayPanel({ replay, setReplay, fullBars, sec }) {
  const [startDate, setStartDate] = useState("");
  const n = fullBars.time.length;
  const start = () => {
    const i = startDate ? Math.max(30, indexAt(fullBars.time, startDate)) : Math.max(30, n - 250);
    setReplay({ idx: Math.min(n - 1, i), playing: false, speed: 1, trades: [] });
  };
  if (!replay) return (
    <div className="row small" style={{ gap: 6 }}>
      <span>Replay from</span><input type="date" className="input sm" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
      <button className="btn sm primary" onClick={start}>Start replay</button>
      <span className="muted">The chart hides every candle after the replay point; studies, drawings and projections recompute as it moves. Practice orders fill at the replayed close.</span>
    </div>
  );
  const px = fullBars.close[replay.idx], date = fullBars.time[replay.idx];
  const trades = replay.trades || [];
  const st = paperStats(trades.map((t) => ({ id: "r", side: t.side, qty: t.qty, price: t.price, date: t.date })));
  const pos = st.open[0]?.qty || 0;
  const order = (side) => setReplay({ ...replay, trades: [...trades, { side, qty: 1, price: px, date }] });
  const flat = () => pos && setReplay({ ...replay, trades: [...trades, { side: pos > 0 ? "sell" : "buy", qty: Math.abs(pos), price: px, date }] });
  const openPnl = pos ? (px - st.open[0].avg) * pos : 0;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row small" style={{ gap: 6, flexWrap: "wrap" }}>
        <b className="mono">{date}</b><span className="mono">close {px.toFixed(2)}</span>
        <button className="btn sm" onClick={() => setReplay({ ...replay, idx: Math.max(30, replay.idx - 1), playing: false })}>◀ Step</button>
        <button className="btn sm primary" onClick={() => setReplay({ ...replay, playing: !replay.playing })}>{replay.playing ? "Pause" : "Play"}</button>
        <button className="btn sm" onClick={() => setReplay({ ...replay, idx: Math.min(n - 1, replay.idx + 1), playing: false })}>Step ▶</button>
        <Seg value={replay.speed} options={[1, 2, 5, 10].map((x) => ({ value: x, label: `${x}x` }))} onChange={(speed) => setReplay({ ...replay, speed })} />
        <span className="sep" />
        <button className="btn sm" style={{ color: "#16a34a" }} onClick={() => order("buy")}>Buy 1</button>
        <button className="btn sm" style={{ color: "#dc2626" }} onClick={() => order("sell")}>Sell 1</button>
        <button className="btn sm" disabled={!pos} onClick={flat}>Close position</button>
        <span>Position {pos} · open {openPnl.toFixed(2)} · realised {st.realised.toFixed(2)}</span>
        <button className="btn sm ghost" onClick={() => setReplay(null)}>Exit replay</button>
      </div>
      {st.n > 0 && <div className="small muted">{st.n} closed trade{st.n > 1 ? "s" : ""} on {sec.symbol}: win rate {Math.round(st.winRate * 100)}%, average win {st.avgWin.toFixed(2)}, average loss {st.avgLoss.toFixed(2)}, expectancy {st.expectancy.toFixed(2)} per trade, deepest drop {st.maxDrawdown.toFixed(2)}.</div>}
    </div>
  );
}

/** Day-of-week / month-of-year statistics; the overlay toggle draws the average year on the chart. */
export function SeasonalityPanel({ daily, overlay, setOverlay }) {
  const s = useMemo(() => (daily ? seasonality(daily.time, daily.close) : null), [daily]);
  if (!s) return null;
  const cell = (x) => <span className={x.avg > 0 ? "pos" : x.avg < 0 ? "neg" : ""}>{pct(x.avg)}</span>;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <Check checked={overlay} onChange={setOverlay}>Show the average year on the chart ({s.years} full year{s.years === 1 ? "" : "s"} of history)</Check>
      <div className="grid" style={{ gridTemplateColumns: "1fr 2fr", gap: 10 }}>
        <table className="table small"><thead><tr><th>Day</th><th>Avg</th><th>Median</th><th>Up days</th><th>n</th></tr></thead>
          <tbody>{s.dayOfWeek.map((x) => <tr key={x.label}><td>{x.label}</td><td>{cell(x)}</td><td>{pct(x.median)}</td><td>{x.up == null ? "—" : `${Math.round(x.up * 100)}%`}</td><td>{x.n}</td></tr>)}</tbody></table>
        <table className="table small"><thead><tr><th>Month</th><th>Avg</th><th>Median</th><th>Up years</th><th>n</th></tr></thead>
          <tbody>{s.monthOfYear.map((x) => <tr key={x.label}><td>{x.label}</td><td>{cell(x)}</td><td>{pct(x.median)}</td><td>{x.up == null ? "—" : `${Math.round(x.up * 100)}%`}</td><td>{x.n}</td></tr>)}</tbody></table>
      </div>
      <div className="small muted">Close-to-close returns in the instrument's own currency over its stored history. Economic, earnings and central-bank calendars are not in this app's data yet, so event statistics are not shown.</div>
    </div>
  );
}

/** Market profile (TPO) from candles: letters per period, POC, value area, single prints. */
export function TpoView({ bars }) {
  const [block, setBlock] = usePersistent("chartlab.tpoBlock", "M");
  const [count, setCount] = useState(6);
  const H = 520;
  const profs = useMemo(() => {
    const blk = block === "20" ? 20 : block;
    const first = tpoProfiles(bars, { block: blk, rows: 10 }).slice(-count);
    if (!first.length) return [];
    // one price step for every profile: about 11 px per row on this chart
    const lo0 = Math.min(...first.map((p) => p.rows[0].lo)), hi0 = Math.max(...first.map((p) => p.rows.at(-1).hi));
    const tick = (hi0 - lo0) / ((H - 30) / 11) || 1;
    const from = bars.time.indexOf(first[0].from);
    return tpoProfiles(bars, { block: blk, tick, from: Math.max(0, from) }).slice(-count);
  }, [bars, block, count]);
  if (!profs.length) return null;
  const lo = Math.min(...profs.map((p) => p.rows[0].lo)), hi = Math.max(...profs.map((p) => p.rows.at(-1).hi));
  const y = (v) => H - ((v - lo) / (hi - lo || 1)) * (H - 30) - 10;
  const colW = Math.max(150, Math.min(260, 8 + 7 * Math.max(...profs.map((p) => p.periods))));
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row small" style={{ gap: 6 }}>
        <Seg value={block} options={[{ value: "W", label: "Weekly blocks" }, { value: "M", label: "Monthly blocks" }, { value: "Q", label: "Quarterly blocks" }, { value: "20", label: "20 candles" }]} onChange={setBlock} />
        <Seg value={count} options={[4, 6, 10].map((x) => ({ value: x, label: `${x} profiles` }))} onChange={setCount} />
        <span className="muted">Each letter is one candle of the chart (A = first). End-of-day data has no intraday periods, so a profile spans a block of candles.</span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <svg width={profs.length * colW + 60} height={H} style={{ fontFamily: "monospace", fontSize: 9 }}>
          {profs.map((p, k) => {
            const x0 = 10 + k * colW;
            return (
              <g key={p.key}>
                <text x={x0} y={12} fill="var(--muted)" fontSize="10">{p.from} → {p.to}</text>
                {p.vah != null && <rect x={x0} y={y(p.vah)} width={colW - 14} height={Math.max(1, y(p.val) - y(p.vah))} fill="rgba(56,189,248,.10)" />}
                {p.rows.map((r, j) => (
                  <text key={j} x={x0} y={y((r.lo + r.hi) / 2) + 3} fill={p.singles.some((sg) => sg[0] === r.lo) ? "#f59e0b" : "var(--text)"} fontSize="10">{r.letters}</text>
                ))}
                {p.poc != null && <line x1={x0} x2={x0 + colW - 14} y1={y(p.poc)} y2={y(p.poc)} stroke="#f43f5e" strokeWidth="1.5" />}
              </g>
            );
          })}
          {[0, 0.25, 0.5, 0.75, 1].map((f) => { const v = lo + f * (hi - lo); return <text key={f} x={profs.length * colW + 14} y={y(v) + 3} fill="var(--muted)" fontSize="10">{v.toFixed(2)}</text>; })}
        </svg>
      </div>
      <div className="small muted">Red line = point of control (most letters); blue band = value area (70% of letters); orange letters = single prints.</div>
    </div>
  );
}

const VOTE = { 1: ["g", "bullish"], [-1]: ["r", "bearish"], 0: ["", "neutral"] };
/** How many signals agree on the chart's instrument, with every vote and its reason. A count, not a forecast. */
export function ConfluencePanel({ snap }) {
  const tf = snap?.snap?.tf;
  if (!tf) return <div className="small muted">No stored calculation for this instrument yet.</div>;
  const x = confluenceAcross(tf);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row" style={{ gap: 8 }}><b>{x.text}</b><Badge kind={x.aligned ? (x.D.lean === "bullish" ? "g" : "r") : ""}>{x.aligned ? "daily and weekly aligned" : "not aligned"}</Badge></div>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 10 }}>
        {["D", "W"].map((k) => { const c = x[k]; return (
          <div key={k} className="card tight" style={{ padding: 8 }}>
            <div className="row" style={{ gap: 6 }}><b>{k === "D" ? "Daily" : "Weekly"}</b>{c ? <><Badge kind={c.lean === "bullish" ? "g" : c.lean === "bearish" ? "r" : ""}>{c.lean}{c.strength ? ` · ${c.strength}` : ""}</Badge>
              <span className="muted small">{c.bull} bullish · {c.bear} bearish · {c.neutral} neutral of {c.counted} readable</span></> : <span className="muted small">not enough candles</span>}</div>
            {c && <table className="small"><tbody>{c.items.map((i) => <tr key={i.key}><td>{i.label}</td><td><Badge kind={VOTE[i.vote][0]}>{VOTE[i.vote][1]}</Badge></td><td className="muted">{i.why}</td></tr>)}</tbody></table>}
          </div>); })}
      </div>
      <div className="small muted">Each signal is read from the stored calculation for that timeframe and votes +1, -1 or 0; a signal that cannot be read is left out. This is a count of agreement, not a forecast, a rating or a recommendation.</div>
    </div>
  );
}

const EVENT_KINDS = [["results", "Results / earnings", "#38bdf8"], ["dividend", "Dividend / ex-date", "#22c55e"], ["policy", "Central bank / policy", "#f59e0b"], ["macro", "Economic data", "#a78bfa"], ["corp", "Corporate action / AGM", "#f472b6"], ["other", "Other", "#9ca3af"]];
export const eventColor = (k) => (EVENT_KINDS.find((x) => x[0] === k) || EVENT_KINDS[5])[2];
/** Events you enter yourself (no calendar feed is connected); shown as dots on this instrument's charts. */
export function EventsPanel({ list, setList }) {
  const [f, setF] = useState({ date: "", label: "", kind: "results", all: false });
  const add = () => { if (!f.date || !f.label.trim()) return; setList([...list, { id: uid(), date: f.date, label: f.label.trim(), kind: f.kind, all: f.all }].sort((a, b) => (a.date < b.date ? -1 : 1))); setF({ ...f, label: "" }); };
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="small muted">No earnings, central-bank or economic calendar is connected, so nothing here is fetched. Add the dates you care about; they show as dots on this chart (and on every chart if you tick "all instruments"). Upcoming ones are listed first.</div>
      <div className="row small" style={{ gap: 6, flexWrap: "wrap" }}>
        <input type="date" className="input sm" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        <select className="input sm" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{EVENT_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <input className="input sm" style={{ width: 260 }} placeholder="e.g. Q2 results · RBI policy · ex-dividend 12" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} onKeyDown={(e) => e.key === "Enter" && add()} />
        <Check checked={f.all} onChange={(all) => setF({ ...f, all })}>all instruments</Check>
        <button className="btn sm primary" disabled={!f.date || !f.label.trim()} onClick={add}>Add event</button>
      </div>
      {list.length === 0 ? <div className="small muted">No events yet.</div> : list.map((e) => (
        <div key={e.id} className="row small" style={{ gap: 6 }}>
          <span style={{ width: 9, height: 9, borderRadius: 9, background: eventColor(e.kind), display: "inline-block" }} />
          <span className="mono">{e.date}</span><b>{e.label}</b>{e.all && <Badge>all instruments</Badge>}
          <button className="btn sm ghost" onClick={() => setList(list.filter((x) => x.id !== e.id))}>✕</button>
        </div>))}
    </div>
  );
}
