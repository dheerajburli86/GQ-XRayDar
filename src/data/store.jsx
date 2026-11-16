// App-wide data: security master, screen rows, index catalogue and regimes,
// loaded once from whichever data source is configured, plus user settings.
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { getApi, onProgress, DATA_SOURCE } from "./api.js";
import { decodeFlat } from "../../engine/screenRow.js";
import { usePersistent } from "../lib/storage.js";
import { METHODOLOGY } from "../../engine/methodology.js";
import { clearSeriesCache } from "../lib/series.js";
import { idbGet, idbSet } from "../lib/idbCache.js";

const Ctx = createContext(null);
export const useData = () => useContext(Ctx);

export const DEFAULT_SETTINGS = {
  theme: "dark", ccy: "USD", family: "CW", relative: false, horizon: "3M", tf: "W", capFilter: "All",
  benchmark: "country", scoreWeights: METHODOLOGY.scoring.weights,
};

export function DataProvider({ children }) {
  const api = getApi();
  const [state, setState] = useState({ phase: "loading", progress: null, error: null });
  const [base, setBase] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [settings, setSettings] = usePersistent("settings", DEFAULT_SETTINGS);
  const s = useMemo(() => ({ ...DEFAULT_SETTINGS, ...settings }), [settings]);

  useEffect(() => onProgress((p) => setState((x) => ({ ...x, progress: p }))), []);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (reloadKey) { await api.clearCache?.(); clearSeriesCache(); }
        const info = await api.info();
        // the startup tables only change when the engine finishes a new run, so they are cached per run
        const ck = DATA_SOURCE === "supabase" && info.run?.runId ? `bundle:${info.run.runId}:${info.run.finished || ""}` : null;
        let bundle = ck && !reloadKey ? await idbGet(ck) : null;
        if (!bundle) {
          const [secs, srows, idx, regimes] = await Promise.all([api.securities(), api.screenRows(), api.indexList(), api.regimes()]);
          bundle = { secs, srows, idx, regimes };
          if (ck) idbSet(ck, bundle);
        }
        const { secs, srows, idx, regimes } = bundle;
        if (!alive) return;
        const secById = new Map(secs.map((x) => [x.id, x]));
        const keys = info.screenKeys;
        const rows = [];
        for (const r of srows) {
          const sec = secById.get(r.id);
          if (!sec || !r.flat) continue;
          rows.push({ id: r.id, sec, flat: decodeFlat(r.flat, keys), rsRank: r.rsRank });
        }
        const indexByKey = new Map(idx.map((m) => [m.key, m]));
        const countries = [...new Set(secs.map((x) => x.country).filter(Boolean))].sort();
        const regions = [...new Set(secs.map((x) => x.region).filter(Boolean))].sort();
        const classifications = [...new Set(secs.map((x) => x.classification).filter(Boolean))].sort();
        const sectors = [...new Set(secs.map((x) => x.sector).filter((v) => v && v !== "Others"))].sort();
        setBase({ info, secs, secById, rows, rowById: new Map(rows.map((r) => [r.id, r])), indices: idx, indexByKey, regimes, countries, regions, classifications, sectors });
        setState({ phase: "ready", progress: null, error: null });
      } catch (e) {
        if (alive) setState({ phase: "error", progress: null, error: e });
      }
    })();
    return () => { alive = false; };
  }, [api, reloadKey]);

  // composite score under the user's weights (components are stored per row)
  const rows = useMemo(() => {
    if (!base) return [];
    const w = s.scoreWeights;
    const def = METHODOLOGY.scoring.weights;
    const same = Object.keys(def).every((k) => (w[k] ?? def[k]) === def[k]);
    if (same) return base.rows;
    return base.rows.map((r) => {
      let tot = 0, ws = 0;
      for (const k of ["technical", "relative", "participation", "fundamentals", "timeframe"]) {
        const v = r.flat[`score_${k}`];
        if (v == null) continue;
        tot += (w[k] || 0) * v; ws += w[k] || 0;
      }
      return { ...r, flat: { ...r.flat, score: ws ? Math.round(tot / ws) : null } };
    });
  }, [base, s.scoreWeights]);

  const value = useMemo(() => ({
    api, mode: DATA_SOURCE, state, ...(base || {}), rows, settings: s,
    reload: () => setReloadKey((k) => k + 1),
    setSetting: (k, v) => setSettings((old) => ({ ...DEFAULT_SETTINGS, ...old, [k]: v })),
  }), [api, state, base, rows, s, setSettings]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
