import { useMemo, useState } from "react";
import { useData } from "../data/store.jsx";
import { FIELD, fieldValue } from "../../engine/fields.js";
import { fmtField, signClass } from "../lib/format.js";
import { Select, StockLink } from "./ui.jsx";
import { CAPS } from "../../engine/indexEngine.js";
import { ANALYST_TFS, normaliseTf, tfLabel } from "../../engine/calendar.js";

/** Table column from a field key. */
export function fieldColumn(key, opts = {}) {
  const f = FIELD[key];
  if (!f) return { key, label: key, value: (r) => fieldValue(key, r) };
  const num = ["num", "pct", "money"].includes(f.type);
  return {
    key, label: opts.label || f.label, num, title: f.label, value: (r) => f.get(r),
    render: (r) => { const v = f.get(r); return <span className={f.type === "pct" ? signClass(v) : ""}>{fmtField(f.type, v)}</span>; },
    ...opts,
  };
}
export const symbolColumn = { key: "symbol", label: "Symbol", value: (r) => r.sec.symbol, render: (r) => <StockLink sec={r.sec} /> };
export const nameColumn = { key: "name", label: "Name", value: (r) => r.sec.name, render: (r) => <span title={r.sec.name}>{(r.sec.name || "").slice(0, 32)}</span> };
export const idColumns = (keys = ["country", "sector", "cap"]) => [symbolColumn, nameColumn, ...keys.map((k) => fieldColumn(k))];

/** Region / country / sector / cap filter controls bound to a scope object. */
export function ScopeFilter({ scope, onChange, show = ["region", "country", "sector", "cap", "asset"] }) {
  const d = useData();
  const set = (k, v) => onChange({ ...scope, [k]: v || null });
  const countries = scope.region ? d.countries.filter((c) => d.secs.some((s) => s.country === c && s.region === scope.region)) : d.countries;
  return (
    <div className="row">
      {show.includes("region") && <Select label="Region" value={scope.region} options={d.regions} onChange={(v) => onChange({ ...scope, region: v, country: null })} allowEmpty />}
      {show.includes("classification") && <Select label="Class" value={scope.classification} options={d.classifications} onChange={(v) => set("classification", v)} allowEmpty />}
      {show.includes("country") && <Select label="Country" value={scope.country} options={countries} onChange={(v) => set("country", v)} allowEmpty />}
      {show.includes("sector") && <Select label="Sector" value={scope.sector} options={d.sectors} onChange={(v) => set("sector", v)} allowEmpty />}
      {show.includes("cap") && <Select label="Cap" value={scope.cap} options={CAPS} onChange={(v) => set("cap", v)} allowEmpty />}
      {show.includes("asset") && <Select label="Type" value={scope.assetClass} options={["Stock", "ETF", "Index", "Commodity", "Crypto", "Currency"]} onChange={(v) => set("assetClass", v)} allowEmpty="All types" />}
    </div>
  );
}
export function applyScope(rows, scope) {
  return rows.filter((r) => (!scope.region || r.sec.region === scope.region) && (!scope.classification || r.sec.classification === scope.classification)
    && (!scope.country || r.sec.country === scope.country) && (!scope.sector || r.sec.sector === scope.sector)
    && (!scope.industryGroup || r.sec.industryGroup === scope.industryGroup) && (!scope.cap || r.sec.capSegment === scope.cap)
    && (!scope.assetClass || (r.sec.assetClass || "Stock") === scope.assetClass));
}

/** Search box over securities and indices. value: {kind:'sec'|'index', id|key, label} */
export function InstrumentPicker({ value, onChange, placeholder = "Search stock or index…", allowIndex = true, width = 260 }) {
  const d = useData();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    const secs = d.secs.filter((x) => x.symbol.toLowerCase().startsWith(s) || (x.name || "").toLowerCase().includes(s)).slice(0, 12)
      .map((x) => ({ kind: "sec", id: x.id, label: `${x.symbol} · ${x.name}`, sub: x.country }));
    const idx = allowIndex ? d.indices.filter((x) => x.name.toLowerCase().includes(s) || x.key.toLowerCase().includes(s)).slice(0, 10)
      .map((x) => ({ kind: "index", key: x.key, label: x.name, sub: `Index L${x.level}` })) : [];
    return [...secs, ...idx];
  }, [q, d.secs, d.indices, allowIndex]);
  return (
    <div className="cmd" style={{ maxWidth: width, minWidth: width }}>
      <span className="ico">⌕</span>
      <input value={open ? q : value?.label || ""} placeholder={placeholder} onFocus={() => { setOpen(true); setQ(""); }} onBlur={() => setTimeout(() => setOpen(false), 150)} onChange={(e) => setQ(e.target.value)} style={{ paddingRight: 10 }} />
      {open && results.length > 0 && (
        <div className="dropdown">
          {results.map((r) => <div key={r.kind + (r.id || r.key)} className="it" onMouseDown={() => { onChange(r); setOpen(false); }}><span>{r.label}</span><span className="muted small">{r.sub}</span></div>)}
        </div>
      )}
    </div>
  );
}

/**
 * Timeframe picker: the standard list (D, W, 1-11 months, 1 and 2 years) plus any
 * timeframe the user types ("18M", "3Y", "13W"). Invalid input is refused, never guessed.
 */
export function TfPicker({ value, onChange, title = "Candle period", dark = false }) {
  const [custom, setCustom] = useState(false);
  const [text, setText] = useState("");
  const bad = text.trim() !== "" && !normaliseTf(text);
  const opts = ANALYST_TFS.includes(value) ? ANALYST_TFS : [...ANALYST_TFS, value];
  const style = dark ? { background: "#111", color: "#eee", border: "1px solid #444" } : undefined;
  if (custom) {
    return (
      <input autoFocus className="input sm" style={{ width: 92, ...style, ...(bad ? { borderColor: "#dc2626" } : {}) }} value={text} placeholder="e.g. 18M, 3Y, 13W"
        title="Months (M), weeks (W) or years (Y). Enter to apply, Esc to cancel"
        onChange={(e) => setText(e.target.value)} onBlur={() => setCustom(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setCustom(false);
          if (e.key === "Enter") { const tf = normaliseTf(text); if (tf) { onChange(tf); setCustom(false); setText(""); } }
        }} />
    );
  }
  return (
    <select className="input sm" style={style} title={title} value={value} onChange={(e) => (e.target.value === "__custom" ? setCustom(true) : onChange(e.target.value))}>
      {opts.map((t) => <option key={t} value={t}>{tfLabel(t)}</option>)}
      <option value="__custom">Custom…</option>
    </select>
  );
}
