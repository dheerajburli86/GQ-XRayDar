// Shared pieces of the derivatives pages.
import { useMemo } from "react";
import { useData } from "../../data/store.jsx";
import { useAsync } from "../../lib/useAsync.js";
import { getDerivApi } from "../../data/derivApi.js";
import { fmtPct, signClass } from "../../lib/format.js";
import { NSE_INDEX_UNDERLYINGS } from "../../../engine/deriv/nse.js";
import { confluence } from "../../../engine/deriv/screen.js";
import { Empty, Loading, ErrorBox } from "../../components/ui.jsx";

/** Fractions (0.052) shown as percent. */
export const fp = (v, d = 1) => (v == null || !Number.isFinite(v) ? "—" : fmtPct(v * 100, d));
/** Unsigned shares and probabilities (0.43 -> "43%"). */
export const pc = (v, d = 0) => (v == null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(d)}%`);
export const FP = ({ v, d = 1 }) => <span className={signClass(v)}>{fp(v, d)}</span>;
export const fn = (v, d = 2) => (v == null || !Number.isFinite(v) ? "—" : Math.abs(v) >= 1e7 ? `${(v / 1e7).toFixed(2)} Cr` : Math.abs(v) >= 1e5 ? `${(v / 1e5).toFixed(2)} L` : v.toLocaleString("en-IN", { maximumFractionDigits: d }));
export const fiv = (v) => (v == null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(1)}%`);

/** Security-master record for an F&O underlying (NSE symbol, or the index it tracks). */
export function useUnderlyingSec() {
  const d = useData();
  return useMemo(() => {
    const bySym = new Map();
    for (const s of d.secs || []) {
      if (s.universe === "india_stocks") bySym.set(String(s.symbol).replace(/-(EQ|BE|BZ|ST|SM)$/, ""), s);
      if (s.universe === "india_indices") bySym.set(`IDX:${String(s.symbol).toUpperCase()}`, s);
    }
    return (und, kind) => (kind === "index" ? bySym.get(`IDX:${NSE_INDEX_UNDERLYINGS[und] || und}`) : bySym.get(und)) || null;
  }, [d.secs]);
}

/** Latest summaries joined with the security master and technical screen rows. */
export function useDerivRows() {
  const d = useData();
  const api = getDerivApi();
  const secOf = useUnderlyingSec();
  const st = useAsync(() => api.status(), []);
  const lt = useAsync(() => api.latest(), []);
  const mk = useAsync(() => api.market(), []);
  const rows = useMemo(() => {
    if (!lt.data) return null;
    const m = mk.data?.at(-1);
    const mw = new Map((m?.mwpl || []).map((x) => [x.symbol, x]));
    const ban = new Set(m?.ban || []);
    return lt.data.map((x) => {
      const sec = secOf(x.und, x.kind);
      const tech = sec ? d.rowById.get(sec.id)?.flat || null : null;
      const row = { id: x.und, und: x.und, kind: x.kind, s: x.s, sec, tech, mw: mw.get(x.und) || null, banned: ban.has(x.und) };
      row.conf = confluence(row);
      return row;
    });
  }, [lt.data, mk.data, secOf, d.rowById]);
  return { api, status: st.data, rows, market: mk.data, loading: st.loading || lt.loading, error: st.error || lt.error };
}

/** Banner + guard for pages that need at least one collected session. */
export function DerivGate({ status, loading, error, children }) {
  if (error) return <ErrorBox error={error} />;
  if (loading || !status) return <Loading what="derivatives data" />;
  if (!status.sessions) return <Empty>No F&O sessions are stored yet. The server collects the exchange's end-of-day files automatically (after about 19:30 IST) and back-fills recent sessions on its first runs.</Empty>;
  return children;
}

export function UndSelect({ rows, value, onChange }) {
  const opts = useMemo(() => (rows || []).slice().sort((a, b) => (a.kind === b.kind ? (a.und < b.und ? -1 : 1) : a.kind === "index" ? -1 : 1)), [rows]);
  return (
    <select value={value || ""} onChange={(e) => onChange(e.target.value)}>
      <optgroup label="Indices">{opts.filter((r) => r.kind === "index").map((r) => <option key={r.und} value={r.und}>{r.und}</option>)}</optgroup>
      <optgroup label="Stocks">{opts.filter((r) => r.kind !== "index").map((r) => <option key={r.und} value={r.und}>{r.und}</option>)}</optgroup>
    </select>
  );
}

export const DataNote = ({ status }) => (
  <p className="legend-note">Exchange end-of-day data · latest session <b>{status?.latest || "—"}</b> · {status?.sessions || 0} sessions stored. <b>Fact</b> = published by the exchange (prices, OI, participant OI, ban list). <b>Interpretation</b> = calculated here with stated assumptions (IV, Greeks, build-up, writing / buying, GEX).</p>
);

export const BUILD_BADGE = { long_buildup: "g", short_covering: "g", short_buildup: "r", long_unwinding: "r", neutral: "" };

/** Epistemic tag on every output element: exchange fact, deterministic calculation, or model estimate / forecast. */
const TAG = { fact: ["Exchange fact", "b", "Published by the exchange"], calc: ["Calculation", "", "Deterministic calculation from stored data with stated assumptions"], est: ["Model estimate", "a", "Depends on a model or forecast; treat as an estimate"] };
export const Tag = ({ k = "calc" }) => { const [l, kind, t] = TAG[k] || TAG.calc; return <span className={`badge ${kind}`} title={t} style={{ fontSize: 10, marginLeft: 6 }}>{l}</span>; };
