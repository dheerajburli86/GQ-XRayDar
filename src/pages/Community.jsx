// Community and chat (Shankar Sir, 2026-11-24): public / private rooms, message boards with topics and replies,
// private group chats and direct messages. People can share charts, their own screens / watchlists / formulas
// (as a copy), files (images, PDFs, spreadsheets, documents up to 10 MB) and links. New messages arrive by
// polling (every 3 s while a conversation is open), so it works through any proxy.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, SERVER_ON } from "../lib/server.js";
import { useAccount } from "../components/Account.jsx";
import { useRoute, navigate, href } from "../lib/router.js";
import { PageHead, Empty, Badge } from "../components/ui.jsx";
import { Modal, PeoplePicker } from "../components/Share.jsx";
import { QuickTicker } from "../components/QuickTicker.jsx";
import { ItemPreview } from "./Library.jsx";
import { load } from "../lib/storage.js";
import { SHARE_KINDS, uploadFile, fileUrl, downloadFile, chartHref, saveCopy, fmtWhen, fmtSize, bumpUnread } from "../lib/community.js";

const KIND_LABEL = { room: "Room", board: "Board", group: "Group", dm: "Direct" };
const POLL_MS = 3000;

// ---------------------------------------------------------------- message pieces
const URL_RE = /(https?:\/\/[^\s<>"']+)/g;
function Linkified({ text }) {
  const parts = String(text || "").split(URL_RE);
  return <>{parts.map((p, i) => (i % 2 ? <a key={i} href={p} target="_blank" rel="noopener noreferrer nofollow">{p}</a> : <span key={i}>{p}</span>))}</>;
}
function AuthedImage({ fileId, alt }) {
  const [src, setSrc] = useState(null);
  const [err, setErr] = useState(false);
  useEffect(() => { let on = true; fileUrl(fileId).then((u) => on && setSrc(u)).catch(() => on && setErr(true)); return () => { on = false; }; }, [fileId]);
  if (err) return <div className="small muted">Picture not available.</div>;
  return src ? <img className="msg-img" src={src} alt={alt || ""} onClick={() => window.open(src, "_blank", "noopener")} /> : <div className="small muted">Loading picture…</div>;
}
function Attachment({ a, onInfo }) {
  if (a.type === "chart") {
    return (
      <div className="att card">
        <div className="row between"><b>📈 {a.title || "Chart"}</b><a className="btn sm" href={chartHref(a)}>Open chart</a></div>
        {a.fileId && <AuthedImage fileId={a.fileId} alt={a.title} />}
        <div className="small muted">{[a.screen && a.screen !== "chart" ? a.screen : "Chart lab", a.tf].filter(Boolean).join(" · ")}</div>
      </div>
    );
  }
  if (a.type === "file") {
    const img = /^image\//.test(a.mime);
    return (
      <div className="att card">
        {img ? <AuthedImage fileId={a.fileId} alt={a.name} /> : null}
        <div className="row between"><span>📄 {a.name} <span className="small muted">{a.size ? fmtSize(a.size) : ""}</span></span><button className="btn sm" onClick={() => downloadFile(a.fileId, a.name).catch((e) => onInfo(e.message))}>Download</button></div>
      </div>
    );
  }
  if (a.type === "item") {
    return <ItemAttachment a={a} onInfo={onInfo} />;
  }
  if (a.type === "share") return <div className="att card row between"><span>⇪ {a.title || "Shared item"}</span><a className="btn sm" href={href("library")}>Open library</a></div>;
  if (a.type === "link") return <div className="att"><a href={a.url} target={a.url.startsWith("#") ? undefined : "_blank"} rel="noopener noreferrer nofollow">🔗 {a.title || a.url}</a></div>;
  return null;
}
function ItemAttachment({ a, onInfo }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="att card">
      <div className="row between"><span><Badge>{a.kindLabel || SHARE_KINDS[a.kind]}</Badge> <b>{a.title}</b></span>
        <span className="row" style={{ gap: 4 }}><button className="btn sm" onClick={() => setOpen(true)}>View</button><button className="btn sm primary" onClick={() => { const n = saveCopy(a.kind, a.payload, "chat"); if (n) onInfo(n); }}>Save a copy</button></span></div>
      {open && <Modal title={`${a.kindLabel}: ${a.title}`} onClose={() => setOpen(false)} width={640}><ItemPreview kind={a.kind} payload={a.payload} /></Modal>}
    </div>
  );
}
function Message({ m, me, canManage, onEdit, onDelete, onInfo, onOpenThread, compact }) {
  const mine = m.author.id === me;
  if (m.deleted) return <div className="msg-row deleted small muted">Message deleted</div>;
  return (
    <div className={`msg-row ${mine ? "mine" : ""}`}>
      <div className="msg-head"><b className={mine ? "pos" : ""}>{m.author.name}</b><span className="small muted">{fmtWhen(m.createdAt)}{m.editedAt ? " · edited" : ""}</span>
        <span className="msg-actions">
          {mine && <button className="btn sm ghost" onClick={() => onEdit(m)} title="Edit">✎</button>}
          {(mine || canManage) && <button className="btn sm ghost" onClick={() => onDelete(m)} title="Delete">🗑</button>}
        </span>
      </div>
      {m.title && <div className="msg-title">{onOpenThread ? <a href="#" onClick={(e) => { e.preventDefault(); onOpenThread(m); }}>{m.title}</a> : m.title}</div>}
      {m.body && <div className="msg-body"><Linkified text={compact && m.body.length > 280 ? `${m.body.slice(0, 280)}…` : m.body} /></div>}
      {(m.attachments || []).map((a, i) => <Attachment key={i} a={a} onInfo={onInfo} />)}
      {m.replies != null && <div className="small muted">{m.replies} {m.replies === 1 ? "reply" : "replies"}{m.lastReplyAt ? ` · last ${fmtWhen(m.lastReplyAt)}` : ""}{onOpenThread && <> · <a href="#" onClick={(e) => { e.preventDefault(); onOpenThread(m); }}>Open</a></>}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- composer
function pickableItems() {
  const out = [];
  for (const kind of ["watchlists", "screens", "customIndicators", "notes", "alerts.rules", "customIndices", "workspaces", "deriv.screens"]) {
    const v = load(kind, null);
    if (Array.isArray(v)) v.forEach((x, i) => x && out.push({ kind, key: x.id || String(i), title: x.name || x.title || x.label || (x.text || "").slice(0, 40) || `${SHARE_KINDS[kind]} ${i + 1}`, payload: x }));
    else if (v && typeof v === "object") Object.entries(v).forEach(([k, x]) => out.push({ kind, key: k, title: x?.name || k, payload: x }));
  }
  return out;
}
function Composer({ roomId, isBoard, parentId, onSent, onInfo }) {
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [att, setAtt] = useState([]);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(null); // chart | item
  const [chart, setChart] = useState(null);
  const fileRef = useRef(null);
  const needTitle = isBoard && !parentId;
  const send = async () => {
    if (busy) return;
    if (!text.trim() && !att.length && !(needTitle && title.trim())) return;
    setBusy(true);
    try {
      const m = await api("POST", `/api/rooms/${roomId}/messages`, { body: text, attachments: att, parentId: parentId || undefined, title: needTitle ? title : undefined });
      setText(""); setTitle(""); setAtt([]); onSent(m);
    } catch (e) { onInfo(e.message); } finally { setBusy(false); }
  };
  const onFiles = async (files) => {
    for (const f of [...files].slice(0, 5)) {
      try { setBusy(true); const up = await uploadFile(roomId, f, f.name); setAtt((a) => [...a, { type: "file", fileId: up.id, name: up.name, mime: up.mime, size: up.size }]); }
      catch (e) { onInfo(`${f.name}: ${e.message}`); } finally { setBusy(false); }
    }
  };
  return (
    <div className="composer stack" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files?.length) onFiles(e.dataTransfer.files); }}>
      {needTitle && <input placeholder="Topic title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} />}
      {att.length > 0 && <div className="row wrap" style={{ gap: 4 }}>{att.map((a, i) => <span key={i} className="chip">{a.type === "file" ? `📄 ${a.name}` : a.type === "chart" ? `📈 ${a.title}` : `⇪ ${a.title}`}<button className="btn sm ghost" onClick={() => setAtt(att.filter((_, j) => j !== i))} aria-label="Remove">✕</button></span>)}</div>}
      <textarea rows={2} placeholder={needTitle ? "What do you want to discuss?" : parentId ? "Write a reply… (Enter sends, Shift+Enter for a new line)" : "Write a message… (Enter sends, Shift+Enter for a new line)"} value={text}
        onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !needTitle) { e.preventDefault(); send(); } }}
        onPaste={(e) => { const f = [...(e.clipboardData?.files || [])]; if (f.length) { e.preventDefault(); onFiles(f); } }} maxLength={8000} />
      <div className="row between">
        <span className="row" style={{ gap: 4 }}>
          <button className="btn sm" onClick={() => fileRef.current?.click()} title="Attach a picture, PDF, spreadsheet or document (10 MB max)" disabled={busy}>📎 File</button>
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
          <button className="btn sm" onClick={() => setPicking("chart")} title="Share a chart">📈 Chart</button>
          <button className="btn sm" onClick={() => setPicking("item")} title="Send a copy of one of your watchlists, screens, formulas, notes…">⇪ My item</button>
        </span>
        <button className="btn primary" onClick={send} disabled={busy}>{busy ? "…" : needTitle ? "Post topic" : "Send"}</button>
      </div>
      {picking === "chart" && !chart && <QuickTicker secOnly title="Which chart?" onClose={() => setPicking(null)} onPick={(r) => setChart({ ref: `s:${r.id}`, title: `${r.symbol || r.label || r.name || r.id}`, tf: "D", screen: "chart" })} />}
      {chart && (
        <Modal title={`Share chart: ${chart.title}`} onClose={() => { setChart(null); setPicking(null); }}>
          <label className="row" style={{ gap: 8 }}><span className="small muted">Screen</span><select value={chart.screen} onChange={(e) => setChart({ ...chart, screen: e.target.value })}>{[["chart", "Chart lab"], ["RSIMMA", "RSIMMA"], ["RSIACC", "RSIACC"], ["RSCMMA", "RSCMMA"], ["RSCACC", "RSCACC"], ["stock", "Stock page"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label className="row" style={{ gap: 8 }}><span className="small muted">Period</span><select value={chart.tf} onChange={(e) => setChart({ ...chart, tf: e.target.value })}>{["D", "W", "M", "Q", "Y"].map((t) => <option key={t}>{t}</option>)}</select></label>
          <div className="small muted">Tip: to send a picture of a chart exactly as you see it, use ⇪ Share on the chart itself.</div>
          <div className="row" style={{ justifyContent: "flex-end" }}><button className="btn primary" onClick={() => { setAtt((a) => [...a, { type: "chart", ...chart, title: `${chart.title} ${chart.tf}` }]); setChart(null); setPicking(null); }}>Attach</button></div>
        </Modal>
      )}
      {picking === "item" && <ItemPick onClose={() => setPicking(null)} onPick={(it) => { setAtt((a) => [...a, { type: "item", kind: it.kind, title: it.title, payload: it.payload }]); setPicking(null); }} />}
    </div>
  );
}
function ItemPick({ onClose, onPick }) {
  const items = useMemo(() => pickableItems(), []);
  const [q, setQ] = useState("");
  const shown = items.filter((i) => !q || `${i.title} ${SHARE_KINDS[i.kind]}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Modal title="Send a copy of one of your items" onClose={onClose}>
      <input placeholder="Search your items…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <div className="qt-list">{shown.length ? shown.map((i) => <div key={i.kind + i.key} className="it" onMouseDown={() => onPick(i)}><span>{i.title}</span><span className="small muted">{SHARE_KINDS[i.kind]}</span></div>) : <div className="small muted" style={{ padding: 8 }}>You have no saved watchlists, screens, formulas or notes yet.</div>}</div>
      <div className="small muted">They receive a copy as it is now. To share something that stays up to date, use ⇪ Share next to the item instead.</div>
    </Modal>
  );
}

// ---------------------------------------------------------------- one conversation
function useMessages(roomId, { parent = null, threads = false } = {}) {
  const [msgs, setMsgs] = useState(null);
  const [err, setErr] = useState(null);
  const [more, setMore] = useState(true);
  const last = useRef(0);
  const qs = `${parent ? `&parent=${parent}` : ""}${threads ? "&threads=1" : ""}`;
  const loadInitial = useCallback(async () => {
    setMsgs(null); setErr(null); last.current = 0;
    try { const r = await api("GET", `/api/rooms/${roomId}/messages?limit=60${qs}`); setMsgs(r.messages); setMore(r.messages.length >= 60); last.current = Math.max(0, ...r.messages.map((m) => m.id)); return r; }
    catch (e) { setErr(e.message); return null; }
  }, [roomId, qs]);
  useEffect(() => { loadInitial(); }, [loadInitial]);
  useEffect(() => {
    if (threads) { const t = setInterval(() => api("GET", `/api/rooms/${roomId}/messages?limit=60${qs}`).then((r) => setMsgs(r.messages)).catch(() => {}), POLL_MS * 4); return () => clearInterval(t); }
    const t = setInterval(async () => {
      if (document.hidden) return;
      try {
        const r = await api("GET", `/api/rooms/${roomId}/messages?after=${last.current}${qs}`);
        if (r.messages.length) { last.current = Math.max(last.current, ...r.messages.map((m) => m.id)); setMsgs((cur) => merge(cur, r.messages)); }
      } catch { /* the next tick retries */ }
    }, POLL_MS);
    return () => clearInterval(t);
  }, [roomId, qs, threads]);
  const older = async () => {
    const first = msgs?.[0]?.id; if (!first) return;
    const r = await api("GET", `/api/rooms/${roomId}/messages?before=${first}&limit=60${qs}`);
    setMsgs((cur) => merge(r.messages, cur || [])); setMore(r.messages.length >= 60);
  };
  const upsert = (m) => { last.current = Math.max(last.current, m.id); setMsgs((cur) => merge(cur, [m])); };
  const remove = (id) => setMsgs((cur) => (cur || []).map((m) => (m.id === id ? { ...m, deleted: true } : m)));
  return { msgs, err, more, older, upsert, remove, reload: loadInitial };
}
const merge = (a, b) => { const map = new Map((a || []).map((m) => [m.id, m])); for (const m of b || []) map.set(m.id, m); return [...map.values()].sort((x, y) => x.id - y.id); };

function Conversation({ roomId, threadId, me, onChanged }) {
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState(null);
  const [note, setNote] = useState(null);
  const [panel, setPanel] = useState(null); // members | settings
  useEffect(() => { setInfo(null); setErr(null); api("GET", `/api/rooms/${roomId}`).then(setInfo).catch((e) => setErr(e.message)); }, [roomId]);
  if (err) return <div className="note warn">{err}</div>;
  if (!info) return <Empty>Loading…</Empty>;
  const isBoard = info.kind === "board";
  return (
    <div className="conv stack">
      <div className="conv-head row between">
        <div><b>{info.kind === "dm" ? info.name : info.name}</b> <Badge>{KIND_LABEL[info.kind]}</Badge> {info.kind !== "dm" && <Badge>{info.visibility === "public" ? "Public" : "Private"}</Badge>}
          {info.description && <div className="small muted">{info.description}</div>}</div>
        <span className="row" style={{ gap: 4 }}>
          {!info.myRole && info.visibility === "public" && <button className="btn sm primary" onClick={async () => { await api("POST", `/api/rooms/${roomId}/join`); setInfo(await api("GET", `/api/rooms/${roomId}`)); onChanged(); }}>Join</button>}
          {info.kind !== "dm" && <button className="btn sm" onClick={() => setPanel("members")}>👥 {info.memberCount}</button>}
          {info.canManage && info.kind !== "dm" && <button className="btn sm" onClick={() => setPanel("settings")}>⚙</button>}
        </span>
      </div>
      {note && <div className="note" role="status">{note} <button className="btn sm ghost" onClick={() => setNote(null)}>✕</button></div>}
      {isBoard && !threadId ? <BoardTopics roomId={roomId} me={me} canManage={info.canManage} onInfo={setNote} />
        : <Thread key={`${roomId}:${threadId || ""}`} roomId={roomId} parent={isBoard ? threadId : null} isBoard={isBoard} me={me} canManage={info.canManage} onInfo={setNote} canPost={!!info.myRole || info.visibility === "public"} onRead={onChanged} />}
      {panel === "members" && <Members info={info} me={me} onClose={() => setPanel(null)} onChanged={async () => { setInfo(await api("GET", `/api/rooms/${roomId}`).catch(() => null)); onChanged(); }} />}
      {panel === "settings" && <RoomSettings info={info} onClose={() => setPanel(null)} onChanged={async (deleted) => { if (deleted) { navigate("community"); onChanged(); return; } setInfo(await api("GET", `/api/rooms/${roomId}`)); onChanged(); }} />}
    </div>
  );
}

function Thread({ roomId, parent, isBoard, me, canManage, onInfo, canPost, onRead }) {
  const { msgs, err, more, older, upsert, remove } = useMessages(roomId, { parent });
  const box = useRef(null);
  const stick = useRef(true);
  const [editing, setEditing] = useState(null);
  useEffect(() => { const b = box.current; if (b && stick.current) b.scrollTop = b.scrollHeight; }, [msgs]);
  useEffect(() => {
    const lastId = msgs?.length ? msgs[msgs.length - 1].id : 0;
    if (lastId) api("POST", `/api/rooms/${roomId}/read`, { lastId }).then(() => { bumpUnread(); onRead?.(); }).catch(() => {});
  }, [msgs, roomId]); // eslint-disable-line react-hooks/exhaustive-deps
  const del = async (m) => { if (!confirm("Delete this message?")) return; try { await api("DELETE", `/api/messages/${m.id}`); remove(m.id); } catch (e) { onInfo(e.message); } };
  const saveEdit = async () => { try { upsert(await api("PATCH", `/api/messages/${editing.id}`, { body: editing.body })); setEditing(null); } catch (e) { onInfo(e.message); } };
  return (
    <>
      {isBoard && <a className="small" href={href(`community/${roomId}`)}>← All topics</a>}
      <div className="msg-list" ref={box} onScroll={(e) => { const b = e.currentTarget; stick.current = b.scrollHeight - b.scrollTop - b.clientHeight < 80; }}>
        {err && <div className="note warn">{err}</div>}
        {!msgs ? <Empty>Loading…</Empty> : !msgs.length ? <Empty>No messages yet. Say hello.</Empty> : (
          <>
            {more && <div style={{ textAlign: "center" }}><button className="btn sm ghost" onClick={older}>Load older messages</button></div>}
            {msgs.map((m) => <Message key={m.id} m={m} me={me} canManage={canManage} onEdit={(x) => setEditing({ id: x.id, body: x.body })} onDelete={del} onInfo={onInfo} />)}
          </>
        )}
      </div>
      {canPost && <Composer roomId={roomId} isBoard={isBoard} parentId={parent} onInfo={onInfo} onSent={(m) => { stick.current = true; upsert(m); }} />}
      {editing && (
        <Modal title="Edit message" onClose={() => setEditing(null)}>
          <textarea rows={4} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} maxLength={8000} />
          <div className="row" style={{ justifyContent: "flex-end" }}><button className="btn primary" onClick={saveEdit}>Save</button></div>
        </Modal>
      )}
    </>
  );
}

function BoardTopics({ roomId, me, canManage, onInfo }) {
  const { msgs, err, upsert, remove } = useMessages(roomId, { threads: true });
  const [writing, setWriting] = useState(false);
  const del = async (m) => { if (!confirm("Delete this topic and its replies?")) return; try { await api("DELETE", `/api/messages/${m.id}`); remove(m.id); } catch (e) { onInfo(e.message); } };
  return (
    <>
      <div className="row between"><span className="small muted">Topics, newest activity first</span><button className="btn sm primary" onClick={() => setWriting(!writing)}>{writing ? "Cancel" : "+ New topic"}</button></div>
      {writing && <Composer roomId={roomId} isBoard onInfo={onInfo} onSent={(m) => { setWriting(false); upsert({ ...m, replies: 0 }); navigate(`community/${roomId}/${m.id}`); }} />}
      {err && <div className="note warn">{err}</div>}
      <div className="msg-list topics">
        {!msgs ? <Empty>Loading…</Empty> : !msgs.filter((m) => !m.deleted).length ? <Empty>No topics yet. Start the first one.</Empty>
          : msgs.filter((m) => !m.deleted).map((m) => <Message key={m.id} m={m} me={me} canManage={canManage} compact onEdit={() => navigate(`community/${roomId}/${m.id}`)} onDelete={del} onInfo={onInfo} onOpenThread={(x) => navigate(`community/${roomId}/${x.id}`)} />)}
      </div>
    </>
  );
}

function Members({ info, me, onClose, onChanged }) {
  const [add, setAdd] = useState([]);
  const [msg, setMsg] = useState(null);
  const canAdd = info.canManage || (info.kind === "group" && info.myRole);
  const act = async (fn) => { try { await fn(); setMsg(null); await onChanged(); } catch (e) { setMsg(e.message); } };
  return (
    <Modal title={`People in ${info.name}`} onClose={onClose}>
      <div className="qt-list">{info.members.map((m) => (
        <div key={m.id} className="it">
          <span>{m.name}{m.id === me ? " (you)" : ""} {m.role !== "member" && <Badge>{m.role}</Badge>}</span>
          <span className="row" style={{ gap: 4 }}>
            {info.myRole === "owner" && m.id !== me && m.role !== "owner" && <button className="btn sm ghost" onClick={() => act(() => api("PATCH", `/api/rooms/${info.id}/members/${m.id}`, { role: m.role === "admin" ? "member" : "admin" }))}>{m.role === "admin" ? "Remove admin" : "Make admin"}</button>}
            {info.canManage && m.id !== me && m.role !== "owner" && <button className="btn sm ghost" onClick={() => act(() => api("DELETE", `/api/rooms/${info.id}/members/${m.id}`))}>Remove</button>}
            {m.id !== me && <button className="btn sm ghost" onClick={async () => { const r = await api("POST", "/api/rooms/dm", { userId: m.id }); onClose(); navigate(`community/${r.id}`); }}>Message</button>}
          </span>
        </div>
      ))}</div>
      {canAdd && <><div className="small muted">Add people</div><PeoplePicker value={add} onChange={setAdd} />{add.length > 0 && <button className="btn primary" onClick={() => act(async () => { await api("POST", `/api/rooms/${info.id}/members`, { userIds: add.map((p) => p.id) }); setAdd([]); })}>Add {add.length}</button>}</>}
      {info.myRole && <button className="btn sm ghost" onClick={() => { if (confirm(`Leave ${info.name}?`)) act(async () => { await api("DELETE", `/api/rooms/${info.id}/members/${me}`); onClose(); navigate("community"); }); }}>Leave</button>}
      {msg && <div className="note warn">{msg}</div>}
    </Modal>
  );
}

function RoomSettings({ info, onClose, onChanged }) {
  const [name, setName] = useState(info.name || "");
  const [desc, setDesc] = useState(info.description || "");
  const [vis, setVis] = useState(info.visibility);
  const [msg, setMsg] = useState(null);
  const save = async () => { try { await api("PATCH", `/api/rooms/${info.id}`, { name, description: desc, visibility: vis }); await onChanged(false); onClose(); } catch (e) { setMsg(e.message); } };
  const del = async () => { if (!confirm(`Delete ${info.name} and every message in it? This cannot be undone.`)) return; try { await api("DELETE", `/api/rooms/${info.id}`); onClose(); await onChanged(true); } catch (e) { setMsg(e.message); } };
  return (
    <Modal title={`Settings: ${info.name}`} onClose={onClose}>
      <label className="stack" style={{ gap: 4 }}><span className="small muted">Name</span><input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></label>
      <label className="stack" style={{ gap: 4 }}><span className="small muted">Description</span><textarea rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={500} /></label>
      {info.kind !== "group" && <label className="row" style={{ gap: 8 }}><span className="small muted">Who can find and read it</span><select value={vis} onChange={(e) => setVis(e.target.value)}><option value="public">Everyone on XRayDar</option><option value="private">Only invited people</option></select></label>}
      <div className="row between"><button className="btn sm ghost" onClick={del} disabled={info.myRole !== "owner"} title={info.myRole !== "owner" ? "Only the owner can delete it" : ""}>Delete</button><button className="btn primary" onClick={save}>Save</button></div>
      {msg && <div className="note warn">{msg}</div>}
    </Modal>
  );
}

// ---------------------------------------------------------------- the page
function NewConversation({ kind, onClose, onCreated }) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [vis, setVis] = useState("public");
  const [people, setPeople] = useState([]);
  const [msg, setMsg] = useState(null);
  const create = async () => {
    try {
      if (kind === "dm") { if (!people[0]) { setMsg("Choose a person."); return; } onCreated(await api("POST", "/api/rooms/dm", { userId: people[0].id })); return; }
      onCreated(await api("POST", "/api/rooms", { kind, name, description: desc, visibility: vis, members: people.map((p) => p.id) }));
    } catch (e) { setMsg(e.message); }
  };
  const title = { room: "New chat room", board: "New message board", group: "New group chat", dm: "New direct message" }[kind];
  return (
    <Modal title={title} onClose={onClose}>
      {kind !== "dm" && <label className="stack" style={{ gap: 4 }}><span className="small muted">Name</span><input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus /></label>}
      {(kind === "room" || kind === "board") && <>
        <label className="stack" style={{ gap: 4 }}><span className="small muted">What is it about? (optional)</span><input value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={500} /></label>
        <label className="row" style={{ gap: 8 }}><span className="small muted">Who can find and read it</span><select value={vis} onChange={(e) => setVis(e.target.value)}><option value="public">Everyone on XRayDar</option><option value="private">Only invited people</option></select></label>
      </>}
      <div className="small muted">{kind === "dm" ? "Who do you want to message?" : "Invite people (optional)"}</div>
      <PeoplePicker value={kind === "dm" ? people.slice(0, 1) : people} onChange={(v) => setPeople(kind === "dm" ? v.slice(-1) : v)} />
      <div className="row" style={{ justifyContent: "flex-end" }}><button className="btn primary" onClick={create}>{kind === "dm" ? "Open conversation" : "Create"}</button></div>
      {msg && <div className="note warn">{msg}</div>}
    </Modal>
  );
}

export default function Community() {
  const acct = useAccount();
  const route = useRoute();
  const roomId = route.args[0] || null;
  const threadId = route.args[1] ? Number(route.args[1]) : null;
  const browse = route.query.browse || null;
  const [rooms, setRooms] = useState(null);
  const [pub, setPub] = useState(null);
  const [err, setErr] = useState(null);
  const [creating, setCreating] = useState(null);
  const [filter, setFilter] = useState("");
  const refresh = useCallback(() => api("GET", "/api/rooms").then(setRooms).catch((e) => setErr(e.message)), []);
  useEffect(() => { if (acct.me) { refresh(); const t = setInterval(() => { if (!document.hidden) refresh(); }, 15_000); return () => clearInterval(t); } return undefined; }, [acct.me, refresh]);
  useEffect(() => { if (browse && acct.me) api("GET", `/api/rooms/public?kind=${browse}`).then(setPub).catch((e) => setErr(e.message)); }, [browse, acct.me]);

  if (!SERVER_ON || !acct.me) return <><PageHead title="Community & chat" /><Empty>Sign in to join rooms, boards and chats.</Empty></>;
  const me = acct.me.id;
  const groups = [["room", "Rooms"], ["board", "Boards"], ["group", "Groups"], ["dm", "Direct messages"]];
  const visible = (rooms || []).filter((r) => !filter || (r.name || "").toLowerCase().includes(filter.toLowerCase()));
  return (
    <>
      <PageHead title="Community & chat" sub="Discuss markets in rooms and on boards, chat one-to-one or in groups, and share charts, screens, watchlists and files." />
      {err && <div className="note warn">{err}</div>}
      <div className="community">
        <aside className="conv-list card">
          <input placeholder="Find a conversation…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <div className="row wrap" style={{ gap: 4 }}>
            <button className="btn sm" onClick={() => setCreating("dm")}>+ Message</button>
            <button className="btn sm" onClick={() => setCreating("group")}>+ Group</button>
            <button className="btn sm" onClick={() => setCreating("room")}>+ Room</button>
            <button className="btn sm" onClick={() => setCreating("board")}>+ Board</button>
          </div>
          <div className="row" style={{ gap: 4 }}><a className="btn sm ghost" href={href("community", { browse: "room" })}>Browse rooms</a><a className="btn sm ghost" href={href("community", { browse: "board" })}>Browse boards</a></div>
          {!rooms ? <div className="small muted">Loading…</div> : groups.map(([k, label]) => {
            const list = visible.filter((r) => r.kind === k);
            if (!list.length) return null;
            return (
              <div key={k} className="stack" style={{ gap: 2 }}>
                <div className="g small muted">{label}</div>
                {list.map((r) => (
                  <a key={r.id} href={href(`community/${r.id}`)} className={`conv-item ${r.id === roomId ? "active" : ""}`}>
                    <span className="row between"><b>{r.name}</b>{r.unread > 0 && <span className="unread">{r.unread}</span>}</span>
                    {r.last && <span className="small muted ellipsis">{r.last.by ? `${r.last.by}: ` : ""}{r.last.body}</span>}
                  </a>
                ))}
              </div>
            );
          })}
          {rooms && !rooms.length && <div className="small muted">No conversations yet. Start one above, or browse public rooms and boards.</div>}
        </aside>
        <section className="conv-pane card">
          {browse && !roomId ? (
            <div className="stack">
              <div className="row between"><b>Public {browse === "board" ? "boards" : "rooms"}</b><a className="btn sm ghost" href={href("community")}>Close</a></div>
              {!pub ? <Empty>Loading…</Empty> : !pub.length ? <Empty>None yet. Create the first one.</Empty> : pub.map((r) => (
                <div key={r.id} className="row between conv-browse">
                  <span><b>{r.name}</b> <span className="small muted">{r.members} {r.members === 1 ? "member" : "members"}{r.description ? ` · ${r.description}` : ""}</span></span>
                  <span className="row" style={{ gap: 4 }}><a className="btn sm" href={href(`community/${r.id}`)}>Open</a>{!r.myRole && <button className="btn sm primary" onClick={async () => { await api("POST", `/api/rooms/${r.id}/join`); refresh(); navigate(`community/${r.id}`); }}>Join</button>}</span>
                </div>
              ))}
            </div>
          ) : roomId ? <Conversation key={roomId} roomId={roomId} threadId={threadId} me={me} onChanged={refresh} />
            : <Empty>Choose a conversation, or start a new one.</Empty>}
        </section>
      </div>
      {creating && <NewConversation kind={creating} onClose={() => setCreating(null)} onCreated={(r) => { setCreating(null); refresh(); navigate(`community/${r.id}`); }} />}
    </>
  );
}
