// Landing page: "if you want to do X, go here". Hovering (or tapping "Show me") a row points an arrow at the
// matching item in the left menu. The market summary lives on its own page (Command centre).
import { useEffect, useState } from "react";
import { PageHead } from "../components/ui.jsx";
import { href } from "../lib/router.js";

const GUIDE = [
  ["See the whole market today", [
    ["market", "Command centre", "Global strength, breadth, sector rotation and the best setups on one screen."],
    ["heatmap", "Heatmap", "Every market as coloured tiles: green up, red down."],
    ["explorer", "Top-down explorer", "Start at a country, drill to sector, industry, then single stocks."],
  ]],
  ["Look at one stock or index", [
    ["screens/RSIMMA", "RSIMMA", "The Analyst-style ribbon charts: price plus RSI, two timeframes side by side."],
    ["screens/RSCMMA", "RSCMMA", "The same, but relative to a benchmark (how it does against its market)."],
    ["chart", "Chart lab", "One big chart with drawing tools, studies and your own formulas."],
    ["workspace", "Multi-chart workspace", "Several charts on one screen, linked together."],
  ]],
  ["Find stocks to look at", [
    ["scanners", "Scanners", "Ready-made lists: breakouts, new highs, turning trends."],
    ["screener", "Screener", "Type what you want in plain English, e.g. strongest weekly IT stocks."],
    ["rs", "Relative strength", "Who is beating its market, sector or the world."],
    ["early", "Early-stage scanner", "Stocks just starting a move."],
  ]],
  ["Understand the indices and sectors", [
    ["indices", "CW / EW indices", "Our own cap-weighted and equal-weighted indices."],
    ["ewcw", "EW vs CW (EWCW)", "Is the average stock beating the big stocks?"],
    ["rotation", "Sector rotation", "Which sectors are leading, improving, weakening, lagging."],
    ["breadth", "Market breadth", "How many stocks are above their averages, new highs and lows."],
  ]],
  ["Get told when something happens", [
    ["alerts", "Alerts", "Telegram and phone alerts on price moves and technical signals."],
    ["watchlists", "Watchlists & portfolio", "Your own lists. Alerts and views can follow them."],
  ]],
  ["Ask a question", [
    ["assistant", "GQ Agent (full page)", "Ask in plain English; it explains what the stored data shows."],
  ]],
  ["Futures and options (India, end of day)", [
    ["dhome", "Derivatives dashboard", "Open interest, participants, rollover and the F&O market."],
    ["dchain", "Option chain", "Strikes, open interest and implied volatility."],
  ]],
];

const setBodyPoint = (p) => { document.body.dataset.point = p || ""; };

export default function Start() {
  const [pointed, setPointed] = useState(null);
  const point = (p) => { setBodyPoint(p); setPointed(p); };
  useEffect(() => () => setBodyPoint(null), []);
  return (
    <div className="stack">
      <PageHead title="Welcome to GQ XRayDar" sub="Pick what you want to do. Hover a row (or tap ◀ Show me) and an arrow points at it in the menu on the left." />
      <div className="start-grid">
        {GUIDE.map(([title, rows]) => (
          <div className="card" key={title}>
            <h3 style={{ marginTop: 0 }}>{title}</h3>
            {rows.map(([p, label, text]) => (
              <div key={p} className={`start-row ${pointed === p ? "on" : ""}`} onMouseEnter={() => point(p)} onMouseLeave={() => point(null)} onFocus={() => point(p)} onBlur={() => point(null)}>
                <div className="grow">
                  <a href={href(p)}><b>{label}</b></a>
                  <div className="small muted">{text}</div>
                </div>
                <button className="btn sm ghost start-show" onClick={() => { point(p); setTimeout(() => point(null), 5000); }} title="Point at it in the menu">◀ Show me</button>
                <a className="btn sm" href={href(p)}>Open →</a>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="small muted">Tip: press Ctrl/Cmd+K (or /) anywhere to search a stock, index or page. The market summary is under Command centre.</div>
    </div>
  );
}
