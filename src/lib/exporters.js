// CSV and Excel export. Excel uses exceljs, loaded only when an export is asked for.
export function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const esc = (v) => { if (v == null) return ""; const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function toCsv(columns, rows) {
  return [columns.map((c) => esc(c.label)).join(","), ...rows.map((r) => columns.map((c) => esc(c.value(r))).join(","))].join("\n");
}
export function exportCsv(filename, columns, rows) {
  downloadBlob(new Blob([toCsv(columns, rows)], { type: "text/csv;charset=utf-8" }), filename.endsWith(".csv") ? filename : `${filename}.csv`);
}
/** sheets: [{name, columns:[{label, value(r)}], rows, note?}] */
export async function exportXlsx(filename, sheets) {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "GQ AI-Powered Technical Analysis Software";
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31));
    let r0 = 1;
    if (s.note) { ws.getCell(1, 1).value = s.note; ws.getCell(1, 1).font = { italic: true, color: { argb: "FF666666" } }; r0 = 3; }
    s.columns.forEach((c, i) => { const cell = ws.getCell(r0, i + 1); cell.value = c.label; cell.font = { bold: true, color: { argb: "FFFFFFFF" } }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0E7C3A" } }; });
    s.rows.forEach((row, j) => s.columns.forEach((c, i) => { const v = c.value(row); ws.getCell(r0 + 1 + j, i + 1).value = v == null ? null : v; }));
    s.columns.forEach((c, i) => { ws.getColumn(i + 1).width = Math.min(40, Math.max(10, String(c.label).length + 2)); });
    ws.views = [{ state: "frozen", ySplit: r0 }];
  }
  const buf = await wb.xlsx.writeBuffer();
  downloadBlob(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}
