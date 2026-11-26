// Instruments the heatmap does not carry, added for charting only (owner, Nov 2026: "need to get
// all US indices and global indices, MSCI indices, currency"). Each one is fetched from FMP by
// cli/extraJob.mjs; a symbol FMP does not answer is skipped and never shown. They are charts,
// not constituents: nothing here enters the house CW / EW indices, Weight Watcher or screens.
//
// MSCI index levels are licensed by MSCI and are not in any feed this app has. The MSCI
// tracker ETFs (ACWI, URTH, EEM, EFA, EWJ, INDA, ...) are already in the heatmap's US ETFs and
// are listed under "US ETF" in the ticker search (never under "Indices"), labelled as ETFs that track an MSCI index.

export const EXTRA_FMP = [
  // Europe
  { symbol: "^STOXX50E", label: "EURO STOXX 50", category: "Index", region: "Europe", country: "Euro area" },
  { symbol: "^STOXX", label: "STOXX Europe 600", category: "Index", region: "Europe", country: "Europe" },
  { symbol: "^N100", label: "Euronext 100", category: "Index", region: "Europe", country: "Europe" },
  { symbol: "^AEX", label: "AEX (Netherlands)", category: "Index", region: "Europe", country: "Netherlands" },
  { symbol: "^BFX", label: "BEL 20 (Belgium)", category: "Index", region: "Europe", country: "Belgium" },
  { symbol: "^ATX", label: "ATX (Austria)", category: "Index", region: "Europe", country: "Austria" },
  { symbol: "^FTMC", label: "FTSE 250 (UK)", category: "Index", region: "Europe", country: "United Kingdom" },
  { symbol: "^FTAS", label: "FTSE All-Share (UK)", category: "Index", region: "Europe", country: "United Kingdom" },
  { symbol: "FTSEMIB.MI", label: "FTSE MIB (Italy)", category: "Index", region: "Europe", country: "Italy" },
  { symbol: "^ISEQ", label: "ISEQ Overall (Ireland)", category: "Index", region: "Europe", country: "Ireland" },
  { symbol: "^OMXH25", label: "OMX Helsinki 25 (Finland)", category: "Index", region: "Europe", country: "Finland" },
  { symbol: "XU100.IS", label: "BIST 100 (Turkey)", category: "Index", region: "Europe", country: "Turkey" },
  // Asia / Middle East / Africa
  { symbol: "000300.SS", label: "CSI 300 (China)", category: "Index", region: "Asia", country: "China" },
  { symbol: "399001.SZ", label: "Shenzhen Component (China)", category: "Index", region: "Asia", country: "China" },
  { symbol: "^HSCE", label: "Hang Seng China Enterprises", category: "Index", region: "Asia", country: "Hong Kong" },
  { symbol: "^KLSE", label: "FTSE Bursa Malaysia KLCI", category: "Index", region: "Asia", country: "Malaysia" },
  { symbol: "^SET.BK", label: "SET Index (Thailand)", category: "Index", region: "Asia", country: "Thailand" },
  { symbol: "PSEI.PS", label: "PSEi (Philippines)", category: "Index", region: "Asia", country: "Philippines" },
  { symbol: "^TA125.TA", label: "TA-125 (Israel)", category: "Index", region: "Asia", country: "Israel" },
  { symbol: "^TASI.SR", label: "Tadawul All Share (Saudi Arabia)", category: "Index", region: "Middle East", country: "Saudi Arabia" },
  { symbol: "^CASE30", label: "EGX 30 (Egypt)", category: "Index", region: "Africa", country: "Egypt" },
  { symbol: "^J203.JO", label: "FTSE/JSE All Share (South Africa)", category: "Index", region: "Africa", country: "South Africa" },
  // Americas
  { symbol: "^RUA", label: "Russell 3000", category: "Index", region: "US", country: "United States" },
  { symbol: "^RUI", label: "Russell 1000", category: "Index", region: "US", country: "United States" },
  { symbol: "^W5000", label: "Wilshire 5000", category: "Index", region: "US", country: "United States" },
  { symbol: "^MID", label: "S&P MidCap 400", category: "Index", region: "US", country: "United States" },
  { symbol: "^SML", label: "S&P SmallCap 600", category: "Index", region: "US", country: "United States" },
  { symbol: "^IPSA", label: "S&P IPSA (Chile)", category: "Index", region: "LATAM", country: "Chile" },
  // dollar, rates, commodity futures
  { symbol: "DX-Y.NYB", label: "US Dollar Index (DXY)", category: "Currency", region: "Global", country: "United States" },
  { symbol: "^TNX", label: "US 10-year Treasury yield", category: "Rate", region: "US", country: "United States" },
  { symbol: "^TYX", label: "US 30-year Treasury yield", category: "Rate", region: "US", country: "United States" },
  { symbol: "^FVX", label: "US 5-year Treasury yield", category: "Rate", region: "US", country: "United States" },
  { symbol: "^IRX", label: "US 13-week T-bill yield", category: "Rate", region: "US", country: "United States" },
  { symbol: "GCUSD", label: "Gold (futures, USD/oz)", category: "Commodity", region: "Global", country: null },
  { symbol: "SIUSD", label: "Silver (futures, USD/oz)", category: "Commodity", region: "Global", country: null },
  { symbol: "CLUSD", label: "Crude oil WTI (futures)", category: "Commodity", region: "Global", country: null },
  { symbol: "BZUSD", label: "Brent crude (futures)", category: "Commodity", region: "Global", country: null },
  { symbol: "NGUSD", label: "Natural gas (futures)", category: "Commodity", region: "Global", country: null },
  { symbol: "HGUSD", label: "Copper (futures)", category: "Commodity", region: "Global", country: null },
  // Added 2026-11-26 (owner's indices list; each confirmed by a live FMP probe with daily history to 2026-11-25/26).
  // Not added although FMP answered: LEAD (last bar Jul 2026), cotton CTUSD (Jan 2025), lean hogs HEUSD (Feb 2025),
  // feeder cattle GFUSD (Dec 2025): stale series are not charted.
  { symbol: "WIG20.WA", label: "WIG20 (Poland)", category: "Index", region: "Europe", country: "Poland" },
  { symbol: "WIG.WA", label: "WIG (Poland)", category: "Index", region: "Europe", country: "Poland" },
  { symbol: "RTSI.ME", label: "RTS Index (Russia)", category: "Index", region: "Europe", country: "Russia" },
  { symbol: "XIN9.FGI", label: "FTSE China A50 (from May 2023)", category: "Index", region: "Asia", country: "China" },
  { symbol: "PLUSD", label: "Platinum (futures)", category: "Commodity", region: "Global", country: null },
  { symbol: "PAUSD", label: "Palladium (futures)", category: "Commodity", region: "Global", country: null },
  { symbol: "HOUSD", label: "Heating oil (futures)", category: "Commodity", region: "Global", country: null },
  { symbol: "RBUSD", label: "RBOB gasoline (futures)", category: "Commodity", region: "Global", country: null },
  { symbol: "ALIUSD", label: "Aluminum (futures)", category: "Commodity", region: "Global", country: null },
  { symbol: "ZNUSD", label: "Zinc (futures)", category: "Commodity", region: "Global", country: null },
  { symbol: "KEUSX", label: "Wheat (futures)", category: "Commodity", region: "Global", country: null },
  { symbol: "ZRUSD", label: "Rough rice (futures)", category: "Commodity", region: "Global", country: null },
  { symbol: "ZCUSX", label: "Corn (futures)", category: "Commodity", region: "Global", country: null },
  { symbol: "ZSUSX", label: "Soybeans (futures)", category: "Commodity", region: "Global", country: null },
  { symbol: "ZLUSX", label: "Soybean oil (futures)", category: "Commodity", region: "Global", country: null },
  { symbol: "ZMUSD", label: "Soybean meal (futures)", category: "Commodity", region: "Global", country: null },
  { symbol: "CCUSD", label: "Cocoa (futures)", category: "Commodity", region: "Global", country: null },
  { symbol: "KCUSX", label: "Coffee (futures)", category: "Commodity", region: "Global", country: null },
  { symbol: "SBUSD", label: "Sugar (futures, from Nov 2021)", category: "Commodity", region: "Global", country: null },
  { symbol: "OJUSX", label: "Orange juice (futures)", category: "Commodity", region: "Global", country: null },
  { symbol: "LEUSX", label: "Live cattle (futures)", category: "Commodity", region: "Global", country: null },
  { symbol: "LBUSD", label: "Lumber (futures)", category: "Commodity", region: "Global", country: null },
  { symbol: "ZOUSX", label: "Oats (futures)", category: "Commodity", region: "Global", country: null },
];

/** Currency pairs built from the app's FX table (tas_fx, USD per unit of each currency). */
const MAJOR_BASE = new Set(["EUR", "GBP", "AUD", "NZD"]); // quoted XXX/USD by market convention
export function currencyPairs(currencies) {
  const out = [];
  for (const c of currencies) {
    if (c === "USD") continue;
    if (MAJOR_BASE.has(c)) out.push({ symbol: `FX:${c}USD`, label: `${c}/USD`, base: c, quote: "USD", per: 1 });
    else out.push({ symbol: `FX:USD${c}`, label: `USD/${c}`, base: "USD", quote: c, per: 1 });
  }
  // rupee crosses (the owner's home market)
  for (const [b, per] of [["EUR", 1], ["GBP", 1], ["JPY", 100], ["CNY", 1], ["AUD", 1], ["SGD", 1]]) {
    if (currencies.includes(b) && currencies.includes("INR")) out.push({ symbol: `FX:${b}INR`, label: `${per > 1 ? per + " " : ""}${b}/INR`, base: b, quote: "INR", per });
  }
  return out.map((p) => ({ ...p, category: "Currency", region: "Global", country: null, currency: p.quote }));
}

/** Price of BASE in QUOTE units from USD-per-unit rates. */
export const crossRate = (usdPerBase, usdPerQuote, per = 1) => (usdPerBase > 0 && usdPerQuote > 0 ? (usdPerBase / usdPerQuote) * per : null);

/** Currency an index level is quoted in, by country (exchange-provided indices are quoted in local currency). */
export const COUNTRY_CURRENCY = {
  Australia: "AUD", Brazil: "BRL", France: "EUR", Germany: "EUR", Spain: "EUR", Italy: "EUR", Netherlands: "EUR", Belgium: "EUR", Austria: "EUR",
  Ireland: "EUR", Finland: "EUR", "Euro area": "EUR", Europe: "EUR", "United Kingdom": "GBP", Canada: "CAD", "Hong Kong": "HKD", Indonesia: "IDR",
  "South Korea": "KRW", Argentina: "ARS", Mexico: "MXN", Japan: "JPY", "New Zealand": "NZD", Denmark: "DKK", Sweden: "SEK", Norway: "NOK",
  Switzerland: "CHF", Singapore: "SGD", Taiwan: "TWD", China: "CNY", Russia: "RUB", Malaysia: "MYR", Thailand: "THB", Israel: "ILS",
  Turkey: "TRY", Poland: "PLN", Chile: "CLP", "South Africa": "ZAR", India: "INR", "United States": "USD",
};
