import { useMemo, useState } from "react";
import { useData } from "../data/store.jsx";
import { FIELD, fieldValue } from "../../engine/fields.js";
import { fmtField, signClass } from "../lib/format.js";
import { Select, StockLink } from "./ui.jsx";
import { CAPS } from "../../engine/indexEngine.js";
import { ANALYST_TFS, normaliseTf, tfLabel } from "../../engine/calendar.js";
import { CATEGORIES, CATEGORY_LABEL, searchInstruments, useExtras } from "../lib/instruments.js";
import { usePersistent } from "../lib/storage.js";

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
  const inRegion = (x, r) => (r === "India" ? x.country === "India" : x.region === r);
  const countries = scope.region ? d.countries.filter((c) => d.secs.some((s) => s.country === c && inRegion(s, scope.region))) : d.countries;
  const regionOptions = d.regions.includes("India") ? d.regions : [...d.regions, "India"].sort();
  return (
    <div className="row">
      {show.includes("region") && <Select label="Region" value={scope.region} options={regionOptions} onChange={(v) => onChange({ ...scope, region: v, country: null })} allowEmpty />}
      {show.includes("classification") && <Select label="Class" value={scope.classification} options={d.classifications} onChange={(v) => set("classification", v)} allowEmpty />}
      {show.includes("country") && <Select label="Country" value={scope.country} options={countries} onChange={(v) => set("country", v)} allowEmpty />}
      {show.includes("sector") && <Select label="Sector" value={scope.sector} options={d.sectors} onChange={(v) => set("sector", v)} allowEmpty />}
      {show.includes("cap") && <Select label="Cap" value={scope.cap} options={CAPS} onChange={(v) => set("cap", v)} allowEmpty />}
      {show.includes("asset") && <Select label="Type" value={scope.assetClass} options={["Stock", "ETF", "Index", "Commodity", "Crypto", "Currency"]} onChange={(v) => set("assetClass", v)} allowEmpty="All types" />}
    </div>
  );
}
export function applyScope(rows, scope) {
  return rows.filter((r) => (!scope.region || (scope.region === "India" ? r.sec.country === "India" : r.sec.region === scope.region)) && (!scope.classification || r.sec.classification === scope.classification)
    && (!scope.country || r.sec.country === scope.country) && (!scope.sector || r.sec.sector === scope.sector)
    && (!scope.industryGroup || r.sec.industryGroup === scope.industryGroup) && (!scope.cap || r.sec.capSegment === scope.cap)
    && (!scope.assetClass || (r.sec.assetClass || "Stock") === scope.assetClass));
}

/** Search box over securities, indices and the chart-only extras, with a country / category filter.
 *  value: {kind:'sec'|'index'|'x', id|key, label} */
export function InstrumentPicker({ value, onChange, placeholder = "Search stock or index…", allowIndex = true, secOnly = false, width = 260, category = true }) {
  const d = useData();
  const extras = useExtras(d.api);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [cat, setCat] = usePersistent("ticker.category", "All");
  const results = useMemo(() => (q.trim() ? searchInstruments(d, extras, q, cat, { allowIndex: allowIndex && !secOnly, allowExtra: !secOnly, limit: 14 }) : []), [q, d, extras, cat, allowIndex, secOnly]);
  return (
    <div className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
      {category && <select className="input sm" value={cat} title="Country / category first, then the name" onChange={(e) => setCat(e.target.value)} style={{ width: 92 }}>
        {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c] || c}</option>)}
      </select>}
      <div className="cmd" style={{ maxWidth: width, minWidth: width }}>
        <span className="ico">⌕</span>
        <input value={open ? q : value?.label || ""} placeholder={placeholder} onFocus={() => { setOpen(true); setQ(""); }} onBlur={() => setTimeout(() => setOpen(false), 150)} onChange={(e) => setQ(e.target.value)} style={{ paddingRight: 10 }}
          onKeyDown={(e) => { if (e.key === "Enter" && results[0]) { onChange(results[0]); setOpen(false); e.currentTarget.blur(); } }} />
        {open && results.length > 0 && (
          <div className="dropdown">
            {results.map((r) => <div key={r.kind + (r.id || r.key)} className="it" onMouseDown={() => { onChange(r); setOpen(false); }}><span>{r.label}</span><span className="muted small">{r.sub}</span></div>)}
          </div>
        )}
      </div>
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
