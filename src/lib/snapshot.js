// One picture of a whole screen made of several charts (the stacked Analyst screens).
// Each lightweight-chart draws on its own <canvas>, and its labels are plain HTML, so a single
// chart's takeScreenshot() cannot capture the screen. This copies every canvas under `root` onto
// one canvas at its on-screen position, then writes the text labels on top.
// The title line (stock, timeframe, date, source) is always added so a picture is never anonymous.
import { downloadBlob } from "./exporters.js";

const TITLE_H = 28;

/** root: the DOM element holding the charts. title / subtitle: strings drawn above them. Returns a canvas. */
export function captureStack(root, { title = "", subtitle = "", background = "#000000" } = {}) {
  const box = root.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(box.width * dpr));
  out.height = Math.max(1, Math.round((box.height + TITLE_H) * dpr));
  const g = out.getContext("2d");
  g.fillStyle = background; g.fillRect(0, 0, out.width, out.height);
  g.scale(dpr, dpr);

  // title
  g.fillStyle = "#ffffff"; g.font = "600 13px Tahoma, Verdana, sans-serif"; g.textBaseline = "middle";
  g.fillText(title, 8, 10);
  g.fillStyle = "#9aa0a6"; g.font = "10.5px Tahoma, Verdana, sans-serif";
  g.fillText(subtitle, 8, 22);

  const at = (el) => { const r = el.getBoundingClientRect(); return { x: r.left - box.left, y: r.top - box.top + TITLE_H, w: r.width, h: r.height }; };

  // header bars first (they have their own background), then the chart canvases, then the pane labels
  for (const el of root.querySelectorAll(".anl-head")) {
    const p = at(el);
    g.fillStyle = getComputedStyle(el).backgroundColor || "#000"; g.fillRect(p.x, p.y, p.w, p.h);
    g.fillStyle = "#f5f5f5"; g.font = "600 11.5px Tahoma, Verdana, sans-serif"; g.textBaseline = "middle";
    g.save(); g.beginPath(); g.rect(p.x, p.y, p.w, p.h); g.clip(); g.fillText(el.textContent || "", p.x + 6, p.y + p.h / 2); g.restore();
  }
  for (const c of root.querySelectorAll("canvas")) {
    if (!c.width || !c.height) continue;
    const p = at(c);
    try { g.drawImage(c, p.x, p.y, p.w, p.h); } catch { /* a canvas that cannot be read is skipped, never fatal */ }
  }
  g.font = "11px Tahoma, Verdana, sans-serif"; g.fillStyle = "#e5e5e5"; g.textBaseline = "top";
  for (const el of root.querySelectorAll(".anl-label")) { const p = at(el); g.fillText(el.textContent || "", p.x, p.y); }
  return out;
}

export function savePng(canvas, filename) {
  return new Promise((resolve) => canvas.toBlob((b) => { if (b) downloadBlob(b, filename); resolve(!!b); }, "image/png"));
}

/** A4 landscape PDF: the picture scaled to the page, with a footer line. */
export async function savePdf(canvas, filename, { footer = "GQ XRayDar" } = {}) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  const maxW = W - 40, maxH = H - 56;
  const k = Math.min(maxW / canvas.width, maxH / canvas.height);
  doc.addImage(canvas.toDataURL("image/png"), "PNG", 20, 20, canvas.width * k, canvas.height * k);
  doc.setFontSize(8); doc.setTextColor(120); doc.text(footer, 20, H - 14);
  doc.save(filename);
}
