import { useEffect, useState } from "react";
/** Runs an async loader whenever deps change; ignores results of superseded calls. */
export function useAsync(fn, deps) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.resolve().then(fn).then(
      (data) => { if (alive) setState({ loading: false, data, error: null }); },
      (error) => {
        if (!alive) return;
        setState({ loading: false, data: null, error });
        // pages that do not show their own error still tell the user (banner with Retry in the shell)
        console.warn("[load]", error);
        try { window.dispatchEvent(new CustomEvent("gqta-load-error", { detail: String(error?.message || error) })); } catch { /* no window */ }
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}
