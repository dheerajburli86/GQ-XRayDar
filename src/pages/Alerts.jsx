// Multi-condition alerts: RSC+MMA, WW+RSC, 52-week high+volume, sector
// RSC+EWCW, fundamental+breakout, plus any saved screen. Evaluated on every
// data load; each (rule, instrument, date) enters the inbox once.
import { useEffect, useMemo, useState } from "react";
import { useData } from "../data/store.jsx";
import { PageHead, Badge, Select, StockLink, Check } from "../components/ui.jsx";
import { DataTable } from "../components/DataTable.jsx";
import { ALERT_TEMPLATES, evaluateAlerts, templateById } from "../../engine/alerts.js";
import { usePersistent, uid } from "../lib/storage.js";
import { ConditionRow } from "./Screener.jsx";

export default function Alerts({ route }) {
  const d = useData();
  const [rules, setRules] = usePersistent("alerts.rules", ALERT_TEMPLATES.map((t) => ({ id: t.id, name: t.name, template: t.id, universe: {}, enabled: true })));
  const [inbox, setInbox] = usePersistent("alerts.inbox", []);
  const [wls] = usePersistent("watchlists", {});
  const [sectorCtx, setSectorCtx] = useState(null);
  const needSector = rules.some((r) => r.enabled && r.template === "sector_rsc_ewcw");

  useEffect(() => {
    if (!needSector) return;
    let alive = true;
    (async () => {
      const scopes = await d.api.rotationScopes();
      const rotation = {};
      for (const s of scopes) rotation[s] = await d.api.rotation(s);
      const ewcw = await d.api.ewcw();
      if (alive) setSectorCtx({ rotation, ewcw });
    })();
    return () => { alive = false; };
  }, [needSector, d.api]);

  // a screen sent here from the screener becomes a custom rule
  useEffect(() => {
    if (!route.query.fromScreen) return;
    try {
      const s = JSON.parse(route.query.fromScreen);
      setRules((rs) => [...rs, { id: uid(), name: `Screen: ${s.conditions.map((c) => c.field).join(" + ")}`, template: "custom", conditions: s.conditions, universe: s.scope || {}, enabled: true }]);
    } catch { /* malformed link */ }
    window.location.hash = "#/alerts";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.query.fromScreen]);

  const matches = useMemo(() => evaluateAlerts(rules, d.rows, wls, sectorCtx, d.info.asOf), [rules, d.rows, wls, sectorCtx, d.info.asOf]);
  useEffect(() => {
    const seen = new Set(inbox.map((x) => x.key));
    const fresh = matches.filter((m) => !seen.has(m.key)).map((m) => ({ ...m, firstSeen: new Date().toISOString(), read: false }));
    if (fresh.length) {
      setInbox([...fresh, ...inbox].slice(0, 2000));
      if (typeof Notification !== "undefined" && Notification.permission === "granted" && fresh.length) new Notification("GQ Technical Analysis", { body: `${fresh.length} new alert${fresh.length > 1 ? "s" : ""}` });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches]);

  const update = (id, patch) => setRules(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const unread = inbox.filter((x) => !x.read).length;
  return (
    <div className="stack">
      <PageHead title="Alerts" sub={`Evaluated against the data as of ${d.info.asOf}. Delivery is in-app (and browser notifications if allowed); Telegram and the GQ agent plug into the same rules later.`}>
        {typeof Notification !== "undefined" && Notification.permission !== "granted" && <button className="btn sm" onClick={() => Notification.requestPermission()}>Enable browser notifications</button>}
        <button className="btn sm" onClick={() => setRules([...rules, { id: uid(), name: "Custom rule", template: "custom", conditions: [{ field: "rscTurnUp_country_W", op: "is true" }], universe: {}, enabled: true }])}>+ Custom rule</button>
      </PageHead>
      <div className="grid g2">
        <div className="stack">
          {rules.map((r) => {
            const t = templateById(r.template);
            const n = matches.filter((m) => m.ruleId === r.id).length;
            return (
              <div key={r.id} className="card">
                <div className="row between">
                  <Check checked={r.enabled} onChange={(v) => update(r.id, { enabled: v })}><b>{r.name}</b></Check>
                  <div className="row"><Badge kind={n ? "g" : ""}>{n} matching now</Badge><button className="btn sm ghost" onClick={() => setRules(rules.filter((x) => x.id !== r.id))}>✕</button></div>
                </div>
                <div className="small muted">{t?.desc || "Custom conditions"}</div>
                {r.template === "custom" && <div className="stack" style={{ gap: 4, marginTop: 6 }}>
                  <input value={r.name} onChange={(e) => update(r.id, { name: e.target.value })} />
                  {(r.conditions || []).map((c, i) => <ConditionRow key={i} c={c} onChange={(nc) => update(r.id, { conditions: r.conditions.map((x, k) => (k === i ? nc : x)) })} onRemove={() => update(r.id, { conditions: r.conditions.filter((_, k) => k !== i) })} />)}
                  <button className="btn sm" onClick={() => update(r.id, { conditions: [...(r.conditions || []), { field: "mmaBullW", op: "is true" }] })}>+ condition</button>
                </div>}
                {r.template !== "sector_rsc_ewcw" && <div className="row" style={{ marginTop: 6 }}>
                  <Select label="Watchlist" value={r.universe?.watchlistIds?.[0]} options={Object.entries(wls).map(([k, v]) => ({ value: k, label: v.name }))} onChange={(v) => update(r.id, { universe: { ...r.universe, watchlistIds: v ? [v] : [] } })} allowEmpty="Whole market" />
                  <Select label="Country" value={r.universe?.country} options={d.countries} onChange={(v) => update(r.id, { universe: { ...r.universe, country: v } })} allowEmpty />
                  <Select label="Sector" value={r.universe?.sector} options={d.sectors} onChange={(v) => update(r.id, { universe: { ...r.universe, sector: v } })} allowEmpty />
                </div>}
              </div>);
          })}
        </div>
        <div className="card">
          <div className="row between"><h3>Inbox ({unread} unread)</h3><div className="row"><button className="btn sm" onClick={() => setInbox(inbox.map((x) => ({ ...x, read: true })))}>Mark all read</button><button className="btn sm" onClick={() => setInbox([])}>Clear</button></div></div>
          <DataTable compact exportName="alerts" pageSize={25} rowKey={(x) => x.key} rows={inbox}
            columns={[{ key: "d", label: "As of", value: (x) => x.asOf }, { key: "r", label: "Rule", value: (x) => rules.find((r) => r.id === x.ruleId)?.name || x.ruleId },
              { key: "s", label: "Instrument", value: (x) => x.symbol, render: (x) => (x.id ? <StockLink sec={d.secById.get(x.id)} /> : <b>{x.symbol}</b>) },
              { key: "det", label: "Detail", value: (x) => x.detail }, { key: "n", label: "", value: (x) => (x.read ? "" : "new"), render: (x) => (x.read ? "" : <Badge kind="g">new</Badge>) }]} />
        </div>
      </div>
    </div>
  );
}
