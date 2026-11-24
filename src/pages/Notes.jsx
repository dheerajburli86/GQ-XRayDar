// Research notes attached to stocks, sectors, countries or indices.
import { useMemo, useState } from "react";
import { useData } from "../data/store.jsx";
import { PageHead, Select } from "../components/ui.jsx";
import { DataTable } from "../components/DataTable.jsx";
import { usePersistent, uid } from "../lib/storage.js";
import { href } from "../lib/router.js";
import { ShareButton } from "../components/Share.jsx";

export function useNotes() { return usePersistent("notes", []); }

export function NoteBox({ target, label }) {
  const [notes, setNotes] = useNotes();
  const [text, setText] = useState("");
  const mine = notes.filter((n) => n.target === target);
  return (
    <div className="stack" style={{ gap: 6 }}>
      {mine.map((n) => <div key={n.id} className="note"><div className="small muted">{new Date(n.at).toLocaleString()}</div>{n.text}<ShareButton sourceKey="notes" item={n.id} title={n.label ? `${n.label}: ${n.text.slice(0, 40)}` : n.text.slice(0, 50)} label="" /><button className="btn sm ghost" onClick={() => setNotes(notes.filter((x) => x.id !== n.id))}>✕</button></div>)}
      <textarea className="notes" placeholder={`Add an observation about ${label}…`} value={text} onChange={(e) => setText(e.target.value)} />
      <div><button className="btn sm primary" disabled={!text.trim()} onClick={() => { setNotes([{ id: uid(), target, label, text: text.trim(), at: new Date().toISOString() }, ...notes]); setText(""); }}>Save note</button></div>
    </div>
  );
}

export default function Notes() {
  const d = useData();
  const [notes, setNotes] = useNotes();
  const [kind, setKind] = useState("sector");
  const [val, setVal] = useState(null);
  const [text, setText] = useState("");
  const opts = kind === "sector" ? d.sectors : kind === "country" ? d.countries : kind === "region" ? d.regions : d.indices.filter((i) => i.family === "CW" && !i.cap).slice(0, 500).map((i) => ({ value: i.key, label: i.name }));
  const rows = useMemo(() => notes.map((n) => ({ ...n })), [notes]);
  const link = (n) => (n.target.startsWith("sec:") ? href(`stock/${n.target.slice(4)}`) : n.target.startsWith("index:") ? href("indices", { key: n.target.slice(6) }) : null);
  return (
    <div className="stack">
      <PageHead title="Research notes" sub="Observations attached to stocks (from the stock page), sectors, countries, regions or indices. Exportable." />
      <div className="card row">
        <Select label="Attach to" value={kind} options={["sector", "country", "region", "index"]} onChange={setKind} />
        <Select value={val} options={opts} onChange={setVal} allowEmpty="—" />
        <input style={{ flex: 1 }} placeholder="Observation…" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn sm primary" disabled={!val || !text.trim()} onClick={() => { setNotes([{ id: uid(), target: `${kind}:${val}`, label: kind === "index" ? d.indexByKey.get(val)?.name : val, text: text.trim(), at: new Date().toISOString() }, ...notes]); setText(""); }}>Save</button>
      </div>
      <DataTable exportName="research_notes" rows={rows} initialSort={{ key: "at", dir: "desc" }}
        columns={[{ key: "at", label: "When", value: (n) => n.at, render: (n) => new Date(n.at).toLocaleString() }, { key: "t", label: "About", value: (n) => n.label, render: (n) => (link(n) ? <a href={link(n)}>{n.label}</a> : n.label) },
          { key: "k", label: "Type", value: (n) => n.target.split(":")[0] }, { key: "x", label: "Note", value: (n) => n.text, render: (n) => <span style={{ whiteSpace: "normal" }}>{n.text}</span> },
          { key: "del", label: "", value: () => null, export: false, render: (n) => <span className="row" style={{ gap: 4 }}><ShareButton sourceKey="notes" item={n.id} title={n.label ? `${n.label}: ${n.text.slice(0, 40)}` : n.text.slice(0, 50)} label="" /><button className="btn sm ghost" onClick={() => setNotes(notes.filter((x) => x.id !== n.id))}>✕</button></span> }]} />
    </div>
  );
}
