import { useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import { DataProvider, useData } from "./data/store.jsx";
import { useRoute, navigate, href } from "./lib/router.js";
import { parseCommand } from "../engine/nl.js";
import { Loading } from "./components/ui.jsx";
import { usePersistent } from "./lib/storage.js";
import { AccountProvider, useAccount } from "./components/Account.jsx";
import { AgentPanel } from "./components/AgentPanel.jsx";
import { resolveTheme, watchSystemTheme } from "./lib/theme.js";

const pages = {
  home: lazy(() => import("./pages/CommandCentre.jsx")),
  explorer: lazy(() => import("./pages/Explorer.jsx")),
  heatmap: lazy(() => import("./pages/Heatmap.jsx")),
  indices: lazy(() => import("./pages/Indices.jsx")),
  ewcw: lazy(() => import("./pages/EwCw.jsx")),
  ww: lazy(() => import("./pages/WeightWatcher.jsx")),
  screens: lazy(() => import("./pages/StackedScreens.jsx")),
  workspace: lazy(() => import("./pages/Workspace.jsx")),
  rs: lazy(() => import("./pages/RelativeStrength.jsx")),
  screener: lazy(() => import("./pages/Screener.jsx")),
  early: lazy(() => import("./pages/EarlyStage.jsx")),
  funnel: lazy(() => import("./pages/Funnel.jsx")),
  rotation: lazy(() => import("./pages/Rotation.jsx")),
  breadth: lazy(() => import("./pages/Breadth.jsx")),
  scores: lazy(() => import("./pages/Scores.jsx")),
  assistant: lazy(() => import("./pages/Assistant.jsx")),
  briefs: lazy(() => import("./pages/Briefs.jsx")),
  backtest: lazy(() => import("./pages/Backtest.jsx")),
  alerts: lazy(() => import("./pages/Alerts.jsx")),
  watchlists: lazy(() => import("./pages/Watchlists.jsx")),
  notes: lazy(() => import("./pages/Notes.jsx")),
  data: lazy(() => import("./pages/DataCentre.jsx")),
  stock: lazy(() => import("./pages/Stock.jsx")),
  chart: lazy(() => import("./pages/ChartLab.jsx")),
  scanners: lazy(() => import("./pages/Scanners.jsx")),
  tasks: lazy(() => import("./pages/Tasks.jsx")),
  paper: lazy(() => import("./pages/Paper.jsx")),
};

const NAV = [
  ["Overview", [["home", "◎", "Command centre"], ["explorer", "⇣", "Top-down explorer"], ["heatmap", "▦", "Heatmap"]]],
  ["Indices", [["indices", "≋", "CW / EW indices"], ["ewcw", "⇋", "EW vs CW (EWCW)"], ["ww", "◔", "Weight Watcher"]]],
  ["Charts", [["chart", "📈", "Chart lab"], ["screens/RSIACC", "∿", "RSIACC"], ["screens/RSCACC", "∿", "RSCACC"], ["screens/RSIMMA", "≡", "RSIMMA"], ["screens/RSCMMA", "≡", "RSCMMA"], ["workspace", "⊞", "Multi-chart workspace"]]],
  ["Discovery", [["scanners", "⌖", "Scanners"], ["rs", "↗", "Relative strength"], ["screener", "⚲", "Screener"], ["early", "◷", "Early-stage scanner"], ["funnel", "▽", "Opportunity funnel"], ["rotation", "↻", "Sector rotation"], ["breadth", "▥", "Market breadth"]]],
  ["Research", [["scores", "★", "AI setup scores"], ["assistant", "✦", "GQ Agent (full page)"], ["briefs", "✎", "Market briefs"], ["backtest", "⟲", "Backtest & patterns"]]],
  ["My work", [["alerts", "◉", "Alerts"], ["tasks", "☑", "Tasks"], ["watchlists", "☰", "Watchlists & portfolio"], ["paper", "◈", "Practice portfolio"], ["notes", "✐", "Research notes"]]],
  ["Data", [["data", "⛁", "Data centre"]]],
];

function CommandBar() {
  const d = useData();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const recRef = useRef(null);
  const sugg = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s || !d.secs) return [];
    const out = [];
    for (const x of d.secs) { if (x.symbol.toLowerCase().startsWith(s) || (s.length > 2 && (x.name || "").toLowerCase().includes(s))) out.push({ label: `${x.symbol} · ${x.name}`, sub: `${x.country} · ${x.sector}`, go: () => navigate(`stock/${x.id}`) }); if (out.length >= 7) break; }
    for (const c of d.countries || []) if (c.toLowerCase().startsWith(s)) out.push({ label: c, sub: "Country", go: () => navigate("explorer", { country: c }) });
    for (const [, items] of NAV) for (const [p, , l] of items) if (l.toLowerCase().includes(s)) out.push({ label: l, sub: "Page", go: () => navigate(p) });
    return out.slice(0, 12);
  }, [q, d.secs, d.countries]);

  const run = (text) => {
    const cmd = parseCommand(text, { securities: d.secs, countries: d.countries });
    setOpen(false);
    if (cmd.intent === "theme") { d.setSetting("theme", cmd.theme); return; }
    if (cmd.intent === "navigate") return navigate(cmd.page);
    if (cmd.intent === "chart") return navigate(`${cmd.page}/${cmd.securityId}`);
    if (cmd.intent === "stock") return navigate(`stock/${cmd.securityId}`);
    if (cmd.intent === "screen") return navigate("screener", { q: text });
    return navigate("assistant", { q: text });
  };

  const voice = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert("Voice commands need a browser with speech recognition (Chrome or Edge)."); return; }
    if (listening) { recRef.current?.stop(); return; }
    const r = new SR();
    r.lang = "en-IN"; r.interimResults = true; r.maxAlternatives = 1;
    r.onresult = (e) => { const t = Array.from(e.results).map((x) => x[0].transcript).join(" "); setQ(t); if (e.results[e.results.length - 1].isFinal) run(t); };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recRef.current = r; setListening(true); r.start();
  };

  return (
    <div className="cmd">
      <span className="ico">⌕</span>
      <input value={q} placeholder='Search or ask: "strongest weekly IT stocks with improving relative strength"'
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => { if (e.key === "Enter" && q.trim()) run(q.trim()); if (e.key === "Escape") setOpen(false); }} />
      <div className="btns">
        <button className={`btn sm ${listening ? "primary" : "ghost"}`} title="Voice command" onClick={voice}>{listening ? "● rec" : "🎙"}</button>
      </div>
      {open && q.trim() && (
        <div className="dropdown">
          <div className="hint">Enter runs it as a command · voice works the same way</div>
          <div className="it" onMouseDown={() => run(q.trim())}><span>Run: <b>{q}</b></span><span className="muted small">command</span></div>
          {sugg.map((s, i) => <div key={i} className="it" onMouseDown={() => { s.go(); setOpen(false); }}><span>{s.label}</span><span className="muted small">{s.sub}</span></div>)}
        </div>
      )}
    </div>
  );
}

function Shell() {
  const d = useData();
  const route = useRoute();
  const [collapsed, setCollapsed] = usePersistent("navCollapsed", typeof window !== "undefined" && window.innerWidth < 760);
  const acct = useAccount();
  useEffect(() => {
    const apply = () => { document.documentElement.dataset.theme = resolveTheme(d.settings.theme); };
    apply();
    return d.settings.theme === "system" ? watchSystemTheme(apply) : undefined;
  }, [d.settings.theme]);
  const Page = pages[route.page] || pages.home;
  const activeKey = route.page === "screens" ? `screens/${route.args[0] || "RSIMMA"}` : route.page;

  if (d.state.phase === "loading") {
    const p = d.state.progress;
    const pct = p?.phase === "indices" ? 10 + (p.done / p.total) * 40 : p?.phase === "signals" ? 55 + (p.done / p.total) * 40 : p?.phase === "analytics" || p?.phase === "weight_watcher" ? 96 : 5;
    return (
      <div className="loading-screen"><div className="box card">
        <div className="brand"><div className="logo">GQ</div><div><div className="t1">GQ AI-Powered Technical Analysis</div><div className="t2">{d.mode === "demo" ? "Building the demo universe with the full calculation engine…" : "Loading from Supabase…"}</div></div></div>
        <div className="progress" style={{ margin: "8px 0" }}><div style={{ width: `${pct}%` }} /></div>
        <div className="small muted">{p ? `${p.phase}${p.note ? ` · ${p.note}` : ""}` : "starting"}</div>
      </div></div>
    );
  }
  if (d.state.phase === "error") {
    return <div className="loading-screen"><div className="box card"><h2>Could not load data</h2><div className="note warn">{String(d.state.error?.message || d.state.error)}</div>
      <p className="small muted">Supabase mode reads the tas_* tables the calculation engine writes. See README → "Connect to the heatmap database".</p></div></div>;
  }

  return (
    <div className={`shell ${collapsed ? "collapsed" : ""}`}>
      <nav className="side">
        <div className="brand" onClick={() => setCollapsed(!collapsed)} style={{ cursor: "pointer" }} title="Collapse / expand">
          <div className="logo">GQ</div>
          <div className="bt"><div className="t1">GQ Technical Analysis</div><div className="t2">AI-powered · {d.mode === "demo" ? "demo data" : "live data"}</div></div>
        </div>
        {NAV.map(([g, items]) => (
          <div className="navgroup" key={g}>
            <div className="g">{g}</div>
            {items.map(([p, ic, l]) => <a key={p} href={href(p)} className={`navitem ${activeKey === p ? "active" : ""}`} title={l}><span className="ic">{ic}</span><span className="lbl">{l}</span></a>)}
          </div>
        ))}
      </nav>
      <div className="main">
        {d.mode === "demo" && <div className="banner demo"><b>DEMO DATA</b> Synthetic universe generated in your browser and run through the real calculation engine. Connect the heatmap Supabase database to see live markets (README).</div>}
        <div className="topbar">
          <CommandBar />
          <div className="grow" />
          <span className="small muted" title="Latest session in the data">As of <b className="mono">{d.info?.asOf}</b></span>
          <button className="btn sm" onClick={() => d.reload()} title="Reload the latest calculation run without reloading the page">↻</button>
          <div className="seg theme-seg" title="Appearance">
            {[["light", "☀", "Light"], ["dark", "☾", "Dark"], ["system", "Auto", "Same as device"]].map(([k, ic, l]) => <button key={k} className={d.settings.theme === k ? "on" : ""} onClick={() => d.setSetting("theme", k)} title={l}>{ic}</button>)}
          </div>
          {acct.email && <span className="small muted" title={acct.email}>{acct.email.split("@")[0]}{acct.session ? <a style={{ marginLeft: 6, cursor: "pointer" }} onClick={acct.signOut}>sign out</a> : null}</span>}
        </div>
        <div className="content">
          <Suspense fallback={<Loading />}>
            <Page route={route} key={route.page + (route.args[0] || "")} />
          </Suspense>
        </div>
      </div>
      <AgentPanel />
    </div>
  );
}

export default function App() {
  return <AccountProvider><DataProvider><Shell /></DataProvider></AccountProvider>;
}
