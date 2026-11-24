// People & access (admins): every account, its role, and what its GQ Agent may read (Shankar Sir, 2026-11-24:
// "the agent should only be able to access what we give it access to on a personal basis"). The agent is off for
// a new account until an admin switches it on here.
import { useEffect, useMemo, useState } from "react";
import { api, SERVER_ON } from "../lib/server.js";
import { useAccount } from "../components/Account.jsx";
import { PageHead, Empty, Badge } from "../components/ui.jsx";
import { Modal } from "../components/Share.jsx";

export default function Admin() {
  const acct = useAccount();
  const [users, setUsers] = useState(null);
  const [sources, setSources] = useState([]);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState(null);
  const [pw, setPw] = useState(null);
  const reload = () => api("GET", "/api/admin/users").then(setUsers).catch((e) => setMsg(e.message));
  useEffect(() => {
    if (!acct.me?.isAdmin) return;
    reload();
    api("GET", "/api/admin/agent-sources").then(setSources).catch(() => {});
  }, [acct.me]);
  const shown = useMemo(() => (users || []).filter((u) => !q || `${u.email} ${u.display_name || ""} ${u.name || ""}`.toLowerCase().includes(q.toLowerCase())), [users, q]);
  if (!SERVER_ON || !acct.me) return <><PageHead title="People & access" /><Empty>Sign in first.</Empty></>;
  if (!acct.me.isAdmin) return <><PageHead title="People & access" /><Empty>Only admins can manage people.</Empty></>;

  // the switch moves at once; it moves back (with the reason) if the server refuses
  const setAccess = async (u, next) => {
    const before = u.agent_access;
    const put = (a) => setUsers((list) => list.map((x) => (x.id === u.id ? { ...x, agent_access: a } : x)));
    put({ enabled: !!next.enabled, sources: next.enabled ? next.sources : [] });
    try { put(await api("PUT", `/api/admin/users/${u.id}/agent`, next)); }
    catch (e) { put(before); setMsg(e.message); }
  };
  const setRole = async (u, role) => {
    try { await api("PATCH", `/api/admin/users/${u.id}`, { role }); reload(); } catch (e) { setMsg(e.message); }
  };
  const isAdminRow = (u) => u.role === "admin";
  return (
    <>
      <PageHead title="People & access" sub="Everyone with an XRayDar account. The GQ Agent is off for a new account: switch it on per person and choose exactly what it may read." />
      {msg && <div className="note warn" role="alert">{msg} <button className="btn sm ghost" onClick={() => setMsg(null)}>✕</button></div>}
      <div className="row wrap" style={{ gap: 8, marginBottom: 8 }}>
        <input placeholder="Search name or email…" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 240 }} />
        {users && <span className="small muted">{users.length} accounts · agent on for {users.filter((u) => u.agent_access?.enabled).length}</span>}
      </div>
      {!users ? <Empty>Loading…</Empty> : (
        <div className="tbl-wrap">
          <table className="tbl admin-tbl">
            <thead><tr><th>Person</th><th>Joined</th><th>Last seen</th><th>Role</th><th>GQ Agent</th><th>What the agent may read</th><th /></tr></thead>
            <tbody>
              {shown.map((u) => {
                const a = u.agent_access || { enabled: false, sources: [] };
                return (
                  <tr key={u.id}>
                    <td><b>{u.display_name || u.name || "—"}</b><div className="small muted">{u.email}</div></td>
                    <td className="small">{new Date(u.created_at).toLocaleDateString()}{u.created_via === "signup" ? <div className="muted">signed up</div> : null}</td>
                    <td className="small">{u.last_seen_at ? new Date(u.last_seen_at).toLocaleString() : "—"}</td>
                    <td><select value={u.role} onChange={(e) => setRole(u, e.target.value)} disabled={u.id === acct.me.id}>{["admin", "analyst", "viewer", "disabled"].map((r) => <option key={r}>{r}</option>)}</select></td>
                    <td>{isAdminRow(u) ? <Badge kind="g">always on</Badge> : (
                      <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={!!a.enabled} onChange={(e) => setAccess(u, { enabled: e.target.checked, sources: e.target.checked && !a.sources.length ? ["xraydar"] : a.sources })} />{a.enabled ? "on" : "off"}</label>
                    )}</td>
                    <td>{isAdminRow(u) ? <span className="small muted">everything (admin)</span> : (
                      <div className="row wrap" style={{ gap: 6, opacity: a.enabled ? 1 : 0.45 }}>
                        {sources.map((s) => (
                          <label key={s.id} className="small" title={s.label} style={{ whiteSpace: "nowrap" }}>
                            <input type="checkbox" disabled={!a.enabled} checked={a.sources.includes(s.id)} onChange={(e) => setAccess(u, { enabled: a.enabled, sources: e.target.checked ? [...a.sources, s.id] : a.sources.filter((x) => x !== s.id) })} /> {s.label}
                          </label>
                        ))}
                      </div>
                    )}</td>
                    <td><button className="btn sm ghost" onClick={() => setPw({ user: u, value: "" })} title="Set a temporary password">🔑</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="legend-note">The agent has no access to anyone's personal email or other personal accounts. It reads only the sources ticked here (admins: everything). A Telegram account linked to an XRayDar account follows the same switches.</p>
      {pw && (
        <Modal title={`Temporary password for ${pw.user.display_name || pw.user.email}`} onClose={() => setPw(null)}>
          <div className="small muted">Give it to the person; they can change it from their account menu after signing in.</div>
          <input type="text" value={pw.value} onChange={(e) => setPw({ ...pw, value: e.target.value })} placeholder="At least 8 characters" />
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn primary" onClick={async () => { try { await api("POST", `/api/admin/users/${pw.user.id}/password`, { password: pw.value }); setPw(null); setMsg(null); alert("Password set."); } catch (e) { setMsg(e.message); } }}>Set password</button>
          </div>
        </Modal>
      )}
    </>
  );
}
