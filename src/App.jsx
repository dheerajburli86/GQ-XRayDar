import { useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import { isHidden } from "./lib/features.js";
import { DataWindow } from "./components/DataWindow.jsx";
import { DataProvider, useData } from "./data/store.jsx";
import { useRoute, navigate, href } from "./lib/router.js";
import { parseCommand } from "../engine/nl.js";
import { isTilesCommand } from "../engine/tiles.js";
import { Loading } from "./components/ui.jsx";
import { usePersistent } from "./lib/storage.js";
import { AccountProvider, useAccount } from "./components/Account.jsx";
import { AgentPanel } from "./components/AgentPanel.jsx";
import { resolveTheme, watchSystemTheme } from "./lib/theme.js";
import { ErrorBoundary } from "./components/ErrorBoundary.jsx";
import { downloadPage } from "./lib/pagePicture.js";

// A page file can be missing after a new version is deployed while this tab stays open (the
// old file names no longer exist). One retry, then one reload of the app, instead of a blank screen.
const loaders = {};
function page(name, load) {
  loaders[name] = load;
  return lazy(() => load().catch(() => new Promise((r) => setTimeout(r, 600)).then(load)).catch((e) => {
    try {
      const last = Number(sessionStorage.getItem("gqta.chunkReload") || 0);
      if (Date.now() - last > 30000) { sessionStorage.setItem("gqta.chunkReload", String(Date.now())); window.location.reload(); return new Promise(() => {}); }
    } catch { /* storage blocked */ }
    throw e;
  }));
}
/** After the app is up, fetch the page files in the background so every menu click is instant. */
function prefetchPages() {
  const names = Object.keys(loaders);
  const idle = window.requestIdleCallback || ((f) => setTimeout(f, 200));
  const next = () => { const n = names.shift(); if (!n) return; loaders[n]().catch(() => {}).finally(() => idle(next)); };
  if (navigator.connection?.saveData) return;
  setTimeout(() => idle(next), 2500);
}

const pages = {
  home: page("home", () => import("./pages/Start.jsx")),
  market: page("market", () => import("./pages/CommandCentre.jsx")),
  explorer: page("explorer", () => import("./pages/Explorer.jsx")),
  heatmap: page("heatmap", () => import("./pages/Heatmap.jsx")),
  indices: page("indices", () => import("./pages/Indices.jsx")),
  ewcw: page("ewcw", () => import("./pages/EwCw.jsx")),
  ww: page("ww", () => import("./pages/WeightWatcher.jsx")),
  screens: page("screens", () => import("./pages/StackedScreens.jsx")),
  workspace: page("workspace", () => import("./pages/Workspace.jsx")),
  tiles: page("tiles", () => import("./pages/Tiles.jsx")),
  rs: page("rs", () => import("./pages/RelativeStrength.jsx")),
  screener: page("screener", () => import("./pages/Screener.jsx")),
  early: page("early", () => import("./pages/EarlyStage.jsx")),
  funnel: page("funnel", () => import("./pages/Funnel.jsx")),
  rotation: page("rotation", () => import("./pages/Rotation.jsx")),
  glocom: page("glocom", () => import("./pages/Glocom.jsx")),
  imbeti: page("imbeti", () => import("./pages/ImbEti.jsx")),
  breadth: page("breadth", () => import("./pages/Breadth.jsx")),
  breadthan: page("breadthan", () => import("./pages/BreadthAnalyser.jsx")),
  scores: page("scores", () => import("./pages/Scores.jsx")),
  assistant: page("assistant", () => import("./pages/Assistant.jsx")),
  briefs: page("briefs", () => import("./pages/Briefs.jsx")),
  backtest: page("backtest", () => import("./pages/Backtest.jsx")),
  alerts: page("alerts", () => import("./pages/Alerts.jsx")),
  watchlists: page("watchlists", () => import("./pages/Watchlists.jsx")),
  notes: page("notes", () => import("./pages/Notes.jsx")),
  data: page("data", () => import("./pages/DataCentre.jsx")),
  stock: page("stock", () => import("./pages/Stock.jsx")),
  chart: page("chart", () => import("./pages/ChartLab.jsx")),
  scanners: page("scanners", () => import("./pages/Scanners.jsx")),
  tasks: page("tasks", () => import("./pages/Tasks.jsx")),
  paper: page("paper", () => import("./pages/Paper.jsx")),
  myindex: page("myindex", () => import("./pages/MyIndices.jsx")),
  xasset: page("xasset", () => import("./pages/CrossAsset.jsx")),
  dhome: page("dhome", () => import("./pages/deriv/DerivHome.jsx")),
  dchain: page("dchain", () => import("./pages/deriv/OptionChain.jsx")),
  dfut: page("dfut", () => import("./pages/deriv/Futures.jsx")),
  dvol: page("dvol", () => import("./pages/deriv/VolLab.jsx")),
  dstrat: page("dstrat", () => import("./pages/deriv/Strategy.jsx")),
  dexpiry: page("dexpiry", () => import("./pages/deriv/Expiry.jsx")),
  dunusual: page("dunusual", () => import("./pages/deriv/Unusual.jsx")),
  dscreen: page("dscreen", () => import("./pages/deriv/DerivScreener.jsx")),
  dresearch: page("dresearch", () => import("./pages/deriv/DerivResearch.jsx")),
  drisk: page("drisk", () => import("./pages/deriv/Risk.jsx")),
};

const NAV = [
  ["Overview", [["home", "★", "Start here"], ["market", "◎", "Command centre"], ["explorer", "⇣", "Top-down explorer"], ["heatmap", "▦", "Heatmap"], ["xasset", "⊕", "Cross-asset"]]],
  ["Indices", [["indices", "≋", "CW / EW indices"], ["ewcw", "⇋", "EW vs CW (EWCW)"], ["ww", "◔", "Weight Watcher"], ["myindex", "✚", "My indices"]]],
  ["Charts", [["chart", "📈", "Chart lab"], ["screens/RSIACC", "∿", "RSIACC"], ["screens/RSCACC", "∿", "RSCACC"], ["screens/RSIMMA", "≡", "RSIMMA"], ["screens/RSCMMA", "≡", "RSCMMA"], ["tiles", "▦", "Multi-tile screen"], ["workspace", "⊞", "Multi-chart workspace"]]],
  ["Discovery", [["scanners", "⌖", "Scanners"], ["rs", "↗", "Relative strength"], ["screener", "⚲", "Screener"], ["early", "◷", "Early-stage scanner"], ["imbeti", "◈", "IMB / ETI characteristics"], ["funnel", "▽", "Opportunity funnel"], ["rotation", "↻", "Sector rotation"], ["glocom", "◫", "GLOCOM / LOCOM"], ["breadth", "▥", "Market breadth"], ["breadthan", "▤", "Breadth analyser (CCR)"]]],
  ["Research", [["scores", "★", "AI setup scores"], ["assistant", "✦", "GQ Agent (full page)"], ["briefs", "✎", "Market briefs"], ["backtest", "⟲", "Backtest & patterns"]]],
  ["Derivatives", [["dhome", "⧉", "Derivatives dashboard"], ["dchain", "⋮", "Option chain"], ["dfut", "⇉", "Futures & rollover"], ["dvol", "≈", "Volatility lab"], ["dstrat", "⟁", "Strategy builder"], ["drisk", "⚖", "Portfolio risk"], ["dexpiry", "⏱", "Expiry & events"], ["dunusual", "⚡", "Unusual activity"], ["dscreen", "⚲", "Derivatives screener"], ["dresearch", "⟲", "Derivatives research"]]],
  ["My work", [["alerts", "◉", "Alerts"], ["tasks", "☑", "Tasks"], ["watchlists", "☰", "Watchlists & portfolio"], ["paper", "◈", "Practice portfolio"], ["notes", "✐", "Research notes"]]],
  ["Data", [["data", "⛁", "Data centre"]]],
];

function CommandBar() {
  const d = useData();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const recRef = useRef(null), inputRef = useRef(null);
  // Ctrl / Cmd + K (or "/") jumps to the search box from anywhere
  useEffect(() => {
    const h = (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "") || document.activeElement?.isContentEditable;
      if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") || (e.key === "/" && !typing)) { e.preventDefault(); inputRef.current?.focus(); inputRef.current?.select(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  const sugg = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s || !d.secs) return [];
    const out = [];
    for (const x of d.secs) { if (x.symbol.toLowerCase().startsWith(s) || (s.length > 2 && (x.name || "").toLowerCase().includes(s))) out.push({ label: `${x.symbol} · ${x.name}`, sub: `${x.country} · ${x.sector}`, go: () => navigate(`stock/${x.id}`) }); if (out.length >= 7) break; }
    for (const c of d.countries || []) if (c.toLowerCase().startsWith(s)) out.push({ label: c, sub: "Country", go: () => navigate("explorer", { country: c }) });
    for (const [, items] of NAV) for (const [p, , l] of items) if (!isHidden(p) && l.toLowerCase().includes(s)) out.push({ label: l, sub: "Page", go: () => navigate(p) });
    return out.slice(0, 12);
  }, [q, d.secs, d.countries]);

  const run = (text) => {
    // "show us the top 8 US semiconductor companies ... daily charts in MMA format" -> chart tiles
    if (isTilesCommand(text)) { setOpen(false); return navigate("tiles", { q: text }); }
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
      <input ref={inputRef} value={q} title="Search (Ctrl+K)" placeholder="Search or ask…"
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

/** Download the current screen (charts and all) as a picture or a PDF page. */
function PageDownload({ route, asOf }) {
  const [busy, setBusy] = useState(false);
  const go = async (kind) => {
    const el = document.querySelector(".content");
    if (!el || busy) return;
    setBusy(true);
    const label = NAV.flatMap(([, items]) => items).find(([p]) => p === route.page || p === `${route.page}/${route.args[0]}`)?.[2] || route.page;
    try { await downloadPage(el, kind, { name: `${label}_${route.args.slice(1).join("_")}`, title: `GQ XRayDar · ${label}`, subtitle: `data to ${asOf || "n/a"} · ${window.location.hash}` }); }
    catch (e) { alert(`Could not make the picture: ${e.message}`); }
    finally { setBusy(false); }
  };
  return (
    <span className="seg" title="Download this screen" data-html2canvas-ignore>
      <button onClick={() => go("png")} disabled={busy}>{busy ? "…" : "⤓ PNG"}</button>
      <button onClick={() => go("pdf")} disabled={busy}>PDF</button>
    </span>
  );
}

function Shell() {
  const d = useData();
  const route = useRoute();
  const [collapsed, setCollapsed] = usePersistent("navCollapsed", typeof window !== "undefined" && window.innerWidth < 760);
  const acct = useAccount();
  const [sideW, setSideW] = usePersistent("navWidth", 228);
  const [drag, setDrag] = useState(false);
  const startDrag = (e) => {
    e.preventDefault(); setDrag(true);
    const move = (ev) => setSideW(Math.max(160, Math.min(520, Math.round(ev.clientX))));
    const up = () => { setDrag(false); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  useEffect(() => {
    const apply = () => { document.documentElement.dataset.theme = resolveTheme(d.settings.theme); };
    apply();
    return d.settings.theme === "system" ? watchSystemTheme(apply) : undefined;
  }, [d.settings.theme]);
  const ready = d.state.phase === "ready";
  useEffect(() => { if (ready) prefetchPages(); }, [ready]);
  const [offline, setOffline] = useState(typeof navigator !== "undefined" && navigator.onLine === false);
  useEffect(() => {
    const on = () => setOffline(false), off = () => setOffline(true);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  const [loadErr, setLoadErr] = useState(null);
  const [retryKey, setRetryKey] = useState(0);
  useEffect(() => {
    const h = (e) => setLoadErr(e.detail);
    window.addEventListener("gqta-load-error", h);
    return () => window.removeEventListener("gqta-load-error", h);
  }, []);
  useEffect(() => { setLoadErr(null); }, [route.path]);
  const Page = (!isHidden(route.page) && pages[route.page]) || pages.home;
  const activeKey = route.page === "screens" ? `screens/${route.args[0] || "RSIMMA"}` : route.page;

  if (d.state.phase === "loading") {
    const p = d.state.progress;
    const pct = p?.phase === "indices" ? 10 + (p.done / p.total) * 40 : p?.phase === "signals" ? 55 + (p.done / p.total) * 40 : p?.phase === "analytics" || p?.phase === "weight_watcher" ? 96 : 5;
    return (
      <div className="loading-screen"><div className="box card">
        <div className="brand"><div className="logo">GQ</div><div><div className="t1">GQ XRayDar</div><div className="t2">{d.mode === "demo" ? "Building the demo universe with the full calculation engine…" : "Loading from Supabase…"}</div></div></div>
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
    <div className={`shell ${collapsed ? "collapsed" : ""}`} style={collapsed ? undefined : { "--side-w": `${sideW}px` }}>
      <nav className="side">
        {!collapsed && <div className={`side-grip ${drag ? "on" : ""}`} onPointerDown={startDrag} onDoubleClick={() => setSideW(228)} title="Drag to resize · double-click to reset" />}
        <div className="brand" onClick={() => setCollapsed(!collapsed)} style={{ cursor: "pointer" }} title="Collapse / expand">
          <div className="logo">GQ</div>
          <div className="bt"><div className="t1">GQ XRayDar</div><div className="t2">Global market intelligence · {d.mode === "demo" ? "demo data" : "live data"}</div></div>
        </div>
        {NAV.map(([g, all]) => [g, all.filter(([p]) => !isHidden(p))]).map(([g, items]) => (
          <div className="navgroup" key={g}>
            <div className="g">{g}</div>
            {items.map(([p, ic, l]) => <a key={p} href={href(p)} data-nav={p} className={`navitem ${activeKey === p ? "active" : ""}`} title={l}><span className="ic">{ic}</span><span className="lbl">{l}</span></a>)}
          </div>
        ))}
      </nav>
      <div className="main">
        {d.mode === "demo" && <div className="banner demo"><b>DEMO DATA</b> Synthetic universe generated in your browser and run through the real calculation engine. Connect the heatmap Supabase database to see live markets (README).</div>}
        {offline && <div className="banner demo" role="status"><b>OFFLINE</b> No internet connection. What is already on screen still works; new data loads when the connection is back.</div>}
        <div className="topbar">
          <CommandBar />
          <div className="grow" />
          <span className="small muted" title="Latest session in the data">As of <b className="mono">{d.info?.asOf}</b></span>
          <button className="btn sm" onClick={() => d.reload()} title="Reload the latest calculation run without reloading the page">↻</button>
          <PageDownload route={route} asOf={d.info?.asOf} />
          <div className="seg theme-seg" title="Appearance">
            {[["light", "☀", "Light"], ["dark", "☾", "Dark"], ["system", "Auto", "Same as device"]].map(([k, ic, l]) => <button key={k} className={d.settings.theme === k ? "on" : ""} onClick={() => d.setSetting("theme", k)} title={l}>{ic}</button>)}
          </div>
          {acct.email && <span className="small muted" title={acct.email}>{acct.email.split("@")[0]}{acct.session ? <a style={{ marginLeft: 6, cursor: "pointer" }} onClick={acct.signOut}>sign out</a> : null}</span>}
        </div>
        <DataWindow />
        <div className="content">
          {loadErr && (
            <div className="note warn row between" role="alert" style={{ marginBottom: 8 }}>
              <span>Some data on this page could not be loaded ({String(loadErr).slice(0, 160)}). Check the connection and try again.</span>
              <span className="row" style={{ gap: 6 }}><button className="btn sm primary" onClick={() => { setLoadErr(null); setRetryKey((k) => k + 1); }}>Retry</button><button className="btn sm ghost" onClick={() => setLoadErr(null)}>Dismiss</button></span>
            </div>
          )}
          <ErrorBoundary resetKey={route.path + retryKey}>
            <Suspense fallback={<Loading />}>
              <Page route={route} key={route.page + (route.args[0] || "") + retryKey} />
            </Suspense>
          </ErrorBoundary>
        </div>
      </div>
      <ErrorBoundary silent><AgentPanel /></ErrorBoundary>
    </div>
  );
}

export default function App() {
  return <ErrorBoundary title="GQ XRayDar hit a problem"><AccountProvider><DataProvider><Shell /></DataProvider></AccountProvider></ErrorBoundary>;
}
