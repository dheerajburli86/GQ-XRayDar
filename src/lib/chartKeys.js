// Keyboard on chart screens (owner, improvements 2 and 9):
//   D W M Q H Y   period: daily, weekly, monthly, quarterly, half-yearly, yearly
//   C             change the instrument (opens the ticker search)
//   any other letter or digit opens the ticker search with that character typed
// Ignored while typing in a box, and with Ctrl / Cmd / Alt held.
import { useEffect, useRef } from "react";

export const TF_KEYS = { D: "D", W: "W", M: "M", Q: "Q", H: "H", Y: "Y" };

export function useChartKeys({ onTf, onSearch, enabled = true }) {
  const ref = useRef({ onTf, onSearch });
  useEffect(() => { ref.current = { onTf, onSearch }; });
  useEffect(() => {
    if (!enabled) return undefined;
    const h = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const el = document.activeElement;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(el?.tagName || "") || el?.isContentEditable) return;
      if (document.querySelector(".qt-backdrop")) return; // the popup is open and handles its own keys
      const k = e.key.length === 1 ? e.key.toUpperCase() : "";
      if (!k) return;
      if (TF_KEYS[k] && ref.current.onTf) { e.preventDefault(); ref.current.onTf(TF_KEYS[k]); return; }
      if (!ref.current.onSearch) return;
      if (k === "C") { e.preventDefault(); ref.current.onSearch(""); return; }
      if (/^[A-Z0-9^]$/.test(k)) { e.preventDefault(); ref.current.onSearch(e.key); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [enabled]);
}
