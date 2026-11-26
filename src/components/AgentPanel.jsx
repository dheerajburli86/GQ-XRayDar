// GQ Agent, docked on every page (features 4.1-4.9). With the server connected
// the question goes to the GQ agent (the same one as on Telegram: news, web,
// alerts and tasks); otherwise the built-in assistant answers from stored data.
// The page the person is on is sent along, so "this chart" means that chart.
import { useEffect, useRef, useState } from "react";
import { useData } from "../data/store.jsx";
import { useAccount } from "./Account.jsx";
import { api } from "../lib/server.js";
import { answer } from "../../engine/assistant.js";
import { parseCommand } from "../../engine/nl.js";
import { href, navigate } from "../lib/router.js";
import { parseChartIntent, applyChartIntent, linkToFollow } from "../lib/chartIntent.js";
import { load, save, uid } from "../lib/storage.js";
import { parseProjectionText, computeProjection } from "../../engine/projection.js";
import { formulaFromText } from "../../engine/formula.js";
import { aggregate } from "../../engine/indicators.js";
import { loadInstrument } from "../lib/series.js";

/**
 * Chart actions the agent does here in the app (owner's feature list): create a projection on
 * the chart being viewed, explain the projections on it, and create a custom indicator.
 * Returns blocks, or null when the request is not one of these.
 */
async function chartAction(text, ctx, d) {
  const t = text.trim();
  const id = ctx?.instrumentId, sym = ctx?.symbol;
  // "make it candlesticks", "open RSIMMA", "weekly and monthly": change the chart that is open, right here
  const intent = parseChartIntent(t);
  if (intent) {
    const go = applyChartIntent(intent, ctx);
    if (!go) return [{ kind: "text", text: ctx?.page ? "That change needs a stock chart open (Chart lab or an RSI / RSC screen)." : "Open a chart first, then tell me how to change it." }];
    if (go.style) save("chartlab", { ...load("chartlab", {}), style: go.style, ...(intent.tf ? { tf: intent.tf } : {}) });
    navigate(go.path, go.query);
    return [{ kind: "text", text: `Done: the open chart${sym ? ` (${sym})` : ""} now shows ${go.label}.` }];
  }
  if (/^(create|make|add|build)\b.*\b(indicator|formula)\b/i.test(t) || /^(indicator|formula)\s*[:=]/i.test(t)) {
    const f = formulaFromText(t);
    if (!f) return [{ kind: "text", text: "I could not turn that into a formula. Write it directly, e.g. \"create an indicator: ema(close, 10) - ema(close, 30)\", or describe a momentum, volatility, distance-from-EMA, new-high or volume-spike indicator." }];
    const list = load("customIndicators", []);
    save("customIndicators", [...list, { id: uid(), on: true, name: f.name, formula: f.formula, pane: "own", color: "#22d3ee" }]);
    return [{ kind: "text", text: `Added the indicator "${f.name}" = ${f.formula} (${f.understood}). It shows in the Chart lab under My formulas and can be switched off there.` }, { kind: "link", label: "Open the chart lab", to: id ? `chart/${id}` : "chart" }];
  }
  if (/^(project|projection)\b/i.test(t) || /\bproject (the )?price\b/i.test(t)) {
    if (!id) return [{ kind: "text", text: "Open a chart first (Chart lab), then ask again: the projection is made on the chart you are looking at." }];
    const r = parseProjectionText(t);
    const all = load("projections", {});
    const inst = await loadInstrument(d.api, { kind: "sec", id }, d);
    const tf = r.tf || ctx.tf || "D";
    const bars = inst ? aggregate({ ...inst, volume: inst.volume || inst.close.map(() => 0) }, tf) : null;
    const spec = { id: uid(), name: t.slice(0, 40), since: bars?.time.at(-1), ...r.spec };
    save("projections", { ...all, [id]: [...(all[id] || []), spec] });
    const res = bars ? computeProjection(bars, spec, tf) : null;
    return [{ kind: "text", text: `Projection added to ${sym}: ${r.understood.join(" · ")}.${res ? ` ${res.statusText}; method: ${res.methodNote}.` : ""}${r.tf && ctx.tf && r.tf !== ctx.tf ? ` It is set on ${r.tf} candles; switch the chart to ${r.tf} to see it there.` : ""}` }, { kind: "link", label: "See it on the chart", to: `chart/${id}` }];
  }
  if (/\b(explain|status of|show)\b.*\bprojections?\b/i.test(t)) {
    if (!id) return [{ kind: "text", text: "Open the chart whose projections you want explained." }];
    const list = load("projections", {})[id] || [];
    if (!list.length) return [{ kind: "text", text: `There are no projections on ${sym}.` }];
    const inst = await loadInstrument(d.api, { kind: "sec", id }, d);
    const bars = aggregate({ ...inst, volume: inst.volume || inst.close.map(() => 0) }, ctx.tf || "D");
    return [{ kind: "list", items: list.map((p) => { const r = computeProjection(bars, p, ctx.tf || "D"); return `${p.name}: ${r.statusText}. Method: ${r.methodNote}.${r.stats ? ` ${r.stats.cases} past cases, ${Math.round(r.stats.hitRate * 100)}% went the projected way.` : ""}`; }) }];
  }
  return null;
}

let pageContext = null;
/** Pages call this with what is on screen: {page, instrumentId, symbol, tf, view}. */
export const setAgentContext = (c) => { pageContext = c; };
export const openAgent = (question, context) => window.dispatchEvent(new CustomEvent("gqta-agent", { detail: { question, context } }));

function Blocks({ blocks }) {
  return blocks.map((b, k) => b.kind === "text" ? <p key={k}>{b.text}</p>
    : b.kind === "list" ? <ul key={k}>{b.items.map((x, j) => <li key={j}>{x}</li>)}</ul>
      : <a key={k} className="btn sm" href={href(b.to.split("?")[0], Object.fromEntries(new URLSearchParams(b.to.split("?")[1] || "")))}>{b.label} →</a>);
}

// a link into this app (the agent's chart links) opens here, in place; anything else opens a new tab
const aTag = (url, label) => {
  const own = typeof window !== "undefined" && url.startsWith(`${window.location.origin}/#/`);
  return own ? `<a href="${url.slice(window.location.origin.length + 1)}">${label}</a>` : `<a href="${url}" target="_blank" rel="noreferrer">${label}</a>`;
};
const inline = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
  .replace(/`([^`]+)`/g, "<code>$1</code>")
  .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (_m, label, url) => aTag(url, label))
  .replace(/(^|\s)(https?:\/\/[^\s<]+)/g, (_m, pre, url) => pre + aTag(url, url));
const cells = (line) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

function Rich({ text }) {
  // the agent writes markdown: **bold**, `code`, links, bullets, numbered lists, ### headings, tables, code fences
  const lines = String(text || "").split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      const code = [];
      while (++i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i]);
      out.push(<pre key={i} className="small" style={{ whiteSpace: "pre-wrap", margin: "6px 0" }}>{code.join("\n")}</pre>);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] || "")) {
      const head = cells(line); const rows = [];
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      i--;
      out.push(<div key={i} style={{ overflowX: "auto", margin: "6px 0" }}><table className="tbl small"><thead><tr>{head.map((h, j) => <th key={j} dangerouslySetInnerHTML={{ __html: inline(h) }} />)}</tr></thead>
        <tbody>{rows.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j} dangerouslySetInnerHTML={{ __html: inline(c) }} />)}</tr>)}</tbody></table></div>);
      continue;
    }
    const h = /^\s*#{1,6}\s+(.*)$/.exec(line);
    if (h) { out.push(<p key={i} style={{ margin: "8px 0 3px" }}><b dangerouslySetInnerHTML={{ __html: inline(h[1]) }} /></p>); continue; }
    const html = inline(line).replace(/^\s*[-•*]\s+/, "• ");
    out.push(<p key={i} style={{ margin: line.trim() ? "3px 0" : "8px 0" }} dangerouslySetInnerHTML={{ __html: html }} />);
  }
  return out;
}

// What the agent is doing while a question is open: steps that match how it works, and a seconds counter,
// so a 10-40 s answer reads as "busy" rather than "broken".
const STEPS = ["Reading your question", "Looking up the data", "Checking the numbers", "Writing the answer"];
function Working({ since, agent }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);
  const secs = Math.max(0, Math.floor((now - Date.parse(since)) / 1000));
  const step = agent ? STEPS[Math.min(STEPS.length - 1, Math.floor(secs / 5))] : "Looking up the stored data";
  return (
    <div className="msg bot agent-working" role="status" aria-live="polite">
      <span className="agent-dots"><i /><i /><i /></span>
      <span>{step}…</span>
      <span className="small muted" style={{ marginLeft: "auto" }}>{secs}s</span>
      {secs >= 20 && <div className="small muted" style={{ flexBasis: "100%" }}>Bigger questions can take up to a minute: the agent is reading the data and checking it.</div>}
    </div>
  );
}

export function AgentPanel() {
  const d = useData();
  const acct = useAccount();
  const [open, setOpen] = useState(false);
  const [hist, setHist] = useState([]); // clean slate every visit: never kept across opens or reloads
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);
  // Per person (Shankar Sir, 2026-11-24): the agent works only for accounts an admin switched it on for, and reads
  // only the sources chosen for them. With the server on, every question goes to it; the server decides.
  const access = acct.me?.agentAccess;
  const allowed = !acct.serverOn || !!(access?.enabled && access.sources?.length);
  const viaAgent = acct.serverOn && !!acct.me && allowed;

  const ask = async (text, ctx = null, fresh = false) => {
    if (!text.trim() || busy || !allowed) return;
    setBusy(true); setQ("");
    const entry = { q: text, at: new Date().toISOString(), ctx: ctx?.symbol || null };
    // the question shows at once, with a "working on it" line, so nobody thinks the panel swallowed it
    const pendingId = `${Date.now()}-${Math.random()}`;
    entry.id = pendingId;
    setHist((h) => [...(fresh ? [] : h).slice(-40), { ...entry, pending: true }]);
    try {
      const local = await chartAction(text, ctx || pageContext, d).catch((e) => [{ kind: "text", text: `Could not do that: ${e.message}` }]);
      // screens ("US stocks with market cap above $10B and technical score above 60") and "explain <ticker>" are
      // answered exactly from the stored data, here, instead of being paraphrased by the chat agent
      // Without the GQ agent, screens and "explain <ticker>" are answered from the stored data here. With the
      // agent connected, every question goes to it: it reads the same calculations through the app's server
      // (the xraydar tool) and understands the whole sentence, which the keyword parser cannot.
      const agentOn = viaAgent;
      const cmd = local || agentOn ? null : parseCommand(text, { securities: d.secs, countries: d.countries });
      const exact = cmd && ((cmd.intent === "screen" && cmd.conditions.length) || (cmd.intent === "explain" && cmd.securityId));
      if (local) { entry.blocks = local; entry.source = "built-in"; }
      else if (exact || !viaAgent) {
        const r = await answer(text, d);
        entry.blocks = r.blocks; entry.source = "built-in";
      } else if (viaAgent) {
        const history = (fresh ? [] : hist).filter((h) => !h.pending).slice(-5).flatMap((h) => [{ role: "user", content: h.q }, { role: "assistant", content: h.text || (h.blocks || []).map((b) => b.text || (b.items || []).join("; ")).join("\n") }]);
        const r = await api("POST", "/api/agent/chat", { message: text, history, context: ctx || pageContext });
        entry.source = r.source; entry.notice = r.notice;
        if (r.answer) entry.text = r.answer; else entry.blocks = r.blocks;
        // "open RELIANCE RSCMMA weekly": when the answer carries exactly one chart of this app, open it in place
        const follow = r.answer ? linkToFollow(text, r.answer, window.location.origin) : null;
        if (follow) { window.location.hash = `#/${follow}`; entry.notice = "Opened on screen."; }
      }
    } catch (e) { entry.blocks = [{ kind: "text", text: `Could not answer: ${e.message}` }]; }
    setHist((h) => h.map((m) => (m.id === pendingId ? entry : m)));
    setBusy(false);
  };

  useEffect(() => {
    const h = (e) => { const fresh = !open; if (fresh) setHist([]); setOpen(true); if (e.detail?.question) ask(e.detail.question, e.detail.context || null, fresh); };
    window.addEventListener("gqta-agent", h);
    return () => window.removeEventListener("gqta-agent", h);
  });
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [hist, open, busy]);
  useEffect(() => { document.body.classList.toggle("agent-open", open); }, [open]);

  if (!open) return <button className="agent-fab" onClick={() => { setHist([]); setQ(""); setOpen(true); }} title="Ask the GQ Agent">✦ GQ Agent</button>;
  return (
    <aside className="agent-panel card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <b>✦ GQ Agent</b>
        <div className="row">
          <span className="small muted" title={viaAgent ? `Your agent may use: ${(access?.sources || []).join(", ")}` : "Built-in assistant: stored calculations only"}>{!allowed ? "not enabled" : viaAgent ? "connected" : "stored data only"}</span>
          <button className="btn sm ghost" onClick={() => setHist([])} title="Clear">⌫</button>
          <button className="btn sm ghost" onClick={() => setOpen(false)}>✕</button>
        </div>
      </div>
      <div className="agent-log">
        {hist.length === 0 && (
          <div className="small muted stack" style={{ gap: 4 }}>
            <div>Ask in plain English. It explains what the data shows and never says buy, sell or hold.</div>
          </div>
        )}
        {hist.map((m, i) => (
          <div key={i} className="stack" style={{ gap: 4 }}>
            <div className="msg user">{m.q}{m.ctx ? <span className="small muted"> · {m.ctx}</span> : null}</div>
            {m.pending ? <Working since={m.at} agent={viaAgent} /> : <div className="msg bot">{m.notice && <div className="small muted">{m.notice}</div>}{m.text ? <Rich text={m.text} /> : <Blocks blocks={m.blocks || []} />}</div>}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      {acct.serverOn && !acct.me ? <div className="note">Checking your access…</div> : !allowed ? (
        <div className="note">The GQ Agent is not switched on for your account yet. An XRayDar admin can enable it and choose what it may read for you.</div>
      ) : <div className="row">
        <input style={{ flex: 1 }} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask(q)} disabled={busy} placeholder={busy ? "Working on your question…" : "Ask…"} />
        <button className="btn primary" onClick={() => ask(q)} disabled={busy}>{busy ? "…" : "Ask"}</button>
      </div>}
    </aside>
  );
}
