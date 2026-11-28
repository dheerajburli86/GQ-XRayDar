export const fmtNum = (v, d = 2) => (v == null || !Number.isFinite(+v) ? "—" : (+v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
export const fmtPct = (v, d = 1) => (v == null || !Number.isFinite(+v) ? "—" : `${+v > 0 ? "+" : ""}${(+v).toFixed(d)}%`);
export const fmtInt = (v) => (v == null || !Number.isFinite(+v) ? "—" : Math.round(+v).toLocaleString("en-US"));
export function fmtMoney(v, ccy = "USD") {
  if (v == null || !Number.isFinite(+v)) return "—";
  const a = Math.abs(+v);
  const s = a >= 1e12 ? `${(v / 1e12).toFixed(2)}T` : a >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : (+v).toFixed(0);
  return ccy === "USD" ? `$${s}` : `${s} ${ccy}`;
}
export const fmtBool = (v) => (v === true ? "Yes" : v === false ? "No" : "—");
export function fmtField(type, v) {
  if (type === "pct") return fmtPct(v);
  if (type === "money") return fmtMoney(v);
  if (type === "bool") return fmtBool(v);
  if (type === "num") return v == null ? "—" : fmtNum(v, Math.abs(v) >= 1000 ? 0 : 2);
  return v == null || v === "" ? "—" : String(v).replace(/_/g, " ");
}
export const signClass = (v) => (v == null ? "" : v > 0 ? "pos" : v < 0 ? "neg" : "");
export const titleCase = (s) => String(s || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** Rupees in full, never rounded (owner 2026-11-28): Indian digit grouping, paise when present: "₹1,86,05,88,74,88,877.80". */
export function fmtInr(v) {
  if (v == null || !Number.isFinite(+v)) return "—";
  const n = +v;
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;
}
/** A security's market cap for display: rupees only for India (owner 2026-11-28), dollars elsewhere. */
export function fmtCapOf(sec) {
  if (!sec) return "—";
  if (sec.country === "India") return sec.capLocal != null ? fmtInr(sec.capLocal) : "—";
  return fmtMoney(sec.capUsdNow ?? sec.capUsd);
}
