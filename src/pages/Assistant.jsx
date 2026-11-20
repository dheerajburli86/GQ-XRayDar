import { HIDE_VOICE } from "../lib/features.js";
import { useEffect, useRef, useState } from "react";
import { useData } from "../data/store.jsx";
import { PageHead, Badge } from "../components/ui.jsx";
import { answer } from "../lib/assistant.js";
import { href } from "../lib/router.js";
import { usePersistent } from "../lib/storage.js";

export default function Assistant({ route }) {
  const d = useData();
  const [history, setHistory] = usePersistent("assistant.history", []);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const ran = useRef(null);
  const ask = async (text) => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const a = await answer(text, d);
      setHistory((h) => [...h.slice(-30), { q: text, a: { blocks: a.blocks, understood: a.cmd.understood, intent: a.cmd.intent }, at: new Date().toISOString() }]);
    } catch (e) {
      setHistory((h) => [...h.slice(-30), { q: text, a: { blocks: [{ kind: "text", text: `Could not answer: ${e.message}` }], understood: [] } }]);
    } finally { setBusy(false); setQ(""); }
  };
  useEffect(() => {
    if (route.query.q && ran.current !== route.query.q) { ran.current = route.query.q; ask(route.query.q); }
    // runs once per incoming question; `ask` is intentionally not a dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.query.q]);
  const voice = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return alert("Voice input needs Chrome or Edge.");
    const r = new SR(); r.lang = "en-IN";
    r.onresult = (e) => { const t = e.results[0][0].transcript; setQ(t); ask(t); };
    r.onend = () => setListening(false);
    setListening(true); r.start();
  };
  return (
    <div className="stack">
      <PageHead title="Research assistant" sub="Ask in plain English (typed or spoken). Every answer is computed from the stored calculations and carries its dates and links; nothing is invented.">
        <button className="btn sm" onClick={() => setHistory([])}>Clear</button>
      </PageHead>
      <div className="chat">
        {history.map((m, i) => (
          <div key={i} className="stack" style={{ gap: 6 }}>
            <div className="msg user">{m.q}</div>
            <div className="msg bot">
              {m.a.understood?.length > 0 && <div className="row" style={{ marginBottom: 6 }}>{m.a.understood.map((u) => <Badge key={u}>{u}</Badge>)}</div>}
              {m.a.blocks.map((b, k) => b.kind === "text" ? <p key={k} style={{ margin: "4px 0" }}>{b.text}</p>
                : b.kind === "list" ? <ul key={k} style={{ margin: "4px 0", paddingLeft: 18 }}>{b.items.map((x, j) => <li key={j}>{x}</li>)}</ul>
                  : <a key={k} className="btn sm" style={{ marginRight: 6 }} href={href(b.to.split("?")[0], Object.fromEntries(new URLSearchParams(b.to.split("?")[1] || "")))}>{b.label} →</a>)}
            </div>
          </div>))}
      </div>
      <div className="row">
        <input style={{ flex: 1 }} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask(q)} placeholder="Ask about a stock, a screen, rotation, breadth or regime…" disabled={busy} />
        {!HIDE_VOICE && <button className={`btn ${listening ? "primary" : ""}`} onClick={voice}>🎙</button>}
        <button className="btn primary" onClick={() => ask(q)} disabled={busy}>{busy ? "…" : "Ask"}</button>
      </div>
    </div>
  );
}
