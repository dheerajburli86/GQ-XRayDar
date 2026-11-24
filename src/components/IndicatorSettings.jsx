// One panel for every number the charts draw with (moving-average lines, MMA groups, ACC averages, RSI,
// MACD, RSC, Renko / Kagi / P&F, key levels). Every chart reads the same settings (src/lib/indSettings.js),
// so a change here shows everywhere at once. Opened from the "Settings" button on each chart page.
import { useState } from "react";
import { useIndSettings, START, COLOR_LABELS } from "../lib/indSettings.js";
import { MA_KINDS } from "../../engine/studies.js";

const PALETTE = ["#22d3ee", "#14a44d", "#d97706", "#a78bfa", "#f472b6", "#facc15", "#ef4444", "#e5e7eb"];

function ListBox({ label, value, onCommit, title }) {
  const [text, setText] = useState(null);
  return (
    <label className="small muted" title={title}>{label}{" "}
      <input className="input sm" style={{ width: 150 }} value={text ?? value.join(", ")} placeholder="e.g. 3, 5, 8"
        onChange={(e) => setText(e.target.value)} onBlur={() => { if (text != null) { onCommit(text); setText(null); } }}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
    </label>
  );
}
function Num({ label, value, onCommit, blank = false, step = "any", width = 56, title }) {
  const [text, setText] = useState(null);
  const commit = () => { if (text == null) return; const t = text.trim(); if (t === "" && blank) onCommit(null); else if (t !== "" && Number.isFinite(+t)) onCommit(+t); setText(null); };
  return (
    <label className="small muted" title={title}>{label}{" "}
      <input className="input sm" type="number" step={step} style={{ width }} value={text ?? (value ?? "")} placeholder={blank ? "auto" : ""}
        onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
    </label>
  );
}

function FloatList({ label, value, onCommit }) {
  const [text, setText] = useState(null);
  const commit = () => { if (text == null) return; onCommit(String(text).split(/[\s,;]+/).map(Number).filter((x) => Number.isFinite(x))); setText(null); };
  return (
    <label className="small muted">{label}{" "}
      <input className="input sm" style={{ width: 220 }} value={text ?? value.join(", ")} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
    </label>
  );
}

export function IndicatorSettingsPanel({ only = null }) {
  const [s, patch, reset] = useIndSettings();
  const parse = (t) => String(t).split(/[\s,;]+/).map((x) => Math.round(+x)).filter((x) => Number.isFinite(x) && x >= 1 && x <= 1000);
  const show = (k) => !only || only.includes(k);
  const setLine = (i, p) => patch({ lines: s.lines.map((l, j) => (j === i ? { ...l, ...p } : l)) });
  return (
    <div className="card tight stack" style={{ gap: 8 }}>
      <div className="row between"><b>Indicator settings</b><span className="small muted">Every chart uses these. Change any number; nothing is fixed.</span></div>
      {show("lines") && <div className="stack" style={{ gap: 4 }}>
        <div className="small"><b>Price moving averages</b> <span className="muted">(any number of lines, any type, period and colour)</span></div>
        {s.lines.map((l, i) => (
          <div key={i} className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            <input type="checkbox" checked={!l.off} onChange={(e) => setLine(i, { off: !e.target.checked })} title="Show this line" />
            <select className="input sm" value={l.kind} onChange={(e) => setLine(i, { kind: e.target.value })}>{MA_KINDS.map((k) => <option key={k}>{k}</option>)}</select>
            <Num label="period" value={l.n} onCommit={(n) => n >= 1 && setLine(i, { n: Math.round(n) })} />
            <input type="color" value={l.color} onChange={(e) => setLine(i, { color: e.target.value })} title="Colour" />
            <button className="btn sm ghost" onClick={() => patch({ lines: s.lines.filter((_, j) => j !== i) })} title="Remove">✕</button>
          </div>
        ))}
        <div><button className="btn sm" onClick={() => patch({ lines: [...s.lines, { kind: "EMA", n: 10, color: PALETTE[s.lines.length % PALETTE.length] }] })}>+ Add line</button></div>
      </div>}
      {show("groups") && <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        <ListBox label="MMA short group (yellow)" value={s.mmaShort} onCommit={(t) => patch({ mmaShort: parse(t) })} />
        <ListBox label="MMA long group (red)" value={s.mmaLong} onCommit={(t) => patch({ mmaLong: parse(t) })} />
        <ListBox label="ACC averages" value={s.acc} onCommit={(t) => patch({ acc: parse(t) })} />
      </div>}
      {show("osc") && <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        <Num label="RSI" value={s.rsi} onCommit={(n) => patch({ rsi: n })} />
        <Num label="RSI of RSI" value={s.rsiNested} onCommit={(n) => patch({ rsiNested: n })} />
        <Num label="RSI upper line" value={s.rsiHigh} onCommit={(n) => patch({ rsiHigh: n })} />
        <Num label="RSI lower line" value={s.rsiLow} onCommit={(n) => patch({ rsiLow: n })} />
        <Num label="MACD fast" value={s.macdFast} onCommit={(n) => patch({ macdFast: n })} />
        <Num label="slow" value={s.macdSlow} onCommit={(n) => patch({ macdSlow: n })} />
        <Num label="signal" value={s.macdSignal} onCommit={(n) => patch({ macdSignal: n })} />
        <Num label="RSC average" value={s.rscAvg} onCommit={(n) => patch({ rscAvg: n })} />
        <Num label="RSC starts at" value={s.rscBase} onCommit={(n) => patch({ rscBase: n })} />
      </div>}
      {show("styles") && <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        <Num label="Renko box" value={s.renkoBox} blank onCommit={(n) => patch({ renkoBox: n })} title="Blank = sized from the price" />
        <Num label="Kagi reversal %" value={s.kagiPct} onCommit={(n) => patch({ kagiPct: n })} />
        <Num label="P&F box" value={s.pfBox} blank onCommit={(n) => patch({ pfBox: n })} title="Blank = sized from the price" />
        <Num label="P&F reversal boxes" value={s.pfRev} onCommit={(n) => patch({ pfRev: n })} />
        <Num label="Key levels lookback (candles)" value={s.srLookback} blank onCommit={(n) => patch({ srLookback: n })} title="Blank = 250 daily candles, 150 otherwise" width={70} />
        <Num label="Fibonacci lookback (candles)" value={s.fibLookback} blank onCommit={(n) => patch({ fibLookback: n })} title="Blank = 250 daily candles, 120 otherwise" width={70} />
        <FloatList label="Fibonacci ratios" value={s.fibRatios} onCommit={(xs) => patch({ fibRatios: xs })} />
        <Num label="Volume profile rows" value={s.vpBins} onCommit={(n) => patch({ vpBins: n })} />
        <Num label="Value area %" value={s.vpValueArea} onCommit={(n) => patch({ vpValueArea: n })} />
      </div>}
      {show("colors") && <div className="stack" style={{ gap: 4 }}>
        <div className="small"><b>Colours</b> <span className="muted">(every line, candle and background the charts draw)</span></div>
        {COLOR_LABELS.map(([group, keys]) => (
          <div key={group} className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <span className="small muted" style={{ minWidth: 150 }}>{group}</span>
            {keys.map(([k, label]) => (
              <label key={k} className="small muted" style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>{label}
                <input type="color" value={s.colors[k]} onChange={(e) => patch({ colors: { ...s.colors, [k]: e.target.value } })} />
              </label>
            ))}
            {group.startsWith("RSI / RSC") && s.colors.aAcc.map((c, i) => (
              <label key={`acc${i}`} className="small muted" style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>ACC {i + 1}
                <input type="color" value={c} onChange={(e) => patch({ colors: { ...s.colors, aAcc: s.colors.aAcc.map((x, j) => (j === i ? e.target.value : x)) } })} />
              </label>
            ))}
          </div>
        ))}
        <div><button className="btn sm ghost" onClick={() => patch({ colors: START.colors })}>Colours back to start</button></div>
      </div>}
      <div className="row" style={{ gap: 6 }}>
        <button className="btn sm ghost" onClick={() => { if (window.confirm("Put every setting back to the published starting values?")) reset(); }}>Start values</button>
        <span className="small muted">Start values: {START.lines.map((l) => `${l.kind} ${l.n}`).join(", ")}; MMA {START.mmaShort.join("/")} | {START.mmaLong.join("/")}; RSI {START.rsi}; MACD {START.macdFast}/{START.macdSlow}/{START.macdSignal}. Each indicator in the Indicators list has its own boxes too.</span>
      </div>
    </div>
  );
}

/** "Settings" toggle button + the panel under it. */
export function IndicatorSettingsButton({ only = null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={`btn sm ${open ? "primary" : ""}`} onClick={() => setOpen(!open)} title="Periods, colours and levels of every line on the charts">⚙ Settings</button>
      {open && <div style={{ flexBasis: "100%" }}><IndicatorSettingsPanel only={only} /></div>}
    </>
  );
}
