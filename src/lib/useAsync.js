import { useEffect, useState } from "react";
/** Runs an async loader whenever deps change; ignores results of superseded calls. */
export function useAsync(fn, deps) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.resolve().then(fn).then(
      (data) => { if (alive) setState({ loading: false, data, error: null }); },
      (error) => { if (alive) setState({ loading: false, data: null, error }); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}
