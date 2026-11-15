// Data centre panels backed by the TA server: exchange capability matrix,
// API tokens and roles, the audit log (data queries, AI outputs, risk
// overrides, admin actions) and the operations dashboard.
import { useEffect, useState } from "react";
import { Badge, Loading, Kpi, Seg } from "../components/ui.jsx";
import { DataTable } from "../components/DataTable.jsx";
import { SERVER_ON, SERVER_URL, api } from "../lib/server.js";
import { useAccount } from "../components/Account.jsx";
import { CAPABILITIES, CAPABILITY_LEVELS, EXCHANGES, EXCHANGE_RULES } from "../../engine/deriv/capabilities.js";
import { MODEL_VERSIONS, ENGINE_VERSION } from "../../engine/versions.js";

const CAP_BADGE = { yes: "g", feed: "a", vendor: "a", no: "", na: "" };
const off = <div className="card small muted">This panel needs the TA server (VITE_TA_SERVER_URL) and a sign-in.</div>;

export function Capabilities() {
  return (
    <div className="stack">
      <div className="card">
        <div className="h3">Exchange capability matrix</div>
        <div className="tbl-wrap"><table className="tbl compact">
          <thead><tr><th>Capability</th>{Object.entries(EXCHANGES).map(([k, e]) => <th key={k} title={e.source}>{k}{e.connected ? " ✓" : ""}</th>)}</tr></thead>
          <tbody>{CAPABILITIES.map((c) => <tr key={c.key}><td>{c.label}</td>{Object.entries(EXCHANGES).map(([k, e]) => <td key={k}><Badge kind={CAP_BADGE[e.caps[c.key]]} title={CAPABILITY_LEVELS[e.caps[c.key]]}>{e.caps[c.key]}</Badge></td>)}</tr>)}</tbody>
        </table></div>
        <p className="legend-note">yes = collected and used now · feed = needs a live or licensed feed · vendor = needs a vendor licence · no = not published · na = does not apply. ✓ = connected. Pages read this matrix and say what is missing instead of showing an empty or imitated number.</p>
      </div>
      <div className="card">
        <div className="h3">Exchange rule engines</div>
        {Object.entries(EXCHANGE_RULES).map(([k, r]) => (
          <div key={k} className="small" style={{ marginBottom: 8 }}>
            <b>{k}</b> <span className="muted">({r.version})</span>
            <div>Expiry: {Object.entries(r.expiry || {}).map(([a, b]) => `${a}: ${b}`).join("; ")}</div>
            <div>Settlement: {Object.entries(r.settlement || {}).map(([a, b]) => `${a}: ${b}`).join("; ")}{r.style ? ` · style ${r.style}` : ""}{r.tradingHours ? ` · hours ${r.tradingHours}` : ""}</div>
            {r.freezeQty && <div>Freeze quantity (units): {Object.entries(r.freezeQty).map(([a, b]) => `${a} ${b}`).join(", ")}</div>}
            {r.mwplBan && <div>MWPL: near-ban alert at {r.mwplNearBan * 100}%, ban at {r.mwplBan * 100}%, exit at or below {r.mwplExit * 100}%</div>}
          </div>
        ))}
        <p className="legend-note">Lot sizes always come from each contract row of the exchange file; the values above are the rules that are not in the file.</p>
      </div>
      <div className="card">
        <div className="h3">Model and calculation versions · engine {ENGINE_VERSION}</div>
        <DataTable compact rows={Object.entries(MODEL_VERSIONS).map(([k, v]) => ({ id: k, k, v }))} exportName="model-versions" columns={[{ key: "k", label: "Component", value: (x) => x.k }, { key: "v", label: "Version", value: (x) => x.v }]} />
      </div>
    </div>
  );
}

export function Access() {
  const acct = useAccount();
  const [tk, setTk] = useState(null);
  const [made, setMade] = useState(null);
  const [draft, setDraft] = useState({ name: "python", scopes: ["market", "deriv", "indices"], ratePerMin: 60 });
  const [users, setUsers] = useState(null);
  const [msg, setMsg] = useState(null);
  const load = () => api("GET", "/api/tokens").then(setTk).catch((e) => setTk({ error: e.message }));
  useEffect(() => { if (SERVER_ON && acct.me) { load(); if (acct.me.isAdmin) api("GET", "/api/admin/users").then(setUsers).catch(() => {}); } }, [acct.me]);
  if (!SERVER_ON || !acct.me) return off;
  if (!tk) return <Loading />;
  return (
    <div className="stack">
      <div className="card stack">
        <div className="h3">API tokens (REST and WebSocket)</div>
        {tk.error ? <div className="note warn">{tk.error}</div> : <>
          <div className="row wrap" style={{ gap: 8 }}>
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} style={{ width: 140 }} />
            {Object.keys(tk.scopes).map((s) => <label key={s} className="small" title={tk.scopes[s]}><input type="checkbox" checked={draft.scopes.includes(s)} onChange={(e) => setDraft({ ...draft, scopes: e.target.checked ? [...draft.scopes, s] : draft.scopes.filter((x) => x !== s) })} /> {s}</label>)}
            <label className="small muted">Rate / min <input type="number" value={draft.ratePerMin} onChange={(e) => setDraft({ ...draft, ratePerMin: +e.target.value })} style={{ width: 60 }} /></label>
            <button className="btn sm primary" onClick={async () => { try { setMade(await api("POST", "/api/tokens", draft)); load(); } catch (e) { setMsg(e.message); } }}>Create token</button>
          </div>
          {made && <div className="note"><b>Copy this token now; it is not shown again:</b><div className="mono" style={{ wordBreak: "break-all", margin: "6px 0" }}>{made.token}</div>
            <pre className="mono small" style={{ whiteSpace: "pre-wrap" }}>{`import requests\nH = {"Authorization": "Token ${made.token}"}\nrequests.get("${SERVER_URL}/v1/deriv/chain/NIFTY", headers=H).json()\n# stream: wss://${SERVER_URL.replace(/^https?:\/\//, "")}/v1/stream?token=${made.token}`}</pre></div>}
          {msg && <div className="note warn small">{msg}</div>}
          <DataTable compact rows={tk.tokens} exportName="api-tokens" columns={[{ key: "n", label: "Name", value: (t) => t.name }, { key: "p", label: "Token", value: (t) => `${t.prefix}…` }, { key: "s", label: "Scopes", value: (t) => t.scopes.join(", ") }, { key: "r", label: "Rate / min", num: true, value: (t) => t.rate_per_min }, { key: "u", label: "Calls", num: true, value: (t) => +t.uses }, { key: "l", label: "Last used", value: (t) => (t.last_used_at ? new Date(t.last_used_at).toLocaleString() : "—") }, { key: "st", label: "", value: (t) => (t.revoked_at ? "revoked" : "active"), render: (t) => (t.revoked_at ? <Badge>revoked</Badge> : <a style={{ cursor: "pointer" }} onClick={async () => { if (confirm(`Revoke ${t.name}?`)) { await api("DELETE", `/api/tokens/${t.id}`); load(); } }}>revoke</a>) }]} />
          <DataTable compact rows={tk.endpoints.map((e, i) => ({ ...e, id: i }))} exportName="api-endpoints" columns={[{ key: "m", label: "Method", value: (e) => e.method }, { key: "p", label: "Path", value: (e) => e.path, render: (e) => <span className="mono">{e.path}</span> }, { key: "s", label: "Scope", value: (e) => e.scope }, { key: "d", label: "What", value: (e) => e.desc }]} />
          <p className="legend-note">Every call is rate-limited per token and written to the audit log. Fractions everywhere; dates ISO. Exchange values are facts, IV / Greeks / GEX are calculations with stated assumptions. Full reference: GET /v1 and docs/API.md.</p>
        </>}
      </div>
      <div className="card">
        <div className="h3">Your role: <Badge kind="b">{acct.me.role || "analyst"}</Badge></div>
        <div className="small muted">admin: everything incl. roles, audit and operations · analyst: alerts, tasks, API tokens · viewer: read only · disabled: no access.</div>
        {users && <DataTable compact rows={users} exportName="users" columns={[{ key: "e", label: "Email", value: (u) => u.email }, { key: "n", label: "Name", value: (u) => u.name || "" }, { key: "l", label: "Last seen", value: (u) => (u.last_seen_at ? new Date(u.last_seen_at).toLocaleString() : "—") },
          { key: "r", label: "Role", value: (u) => u.role, render: (u) => <select value={u.role} onChange={async (e) => { try { await api("PATCH", `/api/admin/users/${u.id}`, { role: e.target.value }); setUsers(await api("GET", "/api/admin/users")); } catch (er) { setMsg(er.message); } }}>{["admin", "analyst", "viewer", "disabled"].map((r) => <option key={r}>{r}</option>)}</select> }]} />}
      </div>
    </div>
  );
}

export function AuditLog() {
  const acct = useAccount();
  const [kind, setKind] = useState("events");
  const [cat, setCat] = useState("");
  const [rows, setRows] = useState(null);
  useEffect(() => {
    if (!SERVER_ON || !acct.me) return;
    setRows(null);
    (kind === "ai" ? api("GET", "/api/audit/ai?limit=500") : api("GET", `/api/audit?limit=500${cat ? `&category=${cat}` : ""}`)).then(setRows).catch((e) => setRows({ error: e.message }));
  }, [kind, cat, acct.me]);
  if (!SERVER_ON || !acct.me) return off;
  return (
    <div className="card stack">
      <div className="row wrap" style={{ gap: 10 }}>
        <Seg value={kind} onChange={setKind} options={[{ value: "events", label: "Audit trail" }, { value: "ai", label: "AI & model outputs" }]} />
        {kind === "events" && <Seg value={cat} onChange={setCat} options={[{ value: "", label: "All" }, { value: "api", label: "API queries" }, { value: "risk", label: "Risk overrides" }, { value: "admin", label: "Admin" }, { value: "token", label: "Tokens" }]} />}
        <span className="small muted">{acct.me.isAdmin ? "Everyone's entries (admin)" : "Your entries"} · append-only: the database refuses edits and deletions.</span>
      </div>
      {!rows ? <Loading /> : rows.error ? <div className="note warn">{rows.error}</div> : kind === "ai"
        ? <DataTable compact rows={rows} exportName="ai-audit" columns={[{ key: "a", label: "At", value: (x) => x.at, render: (x) => new Date(x.at).toLocaleString() }, { key: "k", label: "Kind", value: (x) => x.kind }, { key: "s", label: "Source", value: (x) => x.source }, { key: "m", label: "Model version", value: (x) => x.model_version || "" }, { key: "e", label: "Engine", value: (x) => x.engine_version }, { key: "p", label: "Parameters", value: (x) => JSON.stringify(x.params) }, { key: "h", label: "Inputs hash", value: (x) => x.features_hash, render: (x) => <span className="mono">{String(x.features_hash).slice(0, 10)}</span> }, { key: "o", label: "Output", value: (x) => JSON.stringify(x.output).slice(0, 300) }, { key: "t", label: "ms", num: true, value: (x) => x.took_ms }]} />
        : <DataTable compact rows={rows} exportName="audit-trail" columns={[{ key: "a", label: "At", value: (x) => x.at, render: (x) => new Date(x.at).toLocaleString() }, { key: "w", label: "Who", value: (x) => x.actor }, { key: "c", label: "Category", value: (x) => x.category }, { key: "x", label: "Action", value: (x) => x.action }, { key: "d", label: "Detail", value: (x) => JSON.stringify(x.detail).slice(0, 300) }]} />}
    </div>
  );
}

export function Operations() {
  const acct = useAccount();
  const [o, setO] = useState(null);
  const load = () => api("GET", "/api/admin/ops").then(setO).catch((e) => setO({ error: e.message }));
  useEffect(() => { if (SERVER_ON && acct.me?.isAdmin) { load(); const t = setInterval(load, 60_000); return () => clearInterval(t); } }, [acct.me]);
  if (!SERVER_ON || !acct.me) return off;
  if (!acct.me.isAdmin) return <div className="card small muted">Operations is for admins.</div>;
  if (!o) return <Loading />;
  if (o.error) return <div className="note warn">{o.error}</div>;
  const fo = o.feeds.fo, al = o.alerts;
  const ok = (b) => <Badge kind={b ? "g" : "r"}>{b ? "ok" : "check"}</Badge>;
  return (
    <div className="stack">
      <div className="kpis">
        <Kpi label="Server up" value={`${Math.round(o.uptimeSec / 3600)} h`} sub={`${o.memoryMb} MB`} />
        <Kpi label="F&O latest session" value={fo.latestSession ? String(fo.latestSession).slice(0, 10) : "—"} sub={`${fo.underlyings ?? "—"} underlyings · ${fo.sessionAgeDays ?? "—"} days old`} />
        <Kpi label="Market data as of" value={o.feeds.dataAsOf || "—"} />
        <Kpi label="Alerts fired (7d)" value={al.last7d?.fired ?? "—"} sub={`telegram errors ${al.last7d?.telegram_errors ?? 0} · push ${al.last7d?.push_errors ?? 0} · webhook ${al.last7d?.webhook_errors ?? 0}`} />
        <Kpi label="Telegram delivery delay" value={al.telegramDelaySec?.p50 != null ? `${Math.round(al.telegramDelaySec.p50)} s` : "—"} sub={al.telegramDelaySec?.p95 != null ? `p95 ${Math.round(al.telegramDelaySec.p95)} s over ${al.telegramDelaySec.n}` : ""} />
        <Kpi label="Failed tasks (24h)" value={o.tasks.failedLast24h ?? "—"} />
        <Kpi label="API stream clients" value={o.api.streamClients} />
      </div>
      <div className="grid g2">
        <div className="card small">
          <div className="h3">Feeds</div>
          <div>F&O collector {ok(fo.enabled && (fo.sessionAgeDays ?? 9) <= 4)} {fo.running ? "running now" : ""} · last pass {fo.last?.at ? new Date(fo.last.at).toLocaleString() : "—"} ({fo.last?.done?.length || 0} sessions)</div>
          <div>Sessions stored: {(fo.days || []).map((d) => `${d.status} ${d.n}`).join(" · ")}</div>
          <div>Missing contract master (no lot size): {fo.missingContractMaster?.length ? fo.missingContractMaster.join(", ") : "none"} {ok(!fo.missingContractMaster?.length)}</div>
          <div>Engine runs: {(o.feeds.engine || []).map((r) => `${r.status} ${r.finished ? new Date(r.finished).toLocaleString() : "running"}`).join(" · ") || "—"}</div>
          <div>Cross-asset series: {o.feeds.xasset?.n ?? "—"}, updated {o.feeds.xasset?.t ? new Date(o.feeds.xasset.t).toLocaleString() : "—"}</div>
          <div>Channels: telegram {ok(al.channels.telegram)} push {ok(al.channels.push)} email {ok(al.channels.email)} webhook signing {ok(al.channels.webhookSigned)} · {al.pushDevices ?? 0} push devices</div>
          <div>Alert engine last run {al.engine?.lastRun?.at ? new Date(al.engine.lastRun.at).toLocaleString() : "—"}; derivatives {al.engine?.lastDeriv?.session || "—"} ({al.engine?.lastDeriv?.fired ?? 0} fired)</div>
        </div>
        <div className="card">
          <div className="h3">API routes (since start)</div>
          <DataTable compact pageSize={15} rows={o.http.map((r) => ({ ...r, id: r.route }))} exportName="ops-routes" columns={[{ key: "r", label: "Route", value: (r) => r.route, render: (r) => <span className="mono small">{r.route}</span> }, { key: "n", label: "Calls", num: true, value: (r) => r.n }, { key: "e", label: "Errors", num: true, value: (r) => r.errors }, { key: "p50", label: "p50 ms", num: true, value: (r) => r.p50 }, { key: "p95", label: "p95 ms", num: true, value: (r) => r.p95 }]} />
        </div>
      </div>
      <div className="card"><div className="h3">API usage by token</div><DataTable compact rows={o.api.tokens.map((t, i) => ({ ...t, id: i }))} exportName="ops-api" columns={[{ key: "p", label: "Token", value: (t) => `${t.prefix}… (${t.name})` }, { key: "e", label: "Owner", value: (t) => t.email }, { key: "u", label: "Calls", num: true, value: (t) => +t.uses }, { key: "l", label: "Last used", value: (t) => (t.last_used_at ? new Date(t.last_used_at).toLocaleString() : "—") }, { key: "r", label: "", value: (t) => (t.revoked_at ? "revoked" : "") }]} /></div>
      <p className="legend-note">Refreshes every minute. Feed latency here is end-of-day (session age); sub-second streaming, packet drops and Greek timeouts apply only once a live feed is connected.</p>
    </div>
  );
}
