// Sortable, paginated table with CSV / Excel export of exactly what is shown.
import { useMemo, useState } from "react";
import { exportCsv, exportXlsx } from "../lib/exporters.js";

/**
 * columns: [{ key, label, value: (r) => raw, render?: (r) => node, num?: bool, title? }]
 */
export function DataTable({ columns, rows, pageSize = 50, initialSort = null, exportName = "export", onRowClick, selectedId, rowKey = (r) => r.id, maxHeight = 620, compact, toolbar }) {
  const [sort, setSort] = useState(initialSort);
  const [page, setPage] = useState(0);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = col.value(a), y = col.value(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1; if (y == null) return -1;
      if (typeof x === "number" && typeof y === "number") return (x - y) * dir;
      if (typeof x === "boolean") return ((x ? 1 : 0) - (y ? 1 : 0)) * dir;
      return String(x).localeCompare(String(y)) * dir;
    });
  }, [rows, sort, columns]);
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const p = Math.min(page, pages - 1);
  const view = sorted.slice(p * pageSize, (p + 1) * pageSize);
  const toggle = (key) => setSort((s) => (s?.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));
  const expCols = columns.filter((c) => c.export !== false).map((c) => ({ label: c.label, value: c.value }));
  return (
    <div>
      <div className="tbl-foot">
        <div className="row">{toolbar}<span>{rows.length.toLocaleString()} rows</span></div>
        <div className="row">
          <button className="btn sm" onClick={() => exportCsv(exportName, expCols, sorted)}>CSV</button>
          <button className="btn sm" onClick={() => exportXlsx(exportName, [{ name: exportName, columns: expCols, rows: sorted }])}>Excel</button>
        </div>
      </div>
      <div className="tbl-wrap" style={{ maxHeight }}>
        <table className="tbl" style={compact ? { fontSize: 12 } : null}>
          <thead><tr>{columns.map((c) => (
            <th key={c.key} className={c.num ? "num" : ""} onClick={() => toggle(c.key)} title={c.title || ""}>
              {c.label}{sort?.key === c.key ? (sort.dir === "desc" ? " ▾" : " ▴") : ""}
            </th>))}</tr></thead>
          <tbody>
            {view.map((r) => (
              <tr key={rowKey(r)} className={selectedId != null && rowKey(r) === selectedId ? "sel" : ""} onClick={onRowClick ? () => onRowClick(r) : undefined} style={onRowClick ? { cursor: "pointer" } : null}>
                {columns.map((c) => <td key={c.key} className={c.num ? "num mono" : ""}>{c.render ? c.render(r) : fmt(c.value(r))}</td>)}
              </tr>
            ))}
            {!view.length && <tr><td colSpan={columns.length} className="muted" style={{ textAlign: "center", padding: 20 }}>No rows</td></tr>}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="tbl-foot">
          <span>Page {p + 1} of {pages}</span>
          <div className="row">
            <button className="btn sm" disabled={p === 0} onClick={() => setPage(0)}>«</button>
            <button className="btn sm" disabled={p === 0} onClick={() => setPage(p - 1)}>‹</button>
            <button className="btn sm" disabled={p >= pages - 1} onClick={() => setPage(p + 1)}>›</button>
            <button className="btn sm" disabled={p >= pages - 1} onClick={() => setPage(pages - 1)}>»</button>
          </div>
        </div>
      )}
    </div>
  );
}
const fmt = (v) => (v == null ? "—" : typeof v === "number" ? (Number.isInteger(v) ? v.toLocaleString() : v.toFixed(2)) : typeof v === "boolean" ? (v ? "Yes" : "No") : String(v));
