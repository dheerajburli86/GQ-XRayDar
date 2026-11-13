// Theme: "dark", "light" or "system" (follows the device setting live).
export const resolveTheme = (t) => (t === "system" ? (window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark") : t === "light" ? "light" : "dark");
export function watchSystemTheme(onChange) {
  const mq = window.matchMedia?.("(prefers-color-scheme: light)");
  if (!mq) return () => {};
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
