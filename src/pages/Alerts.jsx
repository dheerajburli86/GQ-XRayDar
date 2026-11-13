// Alerts.
//   Indicator alerts (3.1-3.18)  one rule (RSI, MACD, averages, price, golden /
//                                death cross, Bollinger, new high / low, squeeze)
//                                on a stock or a whole watchlist, daily / weekly /
//                                monthly, pause / resume. Fires once per candle.
//   Combination alerts           RSC+MMA, WW+RSC, 52W high+volume, sector
//                                RSC+EWCW, fundamentals+breakout, any screen.
//   Telegram & summaries (3.19, 3.20) and the report card (6.5).
// The same rule list lives in the account, so the server delivers it on
// Telegram (and phone pop-ups) when connected; this page also previews it.
import { useEffect, useMemo, useState } from "react";
import { useData } from "../data/store.jsx";
import { PageHead, Badge, Select, StockLink, Check, Tabs } from "../components/ui.jsx";
import { DataTable } from "../components/DataTable.jsx";
import { InstrumentPicker } from "../components/pickers.jsx";
import { ALERT_TEMPLATES, evaluateAlerts, templateById } from "../../engine/alerts.js";
import { RULES, describeRule, evaluateRule, normalizeParams } from "../../engine/rules.js";
import { usePersistent, uid } from "../lib/storage.js";
import { ConditionRow } from "./Screener.jsx";
import { RuleEditor, ReportCard } from "../components/RuleCard.jsx";
import { useAccount } from "../components/Account.jsx";
import { api } from "../lib/server.js";
import { enablePush, pushSupported, isIos, isStandalone } from "../lib/push.js";

const TFL = { D: "daily", W: "weekly", M: "monthly" };

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
  const [tab, setTab] = useState(route.query.tab || "indicator");
  const acct = useAccount();
  const indicatorRules = rules.filter((r) => r.kind === "indicator");
  const comboRules = rules.filter((r) => r.kind !== "indicator");
  return (
    <div className="stack">
      <PageHead title="Alerts" sub={`Data as of ${d.info.asOf}. ${acct.serverOn ? (acct.me?.telegramLinked ? `Delivered on Telegram${acct.me.telegramName ? ` to ${acct.me.telegramName}` : ""} and in this inbox.` : "Link Telegram (Telegram & summaries tab) to get alerts as messages.") : "Previewed in this app; Telegram delivery needs the TA server connected."}`}>
        {acct.serverOn && acct.me && <button className="btn sm" onClick={async () => { const paused = !acct.me.settings?.alertsPaused; await api("PATCH", "/api/settings", { alertsPaused: paused }); acct.refreshMe(); }}>{acct.me.settings?.alertsPaused ? "▶ Resume all alerts" : "⏸ Pause all alerts"}</button>}
        {tab === "combo" && <button className="btn sm" onClick={() => setRules([...rules, { id: uid(), name: "Custom rule", template: "custom", conditions: [{ field: "rscTurnUp_country_W", op: "is true" }], universe: {}, enabled: true }])}>+ Custom rule</button>}
      </PageHead>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "indicator", label: `Indicator alerts (${indicatorRules.length})` }, { value: "combo", label: `Combination alerts (${comboRules.length})` }, { value: "inbox", label: `Inbox${unread ? ` (${unread})` : ""}` }, { value: "telegram", label: "Telegram & summaries" }, { value: "card", label: "Report card" }]} />
      {tab === "indicator" && <IndicatorAlerts rules={indicatorRules} all={rules} setRules={setRules} wls={wls} />}
      {tab === "telegram" && <TelegramPanel />}
      {tab === "card" && <CardTab wls={wls} rules={indicatorRules} />}
      {tab === "combo" && <div className="grid g2">
        <div className="stack">
          {comboRules.map((r) => {
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
        <div className="card small muted">Combination alerts fire when ALL their conditions hold on the latest data; the first time each (rule, instrument, date) matches it enters the inbox (and, when Telegram is linked, is sent there). A rule that already matches when you create it is recorded quietly on the server, so you only hear about new matches.</div>
      </div>}
      {tab === "inbox" && <div className="stack">
        {acct.serverOn && acct.me && <ServerEvents />}
        <div className="card">
          <div className="row between"><h3>Inbox ({unread} unread)</h3><div className="row"><button className="btn sm" onClick={() => setInbox(inbox.map((x) => ({ ...x, read: true })))}>Mark all read</button><button className="btn sm" onClick={() => setInbox([])}>Clear</button></div></div>
          <DataTable compact exportName="alerts" pageSize={25} rowKey={(x) => x.key} rows={inbox}
            columns={[{ key: "d", label: "As of", value: (x) => x.asOf }, { key: "r", label: "Rule", value: (x) => rules.find((r) => r.id === x.ruleId)?.name || x.ruleId },
              { key: "s", label: "Instrument", value: (x) => x.symbol, render: (x) => (x.id ? <StockLink sec={d.secById.get(x.id)} /> : <b>{x.symbol}</b>) },
              { key: "det", label: "Detail", value: (x) => x.detail }, { key: "n", label: "", value: (x) => (x.read ? "" : "new"), render: (x) => (x.read ? "" : <Badge kind="g">new</Badge>) }]} />
        </div>
      </div>}
    </div>
  );
}

function IndicatorAlerts({ rules, all, setRules, wls }) {
  const d = useData();
  const [draft, setDraft] = useState({ rule: "rsi_cross_above", params: { level: 70 }, tf: "D", target: "stock", inst: null, wl: null });
  const [check, setCheck] = useState({});
  const [busy, setBusy] = useState(false);
  const norm = normalizeParams(draft.rule, draft.params);
  const canAdd = !norm.error && (draft.target === "stock" ? draft.inst : draft.wl);
  const add = () => {
    const target = draft.target === "stock" ? { instrumentId: draft.inst.id, symbol: d.secById.get(draft.inst.id)?.symbol } : { watchlistId: draft.wl, watchlistName: wls[draft.wl]?.name };
    const r = { id: uid(), kind: "indicator", rule: draft.rule, params: norm.params, tf: draft.tf, target, enabled: true, createdAt: new Date().toISOString(), source: "web" };
    r.name = `${target.symbol || target.watchlistName}: ${describeRule(r.rule, r.params)} (${r.tf})`;
    setRules([...all, r]);
  };
  const ids = (r) => (r.target?.instrumentId ? [r.target.instrumentId] : wls[r.target?.watchlistId]?.ids || []);
  const checkNow = async () => {
    setBusy(true);
    const out = {};
    const cache = new Map();
    for (const r of rules) {
      const res = [];
      for (const id of ids(r).slice(0, 200)) {
        if (!cache.has(id)) { try { cache.set(id, await d.api.bars(id)); } catch { cache.set(id, null); } }
        const b = cache.get(id);
        if (!b) continue;
        const e = evaluateRule(r.rule, r.params, b, r.tf);
        if (e.ok) res.push({ id, ...e });
      }
      out[r.id] = res;
    }
    setCheck(out); setBusy(false);
  };
  const toggle = (id, enabled) => setRules(all.map((x) => (x.id === id ? { ...x, enabled } : x)));
  return (
    <div className="stack">
      <div className="card stack">
        <h3 style={{ margin: 0 }}>New indicator alert</h3>
        <RuleEditor value={draft} onChange={(v) => setDraft({ ...draft, ...v })} />
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          <Select label="On" value={draft.target} options={[{ value: "stock", label: "One stock" }, { value: "wl", label: "A whole watchlist" }]} onChange={(target) => setDraft({ ...draft, target })} />
          {draft.target === "stock" ? <InstrumentPicker allowIndex={false} value={draft.inst} onChange={(inst) => setDraft({ ...draft, inst })} width={260} />
            : <Select value={draft.wl} options={Object.entries(wls).map(([k, v]) => ({ value: k, label: `${v.name} (${v.ids.length})` }))} onChange={(wl) => setDraft({ ...draft, wl })} allowEmpty="Pick a watchlist" />}
          <button className="btn primary sm" disabled={!canAdd} onClick={add}>Add alert</button>
          {norm.error && <span className="small neg">{norm.error}</span>}
        </div>
        <div className="small muted">An alert fires once, on the candle where the condition becomes true (e.g. the day RSI crosses 70), not every day it stays true. A watchlist alert covers every stock in the list, including ones you add later.</div>
      </div>
      <div className="card">
        <div className="row between"><h3 style={{ margin: 0 }}>Your indicator alerts</h3><button className="btn sm" disabled={busy || !rules.length} onClick={checkNow}>{busy ? "Checking…" : "Check now"}</button></div>
        {!rules.length ? <div className="small muted">None yet. You can also ask the GQ Agent on Telegram: "alert me when TCS weekly RSI crosses above 60".</div> : (
          <table className="tbl"><thead><tr><th>On</th><th>Alert</th><th>Applies to</th><th>Candles</th><th>Now</th><th></th></tr></thead><tbody>
            {rules.map((r) => {
              const c = check[r.id];
              const fired = c?.filter((x) => x.fired) || [], holding = c?.filter((x) => x.state) || [];
              return (
                <tr key={r.id} style={{ opacity: r.enabled === false ? 0.55 : 1 }}>
                  <td><Check checked={r.enabled !== false} onChange={(v) => toggle(r.id, v)} /></td>
                  <td>{RULES[r.rule] ? describeRule(r.rule, r.params) : r.rule}{r.source === "telegram" && <Badge>from Telegram</Badge>}</td>
                  <td>{r.target?.instrumentId ? <StockLink sec={d.secById.get(r.target.instrumentId)} /> : <span>☰ {wls[r.target?.watchlistId]?.name || r.target?.watchlistName || "deleted list"} ({ids(r).length})</span>}</td>
                  <td>{TFL[r.tf || "D"]}</td>
                  <td className="small">{!c ? <span className="muted">—</span> : fired.length ? <span className="pos">fired on the latest candle: {fired.map((x) => d.secById.get(x.id)?.symbol).join(", ")}</span> : holding.length ? <span>condition true for {holding.map((x) => d.secById.get(x.id)?.symbol).slice(0, 8).join(", ")}{holding.length > 8 ? "…" : ""}</span> : <span className="muted">not true now</span>}</td>
                  <td><button className="btn sm ghost" onClick={() => setRules(all.filter((x) => x.id !== r.id))}>✕</button></td>
                </tr>);
            })}
          </tbody></table>
        )}
      </div>
    </div>
  );
}

function ServerEvents() {
  const d = useData();
  const [ev, setEv] = useState(null);
  useEffect(() => { api("GET", "/api/alerts/events?limit=300").then(setEv).catch((e) => setEv({ error: e.message })); }, []);
  if (!ev) return <div className="card small muted">Loading delivered alerts…</div>;
  if (ev.error) return <div className="note warn">{ev.error}</div>;
  return (
    <div className="card">
      <h3>Delivered alerts</h3>
      <DataTable compact pageSize={20} exportName="delivered_alerts" rows={ev} columns={[
        { key: "t", label: "Fired", value: (e) => e.fired_at, render: (e) => new Date(e.fired_at).toLocaleString() },
        { key: "s", label: "Instrument", value: (e) => e.symbol, render: (e) => <StockLink sec={d.secById.get(e.instrument_id)}>{e.symbol}</StockLink> },
        { key: "a", label: "Alert", value: (e) => e.payload?.text },
        { key: "c", label: "Candle", value: (e) => e.payload?.barTime || e.bar_key },
        { key: "v", label: "Telegram", value: (e) => (e.delivered?.telegram ? (String(e.delivered.telegram).startsWith("error") ? e.delivered.telegram : "sent") : "—") },
      ]} />
    </div>
  );
}

function TelegramPanel() {
  const acct = useAccount();
  const [code, setCode] = useState(null);
  const [msg, setMsg] = useState(null);
  const me = acct.me;
  if (!acct.serverOn) return <div className="card stack"><h3>Telegram</h3><div className="small">Telegram alerts, the morning and weekly summaries and phone pop-ups are sent by the Technical Analysis server. Set <code>VITE_TA_SERVER_URL</code> (see docs/DEPLOY.md) to switch them on. Until then alerts are previewed in this app.</div></div>;
  if (!me) return <div className="card small muted">{acct.meError ? `Server: ${acct.meError}` : "Connecting to the server…"}</div>;
  const act = async (fn) => { setMsg(null); try { const r = await fn(); if (r) setMsg(r); await acct.refreshMe(); } catch (e) { setMsg(e.message); } };
  const setting = (k, v) => act(async () => { await api("PATCH", "/api/settings", { [k]: v }); });
  return (
    <div className="grid g2">
      <div className="card stack">
        <h3 style={{ margin: 0 }}>Telegram</h3>
        {me.telegramLinked ? (
          <>
            <div>Linked{me.telegramName ? ` to ${me.telegramName}` : ""}. Alerts, summaries and task results arrive in your chat with <a href={`https://t.me/${me.telegramBot}`} target="_blank" rel="noreferrer">@{me.telegramBot}</a>.</div>
            <div className="row"><button className="btn sm" onClick={() => act(async () => { await api("POST", "/api/telegram/test"); return "Test message sent."; })}>Send a test message</button>
              <button className="btn sm ghost" onClick={() => confirm("Stop Telegram alerts for this account?") && act(async () => { await api("POST", "/api/telegram/unlink"); return "Unlinked."; })}>Unlink</button></div>
          </>
        ) : (
          <>
            <div className="small">Connect your Telegram once. The GQ Agent bot then sends your alerts, and on Telegram you can ask it to analyse stocks, set alerts and run tasks for this account.</div>
            {code ? (
              <div className="note">Open <a href={code.deepLink} target="_blank" rel="noreferrer">@{me.telegramBot}</a> and send:<div className="mono" style={{ fontSize: 18, margin: "6px 0" }}>/ta link {code.code}</div><span className="small muted">Valid for 15 minutes. Then come back and press Refresh.</span></div>
            ) : null}
            <div className="row"><button className="btn sm primary" onClick={() => act(async () => { setCode(await api("POST", "/api/telegram/code")); })}>Get a link code</button><button className="btn sm" onClick={() => acct.refreshMe()}>Refresh</button></div>
          </>
        )}
        {msg && <div className="note small">{msg}</div>}
      </div>
      <div className="card stack">
        <h3 style={{ margin: 0 }}>Summaries</h3>
        <Check checked={me.settings?.morningSummary !== false} onChange={(v) => setting("morningSummary", v)}><b>Morning summary</b> · weekdays: what changed overnight in the market and your watchlists, and the alerts that fired</Check>
        <Check checked={me.settings?.weeklySummary !== false} onChange={(v) => setting("weeklySummary", v)}><b>Weekly summary</b> · the week's market brief and which of your watchlist names are rising or not</Check>
        <div className="small muted">Sent on Telegram (times are set on the server; default 09:15 IST weekdays and Saturday 09:00 IST).</div>
        <h3 style={{ margin: "8px 0 0" }}>Phone & desktop pop-ups</h3>
        {me.pushKey ? (
          pushSupported() || isIos() ? <div className="row"><button className="btn sm" onClick={() => act(async () => { await enablePush(me.pushKey); await api("POST", "/api/push/test"); return "Pop-ups are on for this device; a test was sent."; })}>Enable on this device</button>{isIos() && !isStandalone() && <span className="small muted">iPhone: add the app to the Home Screen first (Share → Add to Home Screen).</span>}</div>
            : <div className="small muted">This browser cannot show push notifications.</div>
        ) : <div className="small muted">Push is not configured on the server (VAPID keys); Telegram still works.</div>}
      </div>
    </div>
  );
}

function CardTab({ wls, rules }) {
  const [rule, setRule] = useState(rules[0] ? { rule: rules[0].rule, params: rules[0].params, tf: rules[0].tf } : { rule: "golden_cross", params: {}, tf: "D" });
  const [wl, setWl] = useState(null);
  return (
    <div className="stack">
      <div className="card stack">
        <div className="small">How often has an alert been followed by the move it implies? Pick a rule (or one of yours) and where to test it.</div>
        {rules.length > 0 && <Select label="One of my alerts" value="" options={rules.map((r) => ({ value: r.id, label: r.name || describeRule(r.rule, r.params) }))} onChange={(id) => { const r = rules.find((x) => x.id === id); if (r) { setRule({ rule: r.rule, params: r.params, tf: r.tf }); if (r.target?.watchlistId) setWl(r.target.watchlistId); } }} allowEmpty="—" />}
        <RuleEditor value={rule} onChange={setRule} />
        <Select label="Test on" value={wl} options={Object.entries(wls).map(([k, v]) => ({ value: k, label: `${v.name} (${v.ids.length})` }))} onChange={setWl} allowEmpty="The 120 largest stocks" />
      </div>
      <ReportCard key={JSON.stringify([rule, wl])} rule={rule} ids={wl ? wls[wl]?.ids : null} title="Alert report card" />
    </div>
  );
}
