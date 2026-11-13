// Security master normalisation: one canonical record per listing.
// Sector = GICS sector (11), industry group = GICS industry group (25), shared
// verbatim by every market so a sector index in Tokyo and one in Mumbai are
// the same bucket. The crosswalk is a vendored snapshot of the heatmap
// dashboard's own taxonomy (engine/reference), so both products classify a
// stock identically.

import { classifyGics, OTHERS } from "./reference/gics.js";
import { INDUSTRY_MAP } from "./reference/industryMap.js";
import { canonicalCountry, countryMeta } from "./geography.js";
import { majorCurrency } from "./fx.js";

// Rows the heatmap marks as non-companies (ETF, index, bonds, InvITs, SPACs,
// dormant). GICS classifies companies; these never enter an equity index.
export const NON_EQUITY_MARKERS = new Set([
  "ETF", "INDEX", "SOVEREIGN_BOND", "GSEC_SDL", "DEBT_INSTRUMENT", "INVIT", "PRE_MERGER_SPAC", "NO_RECENT_TRADES",
]);

const NSE_EQUITY_SERIES = new Set(["BE", "BZ", "ST", "SM", "IL", "BT", "DR"]);
export function nseBaseSymbol(symbol) {
  if (!symbol) return symbol;
  const i = symbol.lastIndexOf("-");
  if (i < 0) return symbol;
  return NSE_EQUITY_SERIES.has(symbol.slice(i + 1)) ? symbol.slice(0, i) : symbol;
}

/** Stock universes and the instrument types that count as an operating company. */
export const EQUITY_UNIVERSES = {
  us_stocks: new Set(["CS", "ADRC"]),
  global: new Set(["stock"]),
  india_stocks: new Set(["stock"]),
  demo: new Set(["stock"]),
};

export function isEquityRow(row) {
  const types = EQUITY_UNIVERSES[row.universe];
  if (!types || !types.has(row.type)) return false;
  return !NON_EQUITY_MARKERS.has(String(row.sector ?? "").trim());
}

/**
 * instruments row -> security-master record.
 * indiaMap: optional { SYMBOL: label } (india_industry_map.json); supplied by the caller
 * because JSON import differs between Node and the browser.
 */
export function toSecurity(row, indiaMap = null) {
  const universe = row.universe;
  let industry = row.industry ?? null;
  if (universe === "us_stocks") industry = INDUSTRY_MAP[row.symbol] ?? industry;
  if (universe === "india_stocks" && indiaMap) industry = indiaMap[row.symbol] ?? indiaMap[nseBaseSymbol(row.symbol)] ?? industry;
  const g = classifyGics({ symbol: row.symbol, industry, sector: row.sector, universe });
  const country = canonicalCountry(row.country) || (universe === "india_stocks" ? "India" : universe === "us_stocks" ? "United States" : null);
  const meta = countryMeta(country);
  const currency = row.currency || meta.currency || "USD";
  const { major, divisor } = majorCurrency(currency);
  let capLocal = row.market_cap_local != null ? Number(row.market_cap_local) : null;
  let capCurrency = row.market_cap_currency || null;
  if (capLocal == null && row.market_cap_inr != null) { capLocal = Number(row.market_cap_inr); capCurrency = "INR"; }
  if (capLocal == null && row.market_cap_usd != null && major === "USD") { capLocal = Number(row.market_cap_usd); capCurrency = "USD"; }
  return {
    id: row.id,
    symbol: row.symbol,
    name: row.name || row.symbol,
    universe,
    exchange: row.exchange || null,
    isin: row.isin || null,
    country,
    region: meta.region,
    classification: meta.classification,
    geoAssigned: meta.assigned,
    currency,            // trading (quote) currency, possibly a minor unit
    currencyMajor: major,
    currencyDivisor: divisor,
    countryCurrency: meta.currency || major,
    sector: g.sector,
    industryGroup: g.industryGroup,
    industry: industry || null,
    classSource: g.source,
    capLocal: capLocal && capLocal > 0 ? capLocal : null, // in capCurrency (major units)
    capCurrency: capCurrency ? majorCurrency(capCurrency).major : null,
    capUsd: row.market_cap_usd != null ? Number(row.market_cap_usd) : null,
    active: row.is_active !== false,
  };
}

export const UNCLASSIFIED = OTHERS;
