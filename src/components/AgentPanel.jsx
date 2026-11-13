// GQ Agent, docked on every page (features 4.1-4.9). With the server connected
// the question goes to the GQ agent (the same one as on Telegram: news, web,
// alerts and tasks); otherwise the built-in assistant answers from stored data.
// The page the person is on is sent along, so "this chart" means that chart.
import { useEffect, useRef, useState } from "react";
import { useData } from "../data/store.jsx";
import { useAccount } from "./Account.jsx";
import { api } from "../lib/server.js";
import { answer } from "../../engine/assistant.js";
import { href } from "../lib/router.js";
import { usePersistent } from "../lib/storage.js";

let pageContext = null;
/** Pages call this with what is on screen: {page, instrumentId, symbol, tf, view}. */
export const setAgentContext = (c) => { pageContext = c; };
export const openAgent = (question, context) => window.dispatchEvent(new CustomEvent("gqta-agent", { detail: { question, context } }));

function Blocks({ blocks }) {
  return blocks.map((b, k) => b.kind === "text" ? <p key={k}>{b.text}</p>
    : b.kind === "list" ? <ul key={k}>{b.items.map((x, j) => <li key={j}>{x}</li>)}</ul>
      : <a key={k} className="btn sm" href={href(b.to.split("?")[0], Object.fromEntries(new URLSearchParams(b.to.split("?")[1] || "")))}>{b.label} →</a>);
}

function Rich({ text }) {
  // the agent writes light markdown: **bold**, bullets and links
  const parts = String(text || "").split("\n");
  return parts.map((line, i) => {
    const html = line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
      .replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noreferrer">$2</a>');
    return <p key={i} style={{ margin: line.trim() ? "3px 0" : "8px 0" }} dangerouslySetInnerHTML={{ __html: html.replace(/^\s*[-•*]\s+/, "• ") }} />;
  });
}

export function AgentPanel() {
  const d = useData();
  const acct = useAccount();
  const [open, setOpen] = useState(false);
  const [hist, setHist] = usePersistent("agent.history", []);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);
  const viaAgent = acct.serverOn && acct.me;

  const ask = async (text, ctx = pageContext) => {
    if (!text.trim() || busy) return;
    setBusy(true); setQ("");
    const entry = { q: text, at: new Date().toISOString(), ctx: ctx?.symbol || null };
    try {
      if (viaAgent) {
        const history = hist.slice(-5).flatMap((h) => [{ role: "user", content: h.q }, { role: "assistant", content: h.text || (h.blocks || []).map((b) => b.text || (b.items || []).join("; ")).join("\n") }]);
        const r = await api("POST", "/api/agent/chat", { message: text, history, context: ctx });
        entry.source = r.source; entry.notice = r.notice;
        if (r.answer) entry.text = r.answer; else entry.blocks = r.blocks;
      } else {
        const t = ctx?.symbol && !/\b[A-Z]{2,}\b/.test(text) ? `${text} ${ctx.symbol}` : text;
        const r = await answer(t, d);
        entry.blocks = r.blocks; entry.source = "built-in";
      }
    } catch (e) { entry.blocks = [{ kind: "text", text: `Could not answer: ${e.message}` }]; }
    setHist((h) => [...h.slice(-40), entry]);
    setBusy(false);
  };

  useEffect(() => {
    const h = (e) => { setOpen(true); if (e.detail?.question) ask(e.detail.question, e.detail.context || pageContext); };
    window.addEventListener("gqta-agent", h);
    return () => window.removeEventListener("gqta-agent", h);
  });
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [hist, open, busy]);
  useEffect(() => { document.body.classList.toggle("agent-open", open); }, [open]);

  if (!open) return <button className="agent-fab" onClick={() => setOpen(true)} title="Ask the GQ Agent">✦ GQ Agent</button>;
  return (
    <aside className="agent-panel card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <b>✦ GQ Agent</b>
        <div className="row">
          <span className="small muted" title={viaAgent ? "Same agent as on Telegram: stored analysis, news and the web" : "Built-in assistant: stored calculations only"}>{viaAgent ? "connected" : "stored data only"}</span>
          <button className="btn sm ghost" onClick={() => setHist([])} title="Clear">⌫</button>
          <button className="btn sm ghost" onClick={() => setOpen(false)}>✕</button>
        </div>
      </div>
      {pageContext?.symbol && <div className="small muted">Looking at: <b>{pageContext.symbol}</b>{pageContext.tf ? ` · ${pageContext.tf}` : ""}{pageContext.view ? ` · ${pageContext.view}` : ""}</div>}
      <div className="agent-log">
        {hist.length === 0 && (
          <div className="small muted stack" style={{ gap: 4 }}>
            <div>Ask in plain English. It explains what the data shows and never says buy, sell or hold.</div>
            {[pageContext?.symbol ? `Explain this chart` : `Is ${d.rows[0]?.sec.symbol} rising on both daily and weekly?`, "Which sectors are leading in India?", "Compare TCS and INFY", viaAgent ? "Why did this stock move today?" : "Market breadth in the US"].map((s) => <a key={s} onClick={() => ask(s)} style={{ cursor: "pointer" }}>→ {s}</a>)}
          </div>
        )}
        {hist.map((m, i) => (
          <div key={i} className="stack" style={{ gap: 4 }}>
            <div className="msg user">{m.q}{m.ctx ? <span className="small muted"> · {m.ctx}</span> : null}</div>
            <div className="msg bot">{m.notice && <div className="small muted">{m.notice}</div>}{m.text ? <Rich text={m.text} /> : <Blocks blocks={m.blocks || []} />}</div>
          </div>
        ))}
        {busy && <div className="msg bot muted">Thinking…</div>}
        <div ref={endRef} />
      </div>
      <div className="row">
        <input style={{ flex: 1 }} value={q} placeholder={pageContext?.symbol ? `Ask about ${pageContext.symbol}…` : "Ask anything…"} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask(q)} disabled={busy} />
        <button className="btn primary" onClick={() => ask(q)} disabled={busy}>Ask</button>
      </div>
    </aside>
  );
}
