import { href } from "../lib/router.js";
import { fmtPct, signClass } from "../lib/format.js";

export function Seg({ value, options, onChange, title }) {
  return (
    <div className="seg" title={title}>
      {options.map((o) => {
        const v = typeof o === "object" ? o.value : o, l = typeof o === "object" ? o.label : o;
        return <button key={String(v)} className={value === v ? "on" : ""} onClick={() => onChange(v)}>{l}</button>;
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

export const StockLink = ({ sec, children }) => (sec ? <a href={href(`stock/${sec.id}`)} title={sec.name}>{children || sec.symbol}</a> : <span>—</span>);
export const Pct = ({ v, d = 1 }) => <span className={signClass(v)}>{fmtPct(v, d)}</span>;

export const STAGE_BADGE = { 0: "r", 1: "a", 2: "", 3: "b", 4: "b", 5: "g", 6: "g", 7: "g" };
export const QUAD_COLOR = { Leading: "#16a34a", Improving: "#2563eb", Weakening: "#d97706", Lagging: "#dc2626" };
export const TREND_BADGE = { rising: "g", turn_up_from_low: "g", falling: "r", turn_down_from_high: "r", sideways: "", insufficient: "" };

export function ScoreBar({ v }) {
  return <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}><div className="scorebar" style={{ width: 60 }}><div style={{ width: `${v ?? 0}%` }} /></div><span className="mono small">{v ?? "—"}</span></div>;
}
