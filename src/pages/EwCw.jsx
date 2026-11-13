// EWCW: equal-weight vs cap-weight relative strength across the hierarchy.
// Ratio = EW level / CW level x 100 for the SAME scope and currency. Rising =
// the average constituent is beating the cap-weighted leaders (broad
// participation); falling = a few large caps are carrying the index.
import { useMemo, useState } from "react";
import { useData } from "../data/store.jsx";
import { useAsync } from "../lib/useAsync.js";
import { navigate } from "../lib/router.js";
import { PageHead, Select, Badge, Pct, Loading } from "../components/ui.jsx";
import { DataTable } from "../components/DataTable.jsx";
import { TvChart, lineData } from "../components/TvChart.jsx";
import { ewcw } from "../../engine/analytics.js";
import { LEVEL_LABEL } from "../../engine/indexEngine.js";

export default function EwCw({ route }) {
  const d = useData();
  const [lvl, setLvl] = useState("");
  const [ccy, setCcy] = useState("USD");
  const sel = route.query.pair || "USD|G";
  const { data: rows, loading } = useAsync(() => d.api.ewcw(), []);
  const [ccySel, ...rest] = sel.split("|");
  const scope = rest.join("|");
  const { data: pair } = useAsync(async () => {
    const [ew, cw] = await Promise.all([d.api.indexSeries(`EW|${ccySel}|${scope}`), d.api.indexSeries(`CW|${ccySel}|${scope}`)]);
    return ew && cw ? { ...ewcw(ew, cw), ew, cw } : null;
  }, [sel]);
  const list = useMemo(() => (rows || []).filter((r) => (!lvl || r.level === lvl) && (!ccy || r.ccy === ccy)), [rows, lvl, ccy]);
  if (loading) return <Loading />;
  const sm = pair?.summary;
  return (
    <div className="stack">
      <PageHead title="EW vs CW relative strength (EWCW)" sub="Participation across the hierarchy: the equal-weighted index against its cap-weighted twin with identical constituents.">
        <Select label="Currency" value={ccy} options={[{ value: "USD", label: "USD" }, { value: "LCL", label: "Local" }]} onChange={(v) => setCcy(v || "")} allowEmpty="Both" />
        <Select label="Level" value={lvl} options={Object.entries(LEVEL_LABEL).map(([v, l]) => ({ value: v, label: l }))} onChange={(v) => setLvl(v || "")} allowEmpty />
      </PageHead>
      {pair && <div className="card tight">
        <div className="row between" style={{ padding: "2px 6px 6px" }}>
          <b>{rows?.find((r) => r.pairKey === sel)?.name || scope} — EW/CW ratio ({ccySel})</b>
          {sm && <div className="row"><Badge kind={sm.label.startsWith("Broad") ? "g" : sm.label.startsWith("Narrow") ? "r" : ""}>{sm.label}</Badge><span className="small">1M <Pct v={sm.chg["1M"]} /> · 3M <Pct v={sm.chg["3M"]} /> · 12M <Pct v={sm.chg["12M"]} /></span></div>}
        </div>
        <TvChart height={300} series={[{ id: "r", type: "line", data: lineData(pair.dates, pair.ratio), options: { color: "#14a44d", lineWidth: 2, title: "EW/CW" }, priceLines: [{ price: 100, color: "#888", title: "base" }] }]} />
      </div>}
      <DataTable exportName="ewcw" rows={list} rowKey={(r) => r.pairKey} selectedId={sel} onRowClick={(r) => navigate("ewcw", { pair: r.pairKey })} initialSort={{ key: "c3", dir: "desc" }}
        columns={[{ key: "name", label: "Scope", value: (r) => r.name }, { key: "lvl", label: "Level", value: (r) => LEVEL_LABEL[r.level] || r.level }, { key: "ccy", label: "Ccy", value: (r) => r.ccy },
          { key: "ratio", label: "EW/CW", num: true, value: (r) => r.ratio },
          ...["1M", "3M", "6M", "12M"].map((h) => ({ key: `c${h.replace("M", "")}`, label: `Δ ${h}`, num: true, value: (r) => r.chg?.[h], render: (r) => <Pct v={r.chg?.[h]} /> })),
          { key: "label", label: "Reading", value: (r) => r.label, render: (r) => <Badge kind={r.label.startsWith("Broad") ? "g" : r.label.startsWith("Narrow") ? "r" : ""}>{r.label}</Badge> }]} />
    </div>
  );
}
