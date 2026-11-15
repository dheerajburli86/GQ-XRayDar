// Cross-asset context: a fixed, named set of benchmark series per asset class
// (equities, REITs, commodities, crypto, currencies, fixed income), their
// returns, correlations and relative strength against global equities.
//
// The list is explicit so every series is verifiable: an asset is the named
// fund or house index, never something picked by matching words in a name.

export const XASSETS = [
  { key: "EQ_GLOBAL", label: "Global equities (house CW index, USD)", cls: "Equities", index: "CW|USD|G" },
  { key: "EQ_US", label: "US equities (SPY)", cls: "Equities", symbol: "SPY", universe: "us_etfs" },
  { key: "EQ_DEV", label: "Developed ex-US (EFA)", cls: "Equities", symbol: "EFA", universe: "us_etfs" },
  { key: "EQ_EM", label: "Emerging markets (EEM)", cls: "Equities", symbol: "EEM", universe: "us_etfs" },
  { key: "EQ_IN", label: "India equities (house CW index, USD)", cls: "Equities", index: "CW|USD|C:India" },
  { key: "RE_US", label: "US REITs (VNQ)", cls: "REITs", symbol: "VNQ", universe: "us_etfs" },
  { key: "RE_GL", label: "Global REITs (REET)", cls: "REITs", symbol: "REET", universe: "us_etfs" },
  { key: "CM_GOLD", label: "Gold (GLD)", cls: "Commodities", symbol: "GLD", universe: "commodities" },
  { key: "CM_SILVER", label: "Silver (SLV)", cls: "Commodities", symbol: "SLV", universe: "commodities" },
  { key: "CM_OIL", label: "Crude oil (USO)", cls: "Commodities", symbol: "USO", universe: "commodities" },
  { key: "CM_BROAD", label: "Broad commodities (DBC)", cls: "Commodities", symbol: "DBC", universe: "commodities" },
  { key: "CM_COPPER", label: "Copper (CPER)", cls: "Commodities", symbol: "CPER", universe: "commodities" },
  { key: "CM_AGRI", label: "Agriculture (DBA)", cls: "Commodities", symbol: "DBA", universe: "commodities" },
  { key: "CR_BTC", label: "Bitcoin (IBIT)", cls: "Crypto", symbol: "IBIT", universe: "crypto_etfs" },
  { key: "CR_ETH", label: "Ether (ETHA)", cls: "Crypto", symbol: "ETHA", universe: "crypto_etfs" },
  { key: "FX_USD", label: "US dollar index (UUP)", cls: "Currencies", symbol: "UUP", universe: "us_etfs" },
  { key: "FX_EUR", label: "Euro (FXE)", cls: "Currencies", symbol: "FXE", universe: "us_etfs" },
  { key: "FX_JPY", label: "Yen (FXY)", cls: "Currencies", symbol: "FXY", universe: "us_etfs" },
  { key: "FX_GBP", label: "Pound (FXB)", cls: "Currencies", symbol: "FXB", universe: "us_etfs" },
  { key: "FI_LONG", label: "US Treasuries 20y+ (TLT)", cls: "Fixed income", fmp: "TLT" },
  { key: "FI_MID", label: "US Treasuries 7-10y (IEF)", cls: "Fixed income", fmp: "IEF" },
  { key: "FI_SHORT", label: "US Treasuries 1-3y (SHY)", cls: "Fixed income", fmp: "SHY" },
  { key: "FI_AGG", label: "US aggregate bonds (AGG)", cls: "Fixed income", fmp: "AGG" },
  { key: "FI_IG", label: "US investment grade credit (LQD)", cls: "Fixed income", fmp: "LQD" },
  { key: "FI_HY", label: "US high yield (HYG)", cls: "Fixed income", fmp: "HYG" },
  { key: "FI_TIPS", label: "US inflation-linked (TIP)", cls: "Fixed income", fmp: "TIP" },
  { key: "FI_EM", label: "EM sovereign USD bonds (EMB)", cls: "Fixed income", fmp: "EMB" },
];
export const XASSET_CLASSES = [...new Set(XASSETS.map((a) => a.cls))];

/** Price-return over trading-day horizons from a {dates, close} series. */
export function xReturns(s, horizons = { "1W": 5, "1M": 21, "3M": 63, "6M": 126, "12M": 252 }) {
  const c = s.close, i = c.length - 1, out = {};
  for (const [k, n] of Object.entries(horizons)) out[k] = i - n >= 0 && c[i - n] > 0 ? c[i] / c[i - n] - 1 : null;
  const y = s.dates[i]?.slice(0, 4), j = s.dates.findIndex((d) => d.slice(0, 4) === y);
  out.YTD = j > 0 ? c[i] / c[j - 1] - 1 : null;
  return out;
}

/** Weekly log returns keyed by the week's last session, for alignment across markets with different holidays. */
export function weeklyReturns(s) {
  const wk = new Map();
  for (let i = 0; i < s.dates.length; i++) {
    const t = Date.parse(s.dates[i]);
    const monday = new Date(t - ((new Date(t).getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10);
    wk.set(monday, s.close[i]);
  }
  const keys = [...wk.keys()].sort(), out = new Map();
  for (let i = 1; i < keys.length; i++) { const a = wk.get(keys[i - 1]), b = wk.get(keys[i]); if (a > 0 && b > 0) out.set(keys[i], Math.log(b / a)); }
  return out;
}

/** Correlation matrix of weekly returns over the last `weeks` weeks (pairwise complete). */
export function correlationMatrix(series, weeks = 52) {
  const wr = series.map((s) => weeklyReturns(s));
  const all = [...new Set(wr.flatMap((m) => [...m.keys()]))].sort().slice(-weeks);
  const m = series.map((_, i) => series.map((__, j) => {
    const xs = [], ys = [];
    for (const k of all) { const a = wr[i].get(k), b = wr[j].get(k); if (a != null && b != null) { xs.push(a); ys.push(b); } }
    if (xs.length < 12) return null;
    const mx = xs.reduce((s, x) => s + x, 0) / xs.length, my = ys.reduce((s, y) => s + y, 0) / ys.length;
    let sxy = 0, sxx = 0, syy = 0;
    for (let k = 0; k < xs.length; k++) { sxy += (xs[k] - mx) * (ys[k] - my); sxx += (xs[k] - mx) ** 2; syy += (ys[k] - my) ** 2; }
    return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
  }));
  return { matrix: m, weeks: all.length };
}

/** Annualised volatility of weekly returns over the window. */
export function weeklyVol(s, weeks = 52) {
  const r = [...weeklyReturns(s).values()].slice(-weeks);
  if (r.length < 12) return null;
  const m = r.reduce((a, x) => a + x, 0) / r.length;
  return Math.sqrt((r.reduce((a, x) => a + (x - m) ** 2, 0) / (r.length - 1)) * 52);
}

/** Relative strength line of a vs b (both USD), rebased to 100 at the first common date. */
export function relativeLine(a, b) {
  const bm = new Map(b.dates.map((d, i) => [d, b.close[i]]));
  const dates = [], vals = [];
  let base = null;
  for (let i = 0; i < a.dates.length; i++) {
    const y = bm.get(a.dates[i]);
    if (!(y > 0 && a.close[i] > 0)) continue;
    const r = a.close[i] / y;
    if (base == null) base = r;
    dates.push(a.dates[i]); vals.push((r / base) * 100);
  }
  return { dates, values: vals };
}
