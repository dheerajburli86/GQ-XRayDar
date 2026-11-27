// The four universes of the GLOCOM / LOCOM category portfolios (owner's spec, 2026-11-27). Shared by the data job
// (which reads the heatmap's price_history) and the page.
export const GP_FROM = "2010-01-01";

export const GP_UNIVERSES = {
  global_country: {
    label: "Global: major country ETFs", currency: "USD", benchmark: { heat: "us_etfs", symbol: "ACWI", label: "MSCI ACWI (ACWI ETF)" },
    note: "iShares MSCI single-country ETFs in USD (tradable, so a result can be reproduced). Price return, no dividends.",
    members: { universe: "us_etfs", symbols: ["EWA", "EWC", "EWG", "EWH", "EWJ", "EWQ", "EWU", "EWY", "EWZ", "EWT", "EWW", "EWS", "EWP", "EWI", "EWL", "EWD", "EWN", "EWK", "EWO", "EZA", "EWM", "EIDO", "THD", "EPOL", "TUR", "ECH", "EIS", "ENOR", "EFNL", "EDEN", "EIRL", "ENZL", "MCHI", "INDA", "EPHE", "EPU", "KSA"] },
  },
  global_sector: {
    label: "Global: sector ETFs", currency: "USD", benchmark: { heat: "us_etfs", symbol: "ACWI", label: "MSCI ACWI (ACWI ETF)" },
    note: "iShares Global sector ETFs in USD (10 sectors; Real Estate is held as REET). Price return.",
    members: { universe: "us_etfs", symbols: ["IXN", "IXG", "IXC", "IXJ", "RXI", "EXI", "KXI", "MXI", "IXP", "JXI", "REET"] },
  },
  us_sector: {
    label: "US: S&P 500 sector indices", currency: "USD", benchmark: { heat: "us_indices", symbol: "^GSPC", label: "S&P 500" },
    note: "The 11 S&P 500 GICS sector indices (price index). Benchmark: S&P 500.",
    members: { universe: "us_indices", symbols: ["^GSPE", "^SP500-15", "^SP500-20", "^SP500-25", "^SP500-30", "^SP500-35", "^SP500-40", "^SP500-45", "^SP500-50", "^SP500-55", "^SP500-60"] },
  },
  india_sector: {
    label: "India: sectoral indices", currency: "INR", benchmark: { heat: "india_indices", symbol: "NIFTY 500", label: "Nifty 500" },
    note: "Every NSE and BSE index the heatmap files as Sectoral (price index, INR). Benchmark: Nifty 500.",
    members: { universe: "india_indices", sector: "Sectoral" },
  },
};
export const GP_KEYS = Object.keys(GP_UNIVERSES);
