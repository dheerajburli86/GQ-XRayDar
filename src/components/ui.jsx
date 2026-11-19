import { useEffect, useState } from "react";
import { href } from "../lib/router.js";
import { fmtPct, signClass } from "../lib/format.js";

export function Seg({ value, options, onChange, title }) {
  return (
    <div className="seg" title={title}>
      {options.map((o) => {
        const v = typeof o === "object" ? o.value : o, l = typeof o === "object" ? o.label : o;
        return <button key={String(v)} className={value === v ? "on" : ""} title={typeof o === "object" ? o.title : undefined} onClick={() => onChange(v)}>{l}</button>;
      })}
    </div>
  );
}

export function Select({ value, options, onChange, label, style, allowEmpty }) {
  return (
    <label className="lbl-ctl">
      {label}
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} style={style}>
        {allowEmpty && <option value="">{allowEmpty === true ? "All" : allowEmpty}</option>}
        {options.map((o) => {
          const v = typeof o === "object" ? o.value : o, l = typeof o === "object" ? o.label : o;
          return <option key={String(v)} value={v}>{l}</option>;
        })}
      </select>
    </label>
  );
}

export const Check = ({ checked, onChange, children, color }) => (
  <label className="chk">
    <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
    {color && <span className="swatch" style={{ background: color }} />}
    {children}
  </label>
);

export const Badge = ({ kind = "", children, title }) => <span className={`badge ${kind}`} title={title}>{children}</span>;

export const Kpi = ({ label, value, sub, cls }) => (
  <div className="kpi"><div className="l">{label}</div><div className={`v ${cls || ""}`}>{value}</div>{sub && <div className="small muted">{sub}</div>}</div>
);

export function Tabs({ tabs, value, onChange }) {
  return <div className="tabs">{tabs.map((t) => { const v = typeof t === "object" ? t.value : t; const l = typeof t === "object" ? t.label : t; return <button key={v} className={value === v ? "on" : ""} onClick={() => onChange(v)}>{l}</button>; })}</div>;
}

export const Empty = ({ children }) => <div className="empty">{children}</div>;
export const Loading = ({ what }) => <div className="empty">Loading{what ? ` ${what}` : ""}…</div>;
export const ErrorBox = ({ error }) => <div className="note warn">Could not load: {String(error?.message || error)}</div>;

export function PageHead({ title, sub, children }) {
  return (
    <div className="page-head">
      <div><h1>{title}</h1>{sub && <div className="sub">{sub}</div>}</div>
      <div className="row">{children}</div>
    </div>
  );
}

// A stock's name opens its page as before; the small arrow (or a right-click) offers every other screen for it
// (owner, improvement 20: "if I click any stock there should be an option to load its screen").
const STOCK_SCREENS = [["Stock page", (id) => `stock/${id}`], ["Chart lab", (id) => `chart/${id}`], ["RSIMMA", (id) => `screens/RSIMMA/${encodeURIComponent(`s:${id}`)}`], ["RSIACC", (id) => `screens/RSIACC/${encodeURIComponent(`s:${id}`)}`], ["RSCMMA", (id) => `screens/RSCMMA/${encodeURIComponent(`s:${id}`)}`], ["RSCACC", (id) => `screens/RSCACC/${encodeURIComponent(`s:${id}`)}`], ["Multi-tile: peers", (id) => `tiles?inst=${encodeURIComponent(`s:${id}`)}`]];
export function StockLink({ sec, children }) {
  const [m, setM] = useState(null);
  useEffect(() => {
    if (!m) return undefined;
    const close = () => setM(null), key = (e) => e.key === "Escape" && close();
    window.addEventListener("click", close); window.addEventListener("scroll", close, true); window.addEventListener("keydown", key);
    return () => { window.removeEventListener("click", close); window.removeEventListener("scroll", close, true); window.removeEventListener("keydown", key); };
  }, [m]);
  if (!sec) return <span>—</span>;
  const open = (e) => { e.preventDefault(); e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect?.(); setM(e.type === "contextmenu" ? { x: e.clientX, y: e.clientY } : { x: r.left, y: r.bottom + 2 }); };
  return (
    <span className="stocklink">
      <a href={href(`stock/${sec.id}`)} title={sec.name} onContextMenu={open}>{children || sec.symbol}</a>
      <button type="button" className="sl-arrow" title="Load this stock in another screen" aria-label={`Screens for ${sec.symbol}`} onClick={open}>▾</button>
      {m && (
        <div className="sl-menu" style={{ left: Math.min(m.x, window.innerWidth - 170), top: Math.min(m.y, window.innerHeight - 250) }} onClick={(e) => e.stopPropagation()}>
          <div className="sl-head">{sec.symbol}</div>
          {STOCK_SCREENS.map(([label, path]) => <a key={label} href={href(path(sec.id))} onClick={() => setM(null)}>{label}</a>)}
        </div>
      )}
    </span>
  );
}
export const Pct = ({ v, d = 1 }) => <span className={signClass(v)}>{fmtPct(v, d)}</span>;

export const STAGE_BADGE = { 0: "r", 1: "a", 2: "", 3: "b", 4: "b", 5: "g", 6: "g", 7: "g" };
export const QUAD_COLOR = { Leading: "#16a34a", Improving: "#2563eb", Weakening: "#d97706", Lagging: "#dc2626" };
export const TREND_BADGE = { rising: "g", turn_up_from_low: "g", falling: "r", turn_down_from_high: "r", sideways: "", insufficient: "" };

export function ScoreBar({ v }) {
  return <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}><div className="scorebar" style={{ width: 60 }}><div style={{ width: `${v ?? 0}%` }} /></div><span className="mono small">{v ?? "—"}</span></div>;
}
