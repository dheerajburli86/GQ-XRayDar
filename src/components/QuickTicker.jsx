// Ticker popup: opened with C (or by typing) on a chart screen. Country / category first,
// then the name (owner, improvements 9 and 15). Arrow keys + Enter, Esc closes.
import { useEffect, useMemo, useRef, useState } from "react";
import { useData } from "../data/store.jsx";
import { CATEGORIES, CATEGORY_LABEL, searchInstruments, useExtras } from "../lib/instruments.js";
import { usePersistent } from "../lib/storage.js";

export function QuickTicker({ initial = "", onPick, onClose, allowIndex = true, secOnly = false, title = "Change instrument" }) {
  const d = useData();
  const extras = useExtras(d.api);
  const [q, setQ] = useState(initial);
  const [cat, setCat] = usePersistent("ticker.category", "All");
  const [sel, setSel] = useState(0);
  const inp = useRef(null), listRef = useRef(null);
  const results = useMemo(() => searchInstruments(d, extras, q, cat, { allowIndex: allowIndex && !secOnly, allowExtra: !secOnly, limit: 40 }), [d, extras, q, cat, allowIndex, secOnly]);
  useEffect(() => { inp.current?.focus(); const v = inp.current?.value || ""; inp.current?.setSelectionRange(v.length, v.length); }, []);
  useEffect(() => { setSel(0); }, [q, cat]);
  useEffect(() => { listRef.current?.querySelector(".it.on")?.scrollIntoView({ block: "nearest" }); }, [sel]);
  const pick = (r) => { if (r) { onPick(r); onClose(); } };
  return (
    <div className="qt-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="qt card" role="dialog" aria-label={title}>
        <div className="row between"><b>{title}</b><span className="small muted">↑ ↓ Enter · Esc closes · D W M Q H Y change the period</span></div>
        <div className="seg qt-cats">{CATEGORIES.map((c) => <button key={c} className={cat === c ? "on" : ""} onClick={() => { setCat(c); inp.current?.focus(); }}>{CATEGORY_LABEL[c] || c}</button>)}</div>
        <input ref={inp} className="input" value={q} placeholder="Type a symbol or name…" onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.preventDefault(); onClose(); }
            else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(results.length - 1, s + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
            else if (e.key === "Enter") { e.preventDefault(); pick(results[sel]); }
          }} />
        <div className="qt-list" ref={listRef}>
          {results.length === 0 ? <div className="small muted" style={{ padding: 8 }}>Nothing found{cat !== "All" ? ` in ${cat}` : ""}.</div>
            : results.map((r, i) => (
              <div key={r.kind + (r.id || r.key)} className={`it ${i === sel ? "on" : ""}`} onMouseEnter={() => setSel(i)} onMouseDown={() => pick(r)}>
                <span>{r.label}</span><span className="muted small">{r.sub}</span>
              </div>))}
        </div>
      </div>
    </div>
  );
}
