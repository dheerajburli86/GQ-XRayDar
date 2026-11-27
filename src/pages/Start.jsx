// Landing page. Nothing is opened for you: this lists every item of the left menu, in the same order, with what it is for.
// Hovering a row (or tapping "◀ Show me") points an arrow at that item in the menu. Rows come from the shared NAV,
// so a new menu item shows up here by itself (add its sentence to WHAT).
import { useEffect, useState } from "react";
import { PageHead } from "../components/ui.jsx";
import { href } from "../lib/router.js";
import { NAV } from "../lib/nav.js";
import { useAccount } from "../components/Account.jsx";
import { isHidden } from "../lib/features.js";

const WHAT = {
  home: "This page. Nothing opens until you choose.",
  market: "One-screen summary of the world today: strength, breadth, sector rotation and the best setups.",
  explorer: "Start at a country, drill to sector, industry, sub-industry, then single stocks.",
  heatmap: "Every market as coloured tiles: green up, red down, size shows how big.",
  xasset: "Currencies, commodities, bonds and equities side by side.",
  indices: "Our own cap-weighted (CW) and equal-weighted (EW) indices for every country, sector and region.",
  ewcw: "Is the average stock (EW) beating the biggest stocks (CW)? Shows the gap over time.",
  ww: "Which stocks are gaining or losing weight inside their country-sector index.",
  myindex: "Build your own index from stocks you pick.",
  chart: "One big chart with drawing tools, indicators, your own formulas and replay.",
  "screens/RSIACC": "Analyst-style charts with plain averages: price and RSI rows, two timeframes side by side.",
  "screens/RSCACC": "The same with relative strength: how a stock does against a benchmark.",
  "screens/RSIMMA": "Analyst-style charts with the moving-average ribbon: price and RSI rows.",
  "screens/RSCMMA": "The ribbon charts on relative strength against a benchmark.",
  tiles: "Type a command such as top 8 US semiconductor companies and get a wall of charts.",
  workspace: "Several charts on one screen, linked together.",
  scanners: "Ready-made lists: breakouts, new highs, turning trends.",
  rs: "Who is beating its market, sector or the world.",
  screener: "Type what you want in plain English, e.g. strongest weekly IT stocks.",
  early: "Stocks that are just starting a move.",
  imbeti: "The ten yes / no / unknown characteristics from the ETI project. Shown and filtered, never scored.",
  funnel: "Narrows the whole universe step by step down to a short list.",
  rotation: "Which sectors are leading, improving, weakening or lagging.",
  glocom: "Colour bands comparing a stock, industry or sector with its peers over 1 week, 6 months and 1 year.",
  breadth: "How many stocks sit above their averages; new highs and lows over time.",
  gport: "Back-test strong, weak and neutral GLOCOM baskets of indices / ETFs, rebalanced weekly or monthly, with editable weights.",
  breadthan: "CCR, OUP, RR, RRM, RRMK, TR and TRMK for an index and its parts over chosen periods.",
  scores: "AI setup scores: a 0-100 summary of the stored signals, not advice.",
  assistant: "Ask in plain English; it explains what the stored data shows.",
  briefs: "Daily and weekly written market summaries.",
  backtest: "How past signals and chart patterns actually played out.",
  dhome: "India futures and options at end of day: open interest, participants, rollover.",
  dchain: "Strikes, open interest and implied volatility for an expiry.",
  dfut: "Futures prices, rollover and open interest.",
  dvol: "Implied volatility, skew and term structure.",
  dstrat: "Build an options strategy and see its payoff.",
  drisk: "Risk of a derivatives portfolio: exposure, stress tests, value at risk.",
  dexpiry: "Expiry dates and events that matter for contracts.",
  dscreen: "Filter futures and options by your own rules.",
  dresearch: "Studies of how derivatives signals behaved in the past.",
  alerts: "Telegram and phone alerts on price moves and technical signals.",
  tasks: "Your to-do list inside the dashboard.",
  watchlists: "Your own stock lists and portfolio. Alerts and views can follow them.",
  paper: "Practice trading with no real money.",
  notes: "Your private research notes.",
  admin: "Admins only: every account, its role, and whether its GQ Agent is on and what it may read.",
  community: "Chat rooms, message boards, group chats and direct messages, plus a Shared items tab: what people share with you (watchlists, screens, formulas, notes, layouts) and what you share. Send charts and files to other XRayDar users.",
  data: "Run history, data health and issues: is the data fresh and complete?",
};

const setBodyPoint = (p) => {
  document.querySelectorAll(".navitem.pointed").forEach((e) => e.classList.remove("pointed"));
  if (!p) return;
  const el = document.querySelector(`.navitem[data-nav="${CSS.escape(p)}"]`);
  if (el) { el.classList.add("pointed"); el.scrollIntoView({ block: "nearest" }); }
};

export default function Start() {
  const acct = useAccount();
  const [pointed, setPointed] = useState(null);
  const point = (p) => { setBodyPoint(p); setPointed(p); };
  useEffect(() => () => setBodyPoint(null), []);
  return (
    <div className="stack">
      <PageHead title="Welcome to GQ XRayDar" sub={typeof window !== "undefined" && window.innerWidth <= 760 ? "Nothing opens by itself. This is every item of the menu, in order. Tap Open to go there, or use ☰ at the top left." : "Nothing opens by itself. This is every item of the menu on the left, in order. Hover a row (or tap ◀ Show me) and an arrow points at it in the menu; click Open to go there."} />
      <div className="start-grid">
        {NAV.map(([group, items]) => (
          <div className="card" key={group}>
            <h3 style={{ marginTop: 0 }}>{group}</h3>
            {items.filter(([p]) => !isHidden(p) && (p !== "admin" || acct.me?.isAdmin)).map(([p, ic, label]) => (
              <div key={p} className={`start-row ${pointed === p ? "on" : ""}`} onMouseEnter={() => point(p)} onMouseLeave={() => point(null)} onFocus={() => point(p)} onBlur={() => point(null)}>
                <span className="ic" style={{ width: 20, textAlign: "center" }}>{ic}</span>
                <div className="grow">
                  <a href={href(p)}><b>{label}</b></a>
                  <div className="small muted">{WHAT[p] || ""}</div>
                </div>
                <button className="btn sm ghost start-show" onClick={() => { point(p); setTimeout(() => point(null), 5000); }} title="Point at it in the menu">◀ Show me</button>
                <a className="btn sm" href={href(p)}>Open →</a>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="small muted">Tip: press Ctrl/Cmd+K (or /) anywhere to search a stock, index or page.</div>
    </div>
  );
}
