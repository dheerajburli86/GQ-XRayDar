// "Send to chat" for any screen (Shankar Sir: share charts and everything while on the app). Takes a picture of
// what is on screen and posts it, with a link that opens the same view, to a room, group or person.
import { useEffect, useState } from "react";
import { api, SERVER_ON } from "../lib/server.js";
import { useAccount } from "./Account.jsx";
import { Modal, PeoplePicker } from "./Share.jsx";
import { uploadFile } from "../lib/community.js";
import { pagePicture } from "../lib/pagePicture.js";
import { navigate } from "../lib/router.js";

export function SendToChatButton({ title }) {
  const acct = useAccount();
  const [open, setOpen] = useState(false);
  if (!SERVER_ON || !acct.me) return null;
  return (
    <>
      <button className="btn sm" data-html2canvas-ignore onClick={() => setOpen(true)} title="Send a picture of this screen, with a link to it, to a chat">💬 Send</button>
      {open && <SendDialog title={title} onClose={() => setOpen(false)} />}
    </>
  );
}

function SendDialog({ title, onClose }) {
  const [rooms, setRooms] = useState(null);
  const [to, setTo] = useState(null); // room id
  const [person, setPerson] = useState([]);
  const [note, setNote] = useState("");
  const [withPic, setWithPic] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [done, setDone] = useState(null);
  useEffect(() => { api("GET", "/api/rooms").then(setRooms).catch((e) => setMsg(e.message)); }, []);
  const send = async () => {
    setBusy(true); setMsg(null);
    try {
      let roomId = to;
      if (!roomId && person[0]) roomId = (await api("POST", "/api/rooms/dm", { userId: person[0].id })).id;
      if (!roomId) throw new Error("Choose where to send it.");
      const link = window.location.hash || "#/home";
      const attachments = [{ type: "link", url: link, title: title || "Open this view" }];
      if (withPic) {
        const el = document.querySelector(".content");
        if (el) {
          const canvas = await pagePicture(el, { title: title || "GQ XRayDar", subtitle: new Date().toLocaleString() });
          const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
          if (blob && blob.size <= 10 * 1024 * 1024) {
            const up = await uploadFile(roomId, blob, `${(title || "screen").replace(/[^\w.-]+/g, "_").slice(0, 60)}.png`);
            attachments.unshift({ type: "file", fileId: up.id, name: up.name, mime: up.mime, size: up.size });
          }
        }
      }
      await api("POST", `/api/rooms/${roomId}/messages`, { body: note, attachments });
      setDone(roomId);
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  };
  if (done) {
    return (
      <Modal title="Sent" onClose={onClose}>
        <div className="note">Sent.</div>
        <div className="row" style={{ justifyContent: "flex-end", gap: 6 }}><button className="btn" onClick={onClose}>Stay here</button><button className="btn primary" onClick={() => { onClose(); navigate(`community/${done}`); }}>Open the chat</button></div>
      </Modal>
    );
  }
  const list = (rooms || []).filter((r) => r.kind !== "board");
  return (
    <Modal title={`Send to a chat: ${title || "this screen"}`} onClose={onClose}>
      <div className="small muted">To a conversation you are in</div>
      <div className="qt-list" style={{ maxHeight: 200 }}>
        {!rooms ? <div className="small muted" style={{ padding: 8 }}>Loading…</div> : !list.length ? <div className="small muted" style={{ padding: 8 }}>No conversations yet; choose a person below.</div>
          : list.map((r) => <div key={r.id} className={`it ${to === r.id ? "on" : ""}`} onMouseDown={() => { setTo(r.id); setPerson([]); }}><span>{r.name}</span><span className="small muted">{{ room: "room", group: "group", dm: "direct" }[r.kind]}</span></div>)}
      </div>
      <div className="small muted">…or to a person</div>
      <PeoplePicker value={person} onChange={(v) => { setPerson(v.slice(-1)); setTo(null); }} />
      <textarea rows={2} placeholder="Add a note (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={8000} />
      <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={withPic} onChange={(e) => setWithPic(e.target.checked)} /> Include a picture of the screen</label>
      <div className="row" style={{ justifyContent: "flex-end" }}><button className="btn primary" onClick={send} disabled={busy || (!to && !person[0])}>{busy ? "Sending…" : "Send"}</button></div>
      {msg && <div className="note warn">{msg}</div>}
    </Modal>
  );
}
