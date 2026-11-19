// Methodology: every number the engine produces is governed by this object.
// Items marked [C] in the requirement list are CONFIGURATION awaiting sign-off;
// the defaults below are documented in docs/METHODOLOGY.md and are recorded,
// with their hash, on every calculation run so a series can always be traced
// back to the rules that produced it.

export const METHODOLOGY = Object.freeze({
  version: "1.1.0",

  // History window the index engine builds from. [C]
  startDate: "2015-01-01",

  // Index base. [C]
  baseLevel: 1000,
  returnType: "price", // "price" | "total" (total needs a dividend feed) [C]

  // Rebalance: last common trading date of each calendar quarter. [C]
  rebalance: "quarterly",

  // CW: full market cap. Shares are held constant at the latest known count
  // (market cap / latest close) because no share-count history exists yet;
  // every historical cap is therefore labelled ESTIMATED. [C]
  capWeighting: "full_market_cap",
  sharesPolicy: "constant_latest_estimated",

  // Cap segments within a country by cumulative market cap at each rebalance.
  // Large = first 70%, Mid = to 85%, Small = to 99%; the last 1% is micro and
  // excluded from every index (CW and EW alike, so the universes match). [C]
  capBreakpoints: { large: 0.7, mid: 0.85, small: 0.99 },

  eligibility: {
    minListingDays: 60,   // trading history before a stock can join at a rebalance
    maxStaleDays: 10,     // no trade for this many sessions before rebalance -> ineligible
    requireCap: true,     // a stock without market cap joins neither CW nor EW (matched universes)
    maxCapUsd: 6e12,      // an estimated cap above this (larger than any company has been) is a share-count change
    // Minimum market cap at each rebalance (owner, 2026-11-19): USD 1B developed, USD 200M emerging.
    // Not applied to countries without a reliable cap (India: equal-weight, no size filter yet).
    minCapUsd: { developed: 1e9, emerging: 2e8 },
    maxCapMultiple: 100,  // nor more than 100x the stock's own cap at its last bar
  },

  // A constituent whose data ends between rebalances leaves the index on its
  // last bar; its value is reinvested pro rata in the survivors of the same
  // lowest-level index (country x sector x cap). New listings wait for the
  // next rebalance. [C]
  delistedTreatment: "reinvest_within_cell",

  // Split guard: a one-day price ratio within 3% of a common split factor
  // (2, 3, 4, 5, 10, 20 or their inverses) and larger than 40% is almost always
  // an UNADJUSTED corporate action, not a market move. Its return is set to zero
  // in the INDICES ONLY (stock history is not rewritten) and reported in data
  // health, until the action is recorded in tas_corporate_action. [C]
  splitGuard: { enabled: true, minMove: 0.4, tolerance: 0.03, factors: [2, 3, 4, 5, 10, 20] },

  fx: {
    quote: "USD_PER_UNIT",
    staleWarnDays: 3,
    fill: "previous_available", // holiday / missing fixing -> previous rate, flagged stale
  },

  indicators: {
    rsiPeriod: 14,
    rsiMethod: "house", // "house" = ewm(alpha=1/n) seeded on the first change (matches heatmap); "wilder" = SMA seed [C]
    nestedRsiPeriod: 14,
    accEmas: [4, 14, 26, 39],
    mmaShort: [3, 5, 8, 10, 12, 15],
    mmaLong: [30, 35, 40, 45, 50, 60],
    mmaCompressionPct: { D: 2.0, W: 4.0, M: 8.0, Q: 12.0, H: 15.0, N: 16.5, Y: 18.0 }, // short-group spread below this % = compression
    rscEma: 10,
    rscRebase: 100,
  },

  signals: {
    high52Bars: 252,
    consolidationBars: 20,
    consolidationAtrMult: 4.0, // 20-bar range within this many ATRs = consolidation
    unusualVolume: 2.0,
    breakoutVolume: 1.5,
    accumulationRatio: 1.25,
    distributionRatio: 0.8,
  },

  ww: { turnLookbackQuarters: 8, sidewaysRel: 0.05 },
  rotation: { smaWeeks: 26, momentumWeeks: 4, tailWeeks: 26 },
  glocom: { historySessions: 70 }, // 63 sessions back = 3 months (owner: track the 3-month change too),
  regime: { erWeeks: 26, trendER: 0.35, volPctHigh: 80, volLookbackDays: 756 },
  events: { horizons: { "1M": 21, "3M": 63, "6M": 126, "12M": 252 }, excursionBars: 63, storeYears: 6 },

  scoring: {
    weights: { technical: 0.25, relative: 0.25, participation: 0.1, fundamentals: 0.15, catalysts: 0.05, timeframe: 0.2 },
  },
});

/** Stable JSON (sorted keys) so the hash does not depend on key order. */
export function stableStringify(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(",")}}`;
}

/** FNV-1a 32-bit, hex. Identifies a methodology version in the audit trail. */
export function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

export const methodologyHash = (m = METHODOLOGY) => hashString(stableStringify(m));
