# Feature list (PDF, 12 Nov 2026): where each point lives

"App" paths are pages in the web app's left menu. Points marked **needs server**
work once the TA server is deployed (docs/DEPLOY.md); the rest work in the app alone.

## 1. Charts
| # | Feature | Where |
|---|---|---|
| 1.1 | Side-by-side charts, different periods | Multi-chart workspace (1–3 columns, D/W/M/Q/Y per panel); stock page D/W/M |
| 1.2 | Linked charts | Workspace "Linked scroll"; stacked screens; stock page (crosshair and zoom shared by date) |
| 1.3 | Many indicators on one screen | Chart lab: price + EMA 20/50/200 + MMA groups, volume, RSI (+ RSI of RSI), MACD panes |
| 1.4 | Saved screens | Workspace layouts (Save / Load); Chart lab remembers its setup; saved screener screens |
| 1.5 | Smoother candles and key levels | Chart lab: Heikin-Ashi; "Key levels" (support/resistance where price turned at least twice) |
| 1.6 | Drawing tools | Chart lab: trend line, horizontal line, channel, text note; undo / clear; saved per stock |
| 1.7 | Noise-free chart styles | Chart lab: Renko, Kagi, Point & Figure |
| 1.8 | Compare with the index or another stock | Chart lab "Compare with" / "vs its market" (rebased line); RS page; RSC panels |
| 1.9 | Busiest price levels | Chart lab "Busiest prices" (volume at each price band for the window in view; busiest band highlighted) |

## 2. Scanners (App → Scanners; India / US / Global, stocks / ETFs / indices, size, sector, watchlist)
| # | Feature | Where |
|---|---|---|
| 2.1 | RSI scanner incl. fading strength | Scanners → RSI: overbought, oversold, bearish / bullish divergence (D/W/M) |
| 2.2 | MACD scanner | Scanners → MACD: turned up, turned down, above signal |
| 2.3 | Trend scanner | Scanners → Trend: healthy, weak, golden / death cross, crossed the 50-day |
| 2.4 | Squeeze and breakout (MMA) | Scanners → Squeeze & breakout: in a squeeze, broke out, just turned bullish, aligned |
| 2.5 | 52-week high / low | Scanners → 52-week high / low (at, within 5%) |
| 2.6 | All-time high / low | Scanners → All-time high / low |
| 2.7 | Candle patterns | Scanners → Candle patterns: 12 directional patterns, daily / weekly, in context |
| 2.8 | 360 scanner incl. weight in industry | Scanners → 360 view (Weight Watcher trend and 4-quarter change) |
| 2.9 | Build-your-own | Scanners → Build your own; Screener (saved screens, plain-English) |
| 2.10 | Volume scanner | Scanners → Volume: 2x normal, breakout on volume, accumulation, distribution |
| 2.11 | Gainers, losers, rising vs falling | Scanners → Gainers, losers, breadth; Market breadth page |
| 2.12 | Sector ranking | Scanners → Sector ranking (sectors / industry groups); Sector rotation |
| 2.13 | Strength vs the market | Scanners → Strength vs the market; Relative strength page |

## 3. Alerts (App → Alerts; on Telegram: **needs server**)
| # | Feature | Where |
|---|---|---|
| 3.1–3.17 | The 17 single-indicator alerts | Alerts → Indicator alerts: rule, its number, daily / weekly / monthly, one stock |
| — | One message per signal, no repeats | Fires on the candle where the condition becomes true; the server records each (alert, stock, candle) once |
| 3.18 | One alert for a whole list; pause / resume | "On: A whole watchlist"; per-alert on/off; "Pause all alerts" |
| 3.19 | Morning summary | Alerts → Telegram & summaries (weekdays 09:15 IST) |
| 3.20 | Weekly summary | Alerts → Telegram & summaries (Saturday 09:00 IST) |

## 4. GQ Agent (the ✦ GQ Agent button on every page, and Telegram)
| # | Feature | Where |
|---|---|---|
| 4.1 | Plain-English questions | Agent panel; Telegram (`ta_analyze`, `ta_screen`, …) |
| 4.2 | Detailed multi-period review | "analyse X": trend, momentum, RSI, levels on D/W/M/Q/Y |
| 4.3 | Sets up alerts and tasks from chat | Telegram (`ta_alerts`, `ta_tasks`) after `/ta link`; panel when signed in |
| 4.4 | Explains the chart on screen | Chart lab "Explain this chart" / "Ask GQ Agent" (the panel knows the stock, period and style) |
| 4.5 | Neutral, never buy / sell / hold | Built into the agent's instructions and every answer's note |
| 4.6 | Why a stock moved, using the news | **needs server + agent**: the GQ agent's web / news search. The built-in assistant (no agent) answers from stored data only |
| 4.7 | Compare two stocks or sectors | "compare TCS and INFY"; `ta_compare`; Scanners → Sector ranking |
| 4.8 | Repeats jobs on a schedule | Tasks (daily / weekdays / weekly) or ask the agent; **needs server** for schedules |
| 4.9 | Spots common setups and explains them | Chart read (squeeze, breakout, consolidation, candle patterns); scanners |

## 5. Tasks and organising
| # | Feature | Where |
|---|---|---|
| 5.1 | Task list | App → Tasks (pending / running / done / failed, run now, pause) |
| 5.2 | Watchlists used everywhere | Watchlists page; used by scanners, alerts, tasks, report card, briefs |
| 5.3 | Progress messages on Telegram | **needs server**: "Working on…" and the result when a task finishes |
| 5.4 | Notes next to the chart | Chart lab and stock page "Notes"; Research notes page |

## 6. Data, testing and access
| # | Feature | Where |
|---|---|---|
| 6.1 | Uses the heatmap's data, never changes it | Reads `instruments`, `price_history`, …; writes only `tas_*` tables |
| 6.2 | India, US, Global stocks, ETFs and indices | All scanners, charts and alerts (ETFs and indices are analysed, never inside the GQ indices) |
| 6.3 | Private login | Supabase sign-in (Google or email link), @gquants.com only, checked again by the server |
| 6.4 | Test an idea on past data | Backtest → Test an idea (any of the 17 rules, one stock / watchlist / largest stocks) |
| 6.5 | Report card for alerts | Alerts → Report card (signals, average move, hit rate at three horizons, every past signal) |
| 6.6 | Practice portfolio | App → Practice portfolio (imaginary $100k at stored closes) |
| 6.7 | Phone app with pop-up alerts | Installable app; pop-ups with VAPID keys on the server |
| 6.8 | Save charts and results as PDF / Excel | Chart lab PNG / PDF; every table CSV / Excel; briefs Markdown |
