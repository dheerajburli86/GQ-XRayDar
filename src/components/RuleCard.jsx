// Rule editor + report card, shared by Alerts (6.5 "how good has this alert
// been?") and Backtest (6.4 "test an idea on past data"). The maths is
// engine/scorecard.js: every past firing, entry at the NEXT candle's close.
import { useState } from "react";
import { useData } from "../data/store.jsx";
import { Select, Seg, Pct, Badge, StockLink } from "./ui.jsx";
import { DataTable } from "./DataTable.jsx";
import { RULES, DEFAULT_PARAMS, describeRule, normalizeParams } from "../../engine/rules.js";
import { ruleScorecard } from "../../engine/scorecard.js";
import { rowRankCmp } from "../../engine/turnover.js";

export const RULE_OPTIONS = Object.entries(RULES).map(([k, r]) => ({ value: k, label: `${r.group}: ${r.label({ ...(DEFAULT_PARAMS[k] || {}) })}` }));
const PARAM_LABEL = { level: "RSI level", period: "Period (candles)", price: "Price", bars: "Look-back (candles)", pct: "Spread %" };

export function RuleEditor({ value, onChange }) {
  const def = RULES[value.rule];
  const params = { ...(DEFAULT_PARAMS[value.rule] || {}), ...(value.params || {}) };
  return (
    <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
      <Select label="Rule" value={value.rule} options={RULE_OPTIONS} onChange={(rule) => onChange({ ...value, rule, params: { ...(DEFAULT_PARAMS[rule] || {}) } })} style={{ maxWidth: 330 }} />
      {Object.keys(def?.params || {}).map((k) => (
        <label key={k} className="lbl-ctl">{PARAM_LABEL[k] || k}
          <input type="number" step="any" value={params[k] ?? ""} style={{ width: 90 }} onChange={(e) => onChange({ ...value, params: { ...params, [k]: e.target.value === "" ? "" : +e.target.value } })} />
        </label>
      ))}
      <Seg value={value.tf || "D"} options={[{ value: "D", label: "Daily" }, { value: "W", label: "Weekly" }, { value: "M", label: "Monthly" }]} onChange={(tf) => onChange({ ...value, tf })} />
    </div>
  );
}

/** Run the card over `ids` (or the largest `sample` stocks in d.rows). */
export function ReportCard({ rule, ids = null, sample = 120, title = "Report card" }) {
  const d = useData();
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(null);
  const norm = normalizeParams(rule.rule, rule.params);
  const run = async () => {
    if (norm.error) return;
    const pick = (ids?.length ? ids : [...d.rows].filter((r) => (r.sec.assetClass || "Stock") === "Stock").sort(rowRankCmp).slice(0, sample).map((r) => r.id)).slice(0, 400);
    const bars = new Map();
    for (let i = 0; i < pick.length; i++) {
      setBusy(`Loading prices ${i + 1} / ${pick.length}…`);
      try { const b = await d.api.bars(pick[i]); if (b) bars.set(pick[i], b); } catch { /* skip one */ }
    }
    setBusy("Replaying the rule…");
    await new Promise((r) => setTimeout(r, 0));
    setRes(ruleScorecard(bars, { rule: rule.rule, params: norm.params, tf: rule.tf || "D", maxTrades: 400, symbolOf: (id) => d.secById.get(id)?.symbol || id }));
    setBusy(null);
  };
  return (
    <div className="card stack">
      <div className="row between">
        <div><h3 style={{ margin: 0 }}>{title}</h3><div className="small muted">{norm.error || `${describeRule(rule.rule, norm.params)} · ${{ D: "daily", W: "weekly", M: "monthly" }[rule.tf || "D"]} · ${ids?.length ? `${ids.length} instrument${ids.length > 1 ? "s" : ""}` : `largest ${sample} stocks`}`}</div></div>
        <button className="btn sm primary" disabled={!!busy || !!norm.error} onClick={run}>{busy ? "Working…" : res ? "Run again" : "Run"}</button>
      </div>
      {busy && <div className="small muted">{busy}</div>}
      {res && (
        <>
          <div className="row">
            <Badge>{res.firings} signals on {res.instrumentsFired} of {res.instrumentsTested} instruments</Badge>
            <Badge kind={res.direction === "up" ? "g" : res.direction === "down" ? "r" : ""}>expected move: {res.direction}</Badge>
          </div>
          <table className="tbl compact"><thead><tr><th>After</th><th className="num">Signals measured</th><th className="num">Average move</th><th className="num">Median move</th><th className="num">Went the expected way</th><th className="num">Best</th><th className="num">Worst</th></tr></thead>
            <tbody>{res.summary.map((s) => <tr key={s.horizon}><td>{s.horizon}</td><td className="num">{s.n}</td><td className="num"><Pct v={s.mean} /></td><td className="num"><Pct v={s.median} /></td><td className="num">{s.hitRate == null ? "n/a" : `${s.hitRate}%`}</td><td className="num"><Pct v={s.best} /></td><td className="num"><Pct v={s.worst} /></td></tr>)}</tbody>
          </table>
          <DataTable compact pageSize={15} exportName={`report_card_${rule.rule}_${rule.tf || "D"}`} rows={res.trades.map((t, i) => ({ ...t, id: `${t.id}|${t.date}|${i}` }))} columns={[
            { key: "date", label: "Signal", value: (t) => t.date },
            { key: "sym", label: "Instrument", value: (t) => t.symbol, render: (t) => <StockLink sec={d.secById.get(t.id.split("|")[0])}>{t.symbol}</StockLink> },
            { key: "entry", label: "Entry (next close)", num: true, value: (t) => t.entry },
            ...Object.keys(res.trades.find((t) => Object.keys(t.ret).length)?.ret || { [res.summary[0].horizon]: 0 }).map((h) => ({ key: h, label: h, num: true, value: (t) => t.ret[h] ?? null, render: (t) => <Pct v={t.ret[h]} /> })),
          ]} />
          <div className="small muted">{res.method} Past behaviour describes the data; it does not predict.</div>
        </>
      )}
    </div>
  );
}
