// OHLCV legend (top-left of a chart) and the floating Data window (Ctrl+D, draggable), as in the Analyst software.
import { useEffect, useRef, useState } from "react";
import { useDw, toggleDw, barIndex, barInfo, emasOf, EMA_SHORT, EMA_LONG, dayName, dmy, fmtPx, fmtVol } from "../lib/dataWindow.js";

/** One line of real OHLCV for the candle under the cursor (the last candle when the cursor is elsewhere). */
export function OhlcvLegend({ src }) {
  const dw = useDw();
  if (!src?.bars?.time?.length) return null;
  const hovering = dw.src?.bars === src.bars ? dw.time : null;
  const info = barInfo(src.bars, barIndex(src.bars, hovering));
  if (!info) return null;
  const up = info.chg == null ? null : info.chg >= 0;
  const flat = info.open === info.high && info.high === info.low && info.low === info.close; // a level series has no OHLC
  return (
    <div className="ohlcv-legend" data-html2canvas-ignore>
      <span className="muted">{dmy(info.time)}</span> {!flat && <><span>O <b>{fmtPx(info.open)}</b></span> <span>H <b>{fmtPx(info.high)}</b></span> <span>L <b>{fmtPx(info.low)}</b></span></>} <span>{flat ? "Value" : "C"} <b>{fmtPx(info.close)}</b></span>
      {info.chg != null && <span className={up ? "pos" : "neg"}>{up ? "+" : ""}{info.chg.toFixed(2)}%</span>}
      {info.volume != null && <span>V <b>{fmtVol(info.volume)}</b></span>}
    </div>
  );
}

const Row = ({ k, v, c }) => <div className="dw-row"><span>{k}</span><span style={c ? { color: c } : undefined}>{v}</span></div>;

const POS_KEY = "gqta.dataWindow.pos";
function loadPos() { try { const p = JSON.parse(localStorage.getItem(POS_KEY)); if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) return p; } catch { /* none */ } return { x: 16, y: 120 }; }

/** Mounted once in the app shell. Ctrl+D opens and closes it; drag the title bar to move it. */
export function DataWindow() {
  const dw = useDw();
  const [pos, setPos] = useState(loadPos);
  const drag = useRef(null);
  useEffect(() => {
    const h = (e) => { if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "d") { e.preventDefault(); toggleDw(); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  if (!dw.open) return null;
  const down = (e) => { drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y }; e.currentTarget.setPointerCapture(e.pointerId); };
  const move = (e) => { if (!drag.current) return; setPos({ x: Math.min(Math.max(0, e.clientX - drag.current.dx), window.innerWidth - 120), y: Math.min(Math.max(0, e.clientY - drag.current.dy), window.innerHeight - 40) }); };
  const up = () => { if (drag.current) { drag.current = null; try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch { /* private mode */ } } };
  const src = dw.src;
  const i = src ? barIndex(src.bars, dw.time) : -1;
  const info = src ? barInfo(src.bars, i) : null;
  const ema = src && info ? emasOf(src.bars) : null;
  return (
    <div className="data-window" style={{ left: pos.x, top: pos.y }} role="dialog" aria-label="Data window">
      <div className="dw-title" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <span>Data Window</span><button onPointerDown={(e) => e.stopPropagation()} onClick={() => toggleDw(false)} title="Close (Ctrl+D)">✕</button>
      </div>
      {!info ? <div className="dw-empty">Move the cursor over a chart.</div> : (
        <div className="dw-body">
          <div className="dw-name">{src.name}{src.tf ? ` · ${src.tf}` : ""}</div>
          <Row k="Date" v={dmy(info.time)} /><Row k="Day" v={dayName(info.time)} />
          {!(info.open === info.high && info.high === info.low && info.low === info.close) && <><Row k="Open" v={fmtPx(info.open)} /><Row k="High" v={fmtPx(info.high)} /><Row k="Low" v={fmtPx(info.low)} /></>}<Row k={info.open === info.low && info.high === info.low ? "Value" : "Close"} v={fmtPx(info.close)} />
          <Row k="% Change" v={info.chg == null ? "—" : info.chg.toFixed(4)} c={info.chg == null ? null : info.chg >= 0 ? "#00ff7f" : "#ff5050"} />
          {info.volume != null && <Row k="Volume" v={fmtVol(info.volume)} />}
          {EMA_SHORT.map((n) => <Row key={n} k={`${n}E:C`} v={fmtPx(ema[n][i])} c="#ffff00" />)}
          {EMA_LONG.map((n) => <Row key={n} k={`${n}E:C`} v={fmtPx(ema[n][i])} c="#ff4040" />)}
        </div>
      )}
    </div>
  );
}
