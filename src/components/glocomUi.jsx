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

/**
 * Name of the rating (owner, Nov 2026): GLOCOM and LOCOM are the same rule sheet; it is called
 * LOCOM when Indian industries / sectors are rated against each other, GLOCOM everywhere else.
 */
export const comName = (market) => (market === "C:India" ? "LOCOM" : "GLOCOM");

/**
 * Category change (owner, Nov 2026): the arrow between the two bands is what carries the colour,
 * green when the band got better, red when it got worse. A rank change inside the same band is shown
 * plainly (#5 → #1) without a "places" count and without colour.
 */
export function BandChange({ prevCode, prevLabel, code, label, small }) {
  const mv = prevCode == null || code == null ? 0 : prevCode - code;
  if (!mv) return <GBadge small={small} code={code} label={label} />;
  const c = mv > 0 ? UP : DOWN;
  return (
    <span style={{ whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 4 }}>
      <GBadge small={small} code={prevCode} label={prevLabel} />
      <b style={{ color: "#fff", background: c, borderRadius: 4, padding: "0 6px", fontSize: small ? 11 : 13, lineHeight: small ? "15px" : "18px" }}>{mv > 0 ? "▲ ➜" : "▼ ➜"}</b>
      <GBadge small={small} code={code} label={label} />
    </span>
  );
}
