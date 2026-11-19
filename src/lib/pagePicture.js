// A picture of whatever is on screen (owner: chart downloads on every screen). The page is
// rendered with html2canvas (it copies chart canvases too), a title line is added on top, and
// the result is saved as PNG or as an A4 landscape PDF.
import { savePng, savePdf } from "./snapshot.js";

export async function pagePicture(el, { title = document.title, subtitle = "" } = {}) {
  const { default: html2canvas } = await import("html2canvas");
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#ffffff";
  const fg = getComputedStyle(document.documentElement).getPropertyValue("--text").trim() || "#000000";
  const shot = await html2canvas(el, { backgroundColor: bg, scale: Math.min(2, window.devicePixelRatio || 1), useCORS: true, logging: false,
    ignoreElements: (n) => n.hasAttribute?.("data-html2canvas-ignore") });
  const k = shot.width / Math.max(1, el.getBoundingClientRect().width);
  const head = Math.round(32 * k);
  const out = document.createElement("canvas");
  out.width = shot.width; out.height = shot.height + head;
  const g = out.getContext("2d");
  g.fillStyle = bg; g.fillRect(0, 0, out.width, out.height);
  g.fillStyle = fg; g.font = `600 ${Math.round(13 * k)}px sans-serif`; g.textBaseline = "middle";
  g.fillText(title, 8 * k, 11 * k);
  g.globalAlpha = 0.7; g.font = `${Math.round(10.5 * k)}px sans-serif`; g.fillText(subtitle, 8 * k, 24 * k); g.globalAlpha = 1;
  g.drawImage(shot, 0, head);
  return out;
}

export async function downloadPage(el, kind, { name = "gq_xraydar", title, subtitle } = {}) {
  const c = await pagePicture(el, { title, subtitle });
  const file = `${name.replace(/[^\w.-]+/g, "_").slice(0, 60)}_${new Date().toISOString().slice(0, 10)}`;
  if (kind === "pdf") await savePdf(c, `${file}.pdf`, { footer: title || "GQ XRayDar" });
  else await savePng(c, `${file}.png`);
}
