// Shared items (a tab inside Community & chat): what other people share with me or with everyone, and what I share.
// A shared item can be previewed and saved into my own workspace as a copy.
import { useEffect, useState } from "react";
import { api, SERVER_ON } from "../lib/server.js";
import { useAccount } from "../components/Account.jsx";
import { Tabs, Empty, Badge } from "../components/ui.jsx";
import { ShareDialog, Modal } from "../components/Share.jsx";
import { SHARE_KINDS, VIS_LABEL, saveCopy, fmtWhen } from "../lib/community.js";
import { useData } from "../data/store.jsx";

export function ItemPreview({ kind, payload }) {
  const d = useData();
  const sym = (id) => d.secById?.get(String(id))?.symbol || String(id);
  if (payload == null) return <div className="small muted">Empty.</div>;
  if (kind === "watchlists" && Array.isArray(payload.ids)) {
    return <div className="stack" style={{ gap: 4 }}><div className="small muted">{payload.ids.length} instruments</div><div className="row wrap" style={{ gap: 4 }}>{payload.ids.slice(0, 200).map((id) => <a key={id} className="chip" href={`#/stock/${encodeURIComponent(id)}`}>{sym(id)}</a>)}</div></div>;
  }
  if (kind === "notes") return <div style={{ whiteSpace: "pre-wrap" }}>{payload.label ? <b>{payload.label}: </b> : null}{payload.text}</div>;
  if (kind === "screens" && Array.isArray(payload.conditions)) {
    return <div className="stack" style={{ gap: 4 }}>{payload.conditions.map((c, i) => <div key={i} className="mono small">{[c.field, c.op, c.value ?? c.value2 ?? ""].join(" ")}</div>)}{!payload.conditions.length && <div className="small muted">No conditions.</div>}</div>;
  }
  if (kind === "customIndicators" && (payload.expr || payload.formula)) return <pre className="mono small" style={{ whiteSpace: "pre-wrap" }}>{payload.expr || payload.formula}</pre>;
  return <pre className="mono small" style={{ whiteSpace: "pre-wrap", maxHeight: 320, overflow: "auto" }}>{JSON.stringify(payload, null, 2).slice(0, 6000)}</pre>;
}

export function SharedItems() {
  const acct = useAccount();
  const [tab, setTab] = useState("all");
  const [kind, setKind] = useState("");
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState(null);
  const [edit, setEdit] = useState(null);
  const [msg, setMsg] = useState(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!SERVER_ON || !acct.me) return;
    setRows(null); setErr(null);
    const path = tab === "mine" ? "/api/shares/mine" : `/api/shares?scope=${tab}${kind ? `&kind=${encodeURIComponent(kind)}` : ""}`;
    api("GET", path).then((r) => setRows(kind && tab === "mine" ? r.filter((x) => x.kind === kind) : r)).catch((e) => setErr(e.message));
  }, [tab, kind, acct.me, n]);
  const openItem = async (r) => { try { setOpen(await api("GET", `/api/shares/${r.id}`)); } catch (e) { setMsg(e.message); } };
  const copy = (s) => { const out = saveCopy(s.kind, s.payload, s.owner?.name, s.sourceItem); if (out) setMsg(`${out} You can find it where you keep your ${(SHARE_KINDS[s.kind] || "items").toLowerCase()}s.`); };

  if (!SERVER_ON || !acct.me) return <Empty>Sign in to see what people share.</Empty>;
  return (
    <>
      <div className="small muted" style={{ marginBottom: 6 }}>Watchlists, screens, formulas, notes, layouts and settings people share. Save a copy into your own workspace, or manage what you share.</div>
      <div className="row wrap" style={{ gap: 8, marginBottom: 8 }}>
        <Tabs value={tab} onChange={setTab} tabs={[{ value: "all", label: "Everything I can see" }, { value: "with-me", label: "Shared with me" }, { value: "everyone", label: "Shared with everyone" }, { value: "mine", label: "My shares" }]} />
        <select value={kind} onChange={(e) => setKind(e.target.value)}><option value="">All kinds</option>{Object.entries(SHARE_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      </div>
      {msg && <div className="note" role="status">{msg} <button className="btn sm ghost" onClick={() => setMsg(null)}>✕</button></div>}
      {err && <div className="note warn">{err}</div>}
      {!rows ? <Empty>Loading…</Empty> : !rows.length ? (
        <Empty>{tab === "mine" ? "You are not sharing anything yet. Use the ⇪ Share button next to a watchlist, saved screen, formula, note or layout." : "Nothing shared here yet."}</Empty>
      ) : (
        <div className="lib-grid">
          {rows.map((r) => (
            <div key={r.id} className="card stack lib-card">
              <div className="row between"><Badge>{r.kindLabel}</Badge><span className="small muted">{fmtWhen(r.updatedAt)}</span></div>
              <b>{r.title}</b>
              <div className="small muted">{r.mine ? <>Visible to: {VIS_LABEL[r.visibility]}{r.visibility === "people" && r.people?.length ? ` (${r.people.map((p) => p.name).join(", ")})` : ""}</> : <>Shared by {r.owner.name} · {VIS_LABEL[r.visibility]}</>}</div>
              <div className="row" style={{ gap: 6 }}>
                {r.mine ? <button className="btn sm" onClick={() => setEdit(r)}>Change who sees it</button> : <><button className="btn sm" onClick={() => openItem(r)}>Open</button><button className="btn sm primary" onClick={async () => copy(await api("GET", `/api/shares/${r.id}`))}>Save a copy</button></>}
              </div>
            </div>
          ))}
        </div>
      )}
      {open && (
        <Modal title={`${open.kindLabel}: ${open.title}`} onClose={() => setOpen(null)} width={640}>
          <div className="small muted">Shared by {open.owner.name} · updated {fmtWhen(open.updatedAt)}</div>
          <ItemPreview kind={open.kind} payload={open.payload} />
          <div className="row" style={{ justifyContent: "flex-end" }}><button className="btn primary" onClick={() => copy(open)}>Save a copy to my workspace</button></div>
        </Modal>
      )}
      {edit && <ShareDialog sourceKey={edit.sourceKey} item={edit.sourceItem} title={edit.title} onClose={() => { setEdit(null); setN((x) => x + 1); }} />}
    </>
  );
}
