// GLOCOM band badge and rank-move marker, shared by the GLOCOM page, stock page and screens.
import { glocomBand } from "../../engine/glocom.js";

export const UP = "#16a34a", DOWN = "#dc2626";

export function GBadge({ code, label, small }) {
  if (!label) return <span className="muted">—</span>;
  const b = glocomBand(code);
  return <span style={{ background: b.bg, color: b.fg, borderRadius: 4, padding: small ? "0 5px" : "1px 7px", fontSize: small ? 10 : 11, fontWeight: 700, whiteSpace: "nowrap" }}>{label}</span>;
}

export function Jump({ v, unit = "" }) {
  if (v == null) return <span className="muted">new</span>;
  if (!v) return <span className="muted">—</span>;
  return <b style={{ color: v > 0 ? UP : DOWN, whiteSpace: "nowrap" }}>{v > 0 ? "▲" : "▼"} {Math.abs(v)}{unit}</b>;
}
