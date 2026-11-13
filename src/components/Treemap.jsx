// Squarified treemap (Bruls, Huizing & van Wijk) rendered as absolutely
// positioned divs: fast for a few thousand cells and fully accessible to hover.
import { useMemo, useRef, useState, useLayoutEffect } from "react";

function worst(row, w) {
  const s = row.reduce((a, r) => a + r.area, 0);
  let mx = -Infinity, mn = Infinity;
  for (const r of row) { if (r.area > mx) mx = r.area; if (r.area < mn) mn = r.area; }
  return Math.max((w * w * mx) / (s * s), (s * s) / (w * w * mn));
}
export function squarify(items, x, y, w, h) {
  const total = items.reduce((a, i) => a + i.size, 0);
  if (!total || w <= 0 || h <= 0) return [];
  const scale = (w * h) / total;
  const nodes = items.filter((i) => i.size > 0).sort((a, b) => b.size - a.size).map((i) => ({ ...i, area: i.size * scale }));
  const out = [];
  let rect = { x, y, w, h };
  let row = [];
  const layoutRow = (r) => {
    const s = r.reduce((a, n) => a + n.area, 0);
    if (rect.w >= rect.h) {
      const cw = s / rect.h; let cy = rect.y;
      for (const n of r) { const ch = n.area / cw; out.push({ ...n, x: rect.x, y: cy, w: cw, h: ch }); cy += ch; }
      rect = { x: rect.x + cw, y: rect.y, w: rect.w - cw, h: rect.h };
    } else {
      const ch = s / rect.w; let cx = rect.x;
      for (const n of r) { const cw = n.area / ch; out.push({ ...n, x: cx, y: rect.y, w: cw, h: ch }); cx += cw; }
      rect = { x: rect.x, y: rect.y + ch, w: rect.w, h: rect.h - ch };
    }
  };
  for (const n of nodes) {
    const side = Math.min(rect.w, rect.h);
    if (!row.length || worst([...row, n], side) <= worst(row, side)) row.push(n);
    else { layoutRow(row); row = [n]; }
  }
  if (row.length) layoutRow(row);
  return out;
}

/** items: [{key, label, size, color, sub, tip: [[k,v],...], onClick}] */
export function Treemap({ items, height = 560 }) {
  const ref = useRef(null);
  const [w, setW] = useState(900);
  const [tip, setTip] = useState(null);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el); setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const cells = useMemo(() => squarify(items, 0, 0, w, height), [items, w, height]);
  return (
    <div ref={ref} className="treemap" style={{ height }} onMouseLeave={() => setTip(null)}>
      {cells.map((c) => (
        <div key={c.key} className="tm-cell" style={{ left: c.x, top: c.y, width: c.w, height: c.h, background: c.color }}
          onClick={c.onClick} onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, c })}>
          {c.w > 46 && c.h > 22 && <div className="n" style={{ fontSize: Math.max(10, Math.min(16, c.w / 9)) }}>{c.label}</div>}
          {c.w > 46 && c.h > 36 && <div className="v">{c.sub}</div>}
        </div>
      ))}
      {tip && (
        <div className="tooltip" style={{ left: Math.min(tip.x + 14, window.innerWidth - 330), top: Math.min(tip.y + 14, window.innerHeight - 200) }}>
          <b>{tip.c.title || tip.c.label}</b>
          <table><tbody>{(tip.c.tip || []).map(([k, v]) => <tr key={k}><td className="muted">{k}</td><td className="mono">{v}</td></tr>)}</tbody></table>
        </div>
      )}
    </div>
  );
}

/** Diverging colour for a value: green positive, red negative, intensity by magnitude / scale. */
export function divergingColor(v, scale = 5) {
  if (v == null || !Number.isFinite(v)) return "#4b5563";
  const t = Math.max(-1, Math.min(1, v / scale));
  if (t >= 0) return `rgb(${Math.round(40 - 20 * t)}, ${Math.round(70 + 110 * t)}, ${Math.round(55 + 20 * t)})`;
  return `rgb(${Math.round(70 + 150 * -t)}, ${Math.round(55 - 20 * -t)}, ${Math.round(55 - 15 * -t)})`;
}
export function categoricalColor(v, map) { return map[v] || "#4b5563"; }
