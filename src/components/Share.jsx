// Sharing levels for anything a person builds in XRayDar (Shankar Sir, 2026-11-24): only me / chosen people /
// everyone. The share follows the owner's saved item, so people always see the current version.
import { useEffect, useRef, useState } from "react";
import { api, SERVER_ON } from "../lib/server.js";
import { useAccount } from "./Account.jsx";
import { flushDoc, SHARE_KINDS, VIS_LABEL } from "../lib/community.js";

export function Modal({ title, onClose, children, width = 480 }) {
  useEffect(() => {
    const k = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="qt-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="qt card stack modal" role="dialog" aria-label={title} style={{ width: `min(${width}px, calc(100vw - 24px))` }}>
        <div className="row between"><b>{title}</b><button className="btn sm ghost" onClick={onClose} aria-label="Close">✕</button></div>
        {children}
      </div>
    </div>
  );
}

/** Search people by name (or exact email); returns their id and display name. Never shows emails. */
export function PeoplePicker({ value, onChange, placeholder = "Type a name or an email…" }) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState([]);
  const t = useRef(null);
  useEffect(() => {
    clearTimeout(t.current);
    if (q.trim().length < 2) { setFound([]); return undefined; }
    t.current = setTimeout(() => api("GET", `/api/people?q=${encodeURIComponent(q.trim())}`).then(setFound).catch(() => setFound([])), 250);
    return () => clearTimeout(t.current);
  }, [q]);
  const add = (p) => { if (!value.some((x) => x.id === p.id)) onChange([...value, p]); setQ(""); setFound([]); };
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row wrap" style={{ gap: 4 }}>
        {value.map((p) => <span key={p.id} className="chip">{p.name}<button className="btn sm ghost" onClick={() => onChange(value.filter((x) => x.id !== p.id))} aria-label={`Remove ${p.name}`}>✕</button></span>)}
      </div>
      <input value={q} placeholder={placeholder} onChange={(e) => setQ(e.target.value)} />
      {found.length > 0 && <div className="qt-list">{found.map((p) => <div key={p.id} className="it" onMouseDown={() => add(p)}><span>{p.name}</span><span className="small muted">add</span></div>)}</div>}
      {q.trim().length >= 2 && !found.length && <div className="small muted">Nobody found. People appear here once they have an XRayDar account.</div>}
    </div>
  );
}

/** "Share" button for one saved item. sourceKey = the workspace document, item = its id (or key / name). */
export function ShareButton({ sourceKey, item, title, small = true, label = "Share" }) {
  const acct = useAccount();
  const [open, setOpen] = useState(false);
  if (!SERVER_ON || !acct.me || !item) return null;
  return (
    <>
      <button className={`btn ${small ? "sm" : ""}`} onClick={() => setOpen(true)} title={`Choose who can see this ${(SHARE_KINDS[sourceKey] || "item").toLowerCase()}`}>⇪ {label}</button>
      {open && <ShareDialog sourceKey={sourceKey} item={String(item)} title={title} onClose={() => setOpen(false)} />}
    </>
  );
}

export function ShareDialog({ sourceKey, item, title, onClose }) {
  const [state, setState] = useState(null); // the existing share, if any
  const [vis, setVis] = useState("private");
  const [people, setPeople] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    api("GET", "/api/shares/mine").then((list) => {
      const s = list.find((x) => x.sourceKey === sourceKey && x.sourceItem === item);
      if (s) { setState(s); setVis(s.visibility); setPeople(s.people || []); }
    }).catch((e) => setMsg(e.message));
  }, [sourceKey, item]);
  const save = async () => {
    if (vis === "people" && !people.length) { setMsg("Add at least one person, or choose another option."); return; }
    setBusy(true); setMsg(null);
    try {
      await flushDoc(sourceKey); // share what is saved in the account now
      const out = await api("POST", "/api/shares", { sourceKey, sourceItem: item, title, visibility: vis, people: people.map((p) => p.id) });
      setState(out);
      setMsg(vis === "private" ? "Only you can see it." : vis === "everyone" ? "Everyone on XRayDar can now see and copy it. Changes you make reach them automatically." : `Shared with ${people.map((p) => p.name).join(", ")}. Changes you make reach them automatically.`);
    } catch (e) { setMsg(e.message); }
    finally { setBusy(false); }
  };
  const stop = async () => {
    if (!state) return;
    setBusy(true);
    try { await api("DELETE", `/api/shares/${state.id}`); setState(null); setVis("private"); setPeople([]); setMsg("No longer shared."); }
    catch (e) { setMsg(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Share ${SHARE_KINDS[sourceKey]?.toLowerCase() || "item"}: ${title || item}`} onClose={onClose}>
      <div className="stack" style={{ gap: 6 }}>
        {["private", "people", "everyone"].map((v) => (
          <label key={v} className="row" style={{ gap: 8, cursor: "pointer" }}>
            <input type="radio" name="vis" checked={vis === v} onChange={() => setVis(v)} />
            <span><b>{VIS_LABEL[v]}</b><span className="small muted"> · {v === "private" ? "nobody else sees it" : v === "people" ? "only the people you name" : "every XRayDar user can see it and save a copy"}</span></span>
          </label>
        ))}
      </div>
      {vis === "people" && <PeoplePicker value={people} onChange={setPeople} />}
      <div className="row between">
        {state ? <button className="btn sm ghost" onClick={stop} disabled={busy}>Stop sharing</button> : <span />}
        <button className="btn primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
      </div>
      {state && <div className="small muted">Currently: {VIS_LABEL[state.visibility]}{state.visibility === "people" && state.people?.length ? ` (${state.people.map((p) => p.name).join(", ")})` : ""}</div>}
      {msg && <div className="note" role="status">{msg}</div>}
    </Modal>
  );
}
