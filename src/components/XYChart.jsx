// Small SVG chart for numeric x axes (strikes, spot levels, days to expiry):
// lines, bars (optionally mirrored / stacked side by side), vertical markers
// and a hover read-out. Time-series charts use TvChart instead.
import { useMemo, useRef, useState } from "react";

const fmt = (v) => (v == null || !Number.isFinite(v) ? "—" : Math.abs(v) >= 1e7 ? `${(v / 1e7).toFixed(2)}Cr` : Math.abs(v) >= 1e5 ? `${(v / 1e5).toFixed(2)}L` : Math.abs(v) >= 1000 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(4));

/**
 * series: [{ name, type: "line"|"bar", color, points:[{x,y}], dash?, axis?: "left"|"right", width? }]
 * markers: [{ x, label, color }]; hBands: [{ y0, y1, color }]
 */
export function XYChart({ series, markers = [], height = 260, xFmt = fmt, yFmt = fmt, y2Fmt = fmt, zeroLine = false, xLabel, yLabel }) {
  const ref = useRef(null);
  const [hover, setHover] = useState(null);
  const W = 900, H = height, L = 56, R = series.some((s) => s.axis === "right") ? 56 : 14, T = 12, B = 28;
  const dom = useMemo(() => {
    const xs = [], yl = [], yr = [];
    for (const s of series) for (const p of s.points) if (Number.isFinite(p.x) && Number.isFinite(p.y)) { xs.push(p.x); (s.axis === "right" ? yr : yl).push(p.y); if (s.type === "bar") (s.axis === "right" ? yr : yl).push(0); }
    for (const m of markers) if (Number.isFinite(m.x)) xs.push(m.x);
    const ext = (a) => { if (!a.length) return [0, 1]; let lo = Math.min(...a), hi = Math.max(...a); if (zeroLine) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); } if (lo === hi) { lo -= 1; hi += 1; } const pad = (hi - lo) * 0.06; return [lo - pad, hi + pad]; };
    return { y: ext(yl), y2: ext(yr), xs: [...new Set(xs)].sort((a, b) => a - b) };
  }, [series, markers, zeroLine]);
  if (!series.some((s) => s.points.length)) return <div className="empty">No data to plot</div>;
  const [x0, x1] = [Math.min(...dom.xs), Math.max(...dom.xs)];
  const sx = (x) => L + ((x - x0) / (x1 - x0 || 1)) * (W - L - R);
  const sy = (y, ax) => { const [a, b] = ax === "right" ? dom.y2 : dom.y; return T + (1 - (y - a) / (b - a)) * (H - T - B); };
  const ticks = (a, b, n = 5) => Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
  const bars = series.filter((s) => s.type === "bar");
  const gaps = dom.xs.slice(1).map((v, i) => v - dom.xs[i]).filter((g) => g > 0);
  const step = gaps.length ? Math.min(...gaps) : (x1 - x0) / 10 || 1;
  const bw = Math.max(1, ((step / (x1 - x0 || 1)) * (W - L - R) * 0.8) / Math.max(1, bars.filter((b) => !b.overlay).length));
  const onMove = (e) => {
    const r = ref.current?.getBoundingClientRect(); if (!r) return;
    const px = ((e.clientX - r.left) / r.width) * W;
    const x = x0 + ((px - L) / (W - L - R)) * (x1 - x0);
    const near = dom.xs.reduce((b, v) => (Math.abs(v - x) < Math.abs(b - x) ? v : b), dom.xs[0]);
    setHover(near);
  };
  return (
    <div style={{ position: "relative" }}>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {ticks(...dom.y).map((t, i) => <g key={i}><line x1={L} x2={W - R} y1={sy(t)} y2={sy(t)} stroke="var(--line)" strokeWidth="0.5" /><text x={L - 6} y={sy(t) + 4} textAnchor="end" fontSize="10" fill="var(--muted)">{yFmt(t)}</text></g>)}
        {R > 20 && ticks(...dom.y2).map((t, i) => <text key={i} x={W - R + 6} y={sy(t, "right") + 4} fontSize="10" fill="var(--muted)">{y2Fmt(t)}</text>)}
        {ticks(x0, x1, 6).map((t, i) => <text key={i} x={sx(t)} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--muted)">{xFmt(t)}</text>)}
        {zeroLine && <line x1={L} x2={W - R} y1={sy(0)} y2={sy(0)} stroke="var(--muted)" strokeWidth="0.8" />}
        {bars.map((s, bi) => s.points.map((p, i) => {
          if (!Number.isFinite(p.y)) return null;
          const k = s.overlay ? 0 : bars.filter((b) => !b.overlay).indexOf(s);
          const n = Math.max(1, bars.filter((b) => !b.overlay).length);
          const cx = sx(p.x) - (n * bw) / 2 + k * bw;
          const y = sy(Math.max(0, p.y), s.axis), y0 = sy(Math.min(0, p.y), s.axis);
          return <rect key={`${bi}-${i}`} x={cx} y={y} width={bw} height={Math.max(0.5, y0 - y)} fill={p.color || s.color} opacity={s.opacity ?? 0.8} />;
        }))}
        {series.filter((s) => s.type !== "bar").map((s, si) => {
          const pts = s.points.filter((p) => Number.isFinite(p.y) && Number.isFinite(p.x));
          return <polyline key={si} fill="none" stroke={s.color} strokeWidth={s.width || 1.8} strokeDasharray={s.dash || undefined} points={pts.map((p) => `${sx(p.x)},${sy(p.y, s.axis)}`).join(" ")} />;
        })}
        {markers.filter((m) => Number.isFinite(m.x)).map((m, i) => <g key={i}><line x1={sx(m.x)} x2={sx(m.x)} y1={T} y2={H - B} stroke={m.color || "var(--muted)"} strokeDasharray="4 3" /><text x={sx(m.x) + 3} y={T + 10 + (i % 3) * 11} fontSize="10" fill={m.color || "var(--muted)"}>{m.label}</text></g>)}
        {hover != null && <line x1={sx(hover)} x2={sx(hover)} y1={T} y2={H - B} stroke="var(--text)" strokeWidth="0.5" />}
        {xLabel && <text x={W - R} y={H - 18} textAnchor="end" fontSize="10" fill="var(--muted)">{xLabel}</text>}
        {yLabel && <text x={L + 4} y={T + 8} fontSize="10" fill="var(--muted)">{yLabel}</text>}
      </svg>
      {hover != null && (
        <div className="tooltip" style={{ position: "absolute", top: 6, right: 8, pointerEvents: "none", fontSize: 12 }}>
          <b>{xFmt(hover)}</b>
          {series.map((s, i) => { const p = s.points.find((q) => q.x === hover); return p ? <div key={i}><span style={{ color: s.color }}>■</span> {s.name}: {s.axis === "right" ? y2Fmt(p.y) : yFmt(p.y)}</div> : null; })}
        </div>
      )}
    </div>
  );
}
