// Versions of every calculation and model, so any stored or displayed output
// can be reproduced. Bump the number when a change alters results; the server
// writes these into the audit log with each AI / model output.

export const MODEL_VERSIONS = {
  ivSolver: "1.1 Black-76 Newton with bisection fallback",
  greeks: "1.1 analytic generalised Black-Scholes, checked against finite differences",
  pricingModels: "1.0 BSM, Black-76, CRR, trinomial, Barone-Adesi-Whaley, Bachelier",
  surface: "1.0 raw SVI per expiry with a Durrleman butterfly check",
  quoteHygiene: "1.0 end-of-day flags; IV suppressed on dead and below-intrinsic contracts",
  buildup: "1.0 price / OI quadrants with volume and z-score confidence",
  writingBuying: "1.0 end-of-day premium / OI / IV inference, confidence capped at 0.8",
  gex: "1.0 dealers long calls and short puts (stated assumption)",
  strategyMetrics: "1.0 lognormal at ATM IV of the first expiry",
  margin: "1.0 stress estimate (not SPAN)",
  recommender: "1.1 rule-based ranking with evidence, counter-evidence and invalidation triggers",
  monteCarlo: "1.0 Merton jumps + Heston-type variance, seeded",
  risk: "1.0 beta-weighting, Taylor attribution, parametric / historical / MC VaR",
  derivAlerts: "1.0 edge-triggered on end-of-day summaries",
  coach: "1.0 rule-based journal analysis",
  validation: "1.0 walk-forward, parameter grid, Brier and calibration",
  glocom: "1.3 groups of < methodology.glocom.minGroupStocks stocks shown unranked; Global industries on the GICS industry group for every market (US workbook groups stay inside the US); 1.2 countries rated globally (G|country); heatmap rule sheet (LTW 40 = 6M >= 0.4, as scraper_common.classify) (1W / 6M / 1Y percentiles); LOCOM within industry group; group rank history",
  chartPatterns: "1.0 pivot-based classical patterns",
  analystScreens: "1.0 two-column RSI/RSC stacks, MMA 3-15/30-60, ACC 4/14/26/39, n-month / n-week candles",
  assistant: "1.0 deterministic parser + stored calculations (built-in)",
  foCollector: "3 (FO_VERSION)",
  studies: "1.1 Wilder ATR / ADX / SAR, Lane stochastics, Hosoda Ichimoku, Chaikin CMF / A-D, supertrend, pivots (5 kinds), OBV, VWAP / anchored VWAP; 1.1 adds ROC and Pring KST (all periods and weights editable)",
  drawings: "1.0 Fibonacci retracement / extension / fan / arcs / time zones, pitchforks, Gann fan / grid, R/R, measure",
  formula: "1.0 safe expression language (no eval)",
  projection: "1.0 target / measured / ATR / percent / analogue / slope",
  seasonality: "1.0 close-to-close by weekday and month, average yearly path",
  tpo: "1.0 market profile from candles (one letter per candle), 70% value area",
  consolidationBreakout: "1.1 yellow/red fan on log price, on RSC, on RSI (RSIMMA) and on RSI of RSC (RSAACC); first fan after a gap, >= 15 candles of history (calibrated on the owner's dated examples, 43 of 53)",
};

export const ENGINE_VERSION = "2026.11.23";
