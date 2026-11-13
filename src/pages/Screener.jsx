// Custom screening workflow builder: any combination of fields, timeframes,
// geography and fundamentals, saved and reusable. Also runs natural-language
// queries from the command bar (?q=...) and shows exactly how they were read.
import { useEffect, useMemo, useState } from "react";
import { useData } from "../data/store.jsx";
import { PageHead, Select, Badge, Seg } from "../components/ui.jsx";
import { DataTable } from "../components/DataTable.jsx";
import { ScopeFilter, applyScope, idColumns, fieldColumn } from "../components/pickers.jsx";
import { FIELDS, FIELD, FIELD_GROUPS, OPS, testCondition } from "../../engine/fields.js";
import { parseCommand } from "../../engine/nl.js";
import { usePersistent, uid } from "../lib/storage.js";
import { navigate } from "../lib/router.js";

export const PRESETS = [
  { name: "New 52-week highs on volume", conditions: [{ field: "atHigh52", op: "is true" }, { field: "volRatio", op: ">=", value: 1.5 }] },
  { name: "All-time high breaks", conditions: [{ field: "athBreak", op: "is true" }] },
  { name: "52-week lows", conditions: [{ field: "atLow52", op: "is true" }] },
  { name: "Weekly MMA compression", conditions: [{ field: "compressionW", op: "is true" }] },
  { name: "Post-consolidation MMA break (W)", conditions: [{ field: "postConsBreakW", op: "is true" }] },
  { name: "Bullish weekly alignment, daily just turned", conditions: [{ field: "mmaBullW", op: "is true" }, { field: "mmaNewBullD", op: "is true" }] },
  { name: "Volume-supported breakouts", conditions: [{ field: "breakoutVolume", op: "is true" }] },
  { name: "Accumulation with rising RSC", conditions: [{ field: "accumulation", op: "is true" }, { field: "rscRising_country_W", op: "is true" }] },
  { name: "Rally on falling volume (caution)", conditions: [{ field: "pvDivergence", op: "is", value: "rally_on_falling_volume" }] },
  { name: "Oversold in a weekly uptrend", conditions: [{ field: "rsiD", op: "<", value: 35 }, { field: "mmaBullW", op: "is true" }] },
  { name: "Strong multi-indicator agreement", conditions: [{ field: "agreement", op: "is", value: "strong_bull" }] },
  { name: "Indicator conflict", conditions: [{ field: "agreement", op: "is", value: "conflict" }] },
  { name: "Trend reversal up (weekly)", conditions: [{ field: "reversalUpW", op: "is true" }] },
  { name: "Golden cross (last 3 days)", conditions: [{ field: "goldenCross", op: "is", value: "bull" }] },
  { name: "Improving fundamentals + breakout", conditions: [{ field: "fundImproving", op: "is true" }, { field: "breakoutW", op: "is true" }] },
  { name: "Growth at a reasonable price", conditions: [{ field: "epsGrowthYoY", op: ">", value: 20 }, { field: "pe", op: "<", value: 25 }, { field: "roe", op: ">", value: 15 }] },
  { name: "Liquid large caps (> $50M/day)", conditions: [{ field: "tradedValueUsd", op: ">", value: 5e7 }] },
];

export default function Screener({ route }) {
  const d = useData();
  const [saved, setSaved] = usePersistent("screens", []);
  const [scope, setScope] = useState({});
  const [conds, setConds] = useState([]);
  const [match, setMatch] = useState("all");
  const [sort, setSort] = useState(null);
  const [limit, setLimit] = useState(null);
  const [understood, setUnderstood] = useState(null);
  const [name, setName] = useState("");
  const [extraCols, setExtraCols] = useState([]);

  useEffect(() => {
    const q = route.query.q;
    if (!q) return;
    const c = parseCommand(q, { securities: d.secs, countries: d.countries });
    setConds(c.conditions); setScope({ ...c.scope }); setSort(c.sort); setLimit(c.limit); setUnderstood(c);
  }, [route.query.q, d.secs, d.countries]);

  const rows = useMemo(() => {
    let r = applyScope(d.rows, scope);
    if (conds.length) r = r.filter((x) => (match === "any" ? conds.some((c) => testCondition(x, c)) : conds.every((c) => testCondition(x, c))));
    if (sort) { const f = FIELD[sort.field]; r = [...r].sort((a, b) => { const x = f?.get(a), y = f?.get(b); if (x == null) return 1; if (y == null) return -1; return sort.dir === "desc" ? y - x : x - y; }); }
    if (limit) r = r.slice(0, limit);
    return r;
  }, [d.rows, scope, conds, match, sort, limit]);

  const condFields = [...new Set([...conds.map((c) => c.field), ...extraCols])].filter((k) => FIELD[k] && !["country", "sector", "cap"].includes(k));
  const columns = [...idColumns(["country", "sector", "cap"]), ...condFields.map((k) => fieldColumn(k)), ...(sort && !condFields.includes(sort.field) && FIELD[sort.field] ? [fieldColumn(sort.field)] : []), fieldColumn("ret3M"), fieldColumn("score")];
  const load = (s) => { setConds(s.conditions || []); setScope(s.scope || {}); setMatch(s.match || "all"); setSort(s.sort || null); setLimit(s.limit || null); setUnderstood(null); };

  return (
    <div className="stack">
      <PageHead title="Screener" sub="Build a screen from any combination of technical, relative-strength, volume, fundamental and Weight Watcher fields. Missing data never passes a condition.">
        <Select label="Preset" value="" options={PRESETS.map((p, i) => ({ value: String(i), label: p.name }))} onChange={(v) => v != null && load(PRESETS[+v])} allowEmpty="—" />
        <Select label="Saved" value="" options={saved.map((s) => ({ value: s.id, label: s.name }))} onChange={(v) => { const s = saved.find((x) => x.id === v); if (s) load(s); }} allowEmpty="—" />
      </PageHead>
      {understood && (
        <div className="note">Read "<b>{understood.raw}</b>" as: {understood.understood.length ? understood.understood.map((u) => <Badge key={u} kind="g">{u}</Badge>) : <i>nothing recognised</i>}
          {understood.intent === "unknown" && <span> — try the <a href="#/assistant">assistant</a>.</span>}</div>
      )}
      <div className="card stack" style={{ gap: 8 }}>
        <ScopeFilter scope={scope} onChange={setScope} show={["region", "classification", "country", "sector", "cap"]} />
        {conds.map((c, i) => <ConditionRow key={i} c={c} onChange={(nc) => setConds(conds.map((x, k) => (k === i ? nc : x)))} onRemove={() => setConds(conds.filter((_, k) => k !== i))} />)}
        <div className="row">
          <button className="btn sm" onClick={() => setConds([...conds, { field: "rsiW", op: "<", value: 30 }])}>+ Condition</button>
          <Seg value={match} options={[{ value: "all", label: "Match all" }, { value: "any", label: "Match any" }]} onChange={setMatch} />
          <Select label="Sort" value={sort?.field || ""} options={FIELDS.filter((f) => ["num", "pct", "money"].includes(f.type)).map((f) => ({ value: f.key, label: f.label }))} onChange={(v) => setSort(v ? { field: v, dir: sort?.dir || "desc" } : null)} allowEmpty="—" />
          {sort && <Seg value={sort.dir} options={[{ value: "desc", label: "High→low" }, { value: "asc", label: "Low→high" }]} onChange={(dir) => setSort({ ...sort, dir })} />}
          <label className="lbl-ctl">Limit <input type="number" style={{ width: 70 }} value={limit || ""} onChange={(e) => setLimit(e.target.value ? +e.target.value : null)} /></label>
          <Select label="+ Column" value="" options={FIELDS.filter((f) => !["symbol", "name"].includes(f.key)).map((f) => ({ value: f.key, label: `${f.group}: ${f.label}` }))} onChange={(v) => v && setExtraCols([...extraCols, v])} allowEmpty="—" />
          <span className="grow" style={{ flex: 1 }} />
          <input placeholder="Screen name" value={name} onChange={(e) => setName(e.target.value)} style={{ width: 160 }} />
          <button className="btn sm primary" disabled={!name} onClick={() => { setSaved([...saved, { id: uid(), name, conditions: conds, scope, match, sort, limit }]); setName(""); }}>Save screen</button>
          <button className="btn sm" onClick={() => navigate("alerts", { fromScreen: JSON.stringify({ conditions: conds, scope }) })} disabled={!conds.length}>Make alert</button>
        </div>
      </div>
      <DataTable exportName="screen" rows={rows} columns={columns} initialSort={sort ? null : { key: "score", dir: "desc" }} />
    </div>
  );
}

export function ConditionRow({ c, onChange, onRemove }) {
  const f = FIELD[c.field];
  const ops = OPS[f?.type || "num"];
  return (
    <div className="row">
      <select value={c.field} onChange={(e) => { const nf = FIELD[e.target.value]; onChange({ field: e.target.value, op: OPS[nf.type][0], value: nf.values?.[0] ?? "" }); }} style={{ maxWidth: 340 }}>
        {FIELD_GROUPS.map((g) => <optgroup key={g} label={g}>{FIELDS.filter((x) => x.group === g && !["symbol", "name"].includes(x.key)).map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</optgroup>)}
      </select>
      <select value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value })}>{ops.map((o) => <option key={o}>{o}</option>)}</select>
      {!["is true", "is false", "is set"].includes(c.op) && (f?.values && (c.op === "is" || c.op === "is not")
        ? <select value={c.value} onChange={(e) => onChange({ ...c, value: e.target.value })}>{f.values.map((v) => <option key={v}>{v}</option>)}</select>
        : <input value={c.value ?? ""} onChange={(e) => onChange({ ...c, value: e.target.value })} style={{ width: 120 }} placeholder={c.op === "in" ? "a,b,c" : "value"} />)}
      {c.op === "between" && <input value={c.value2 ?? ""} onChange={(e) => onChange({ ...c, value2: e.target.value })} style={{ width: 90 }} placeholder="and" />}
      <button className="btn sm ghost" onClick={onRemove}>✕</button>
    </div>
  );
}
