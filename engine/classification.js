// Security master normalisation: one canonical record per listing.
// Sector = GICS sector (11), industry group = GICS industry group (25), shared
// verbatim by every market so a sector index in Tokyo and one in Mumbai are
// the same bucket. The crosswalk is a vendored snapshot of the heatmap
// dashboard's own taxonomy (engine/reference), so both products classify a
// stock identically.

import { classifyGics, OTHERS } from "./reference/gics.js";
import { INDUSTRY_MAP } from "./reference/industryMap.js";
import { US_CLASS } from "./reference/usClassification.js";
import { canonicalIndustryGroup } from "./reference/industryAliases.js";
import { usRuleFor } from "./reference/usIndustryRules.js";
import { canonicalCountry, countryMeta, CAP_UNRELIABLE_COUNTRIES } from "./geography.js";
import { majorCurrency } from "./fx.js";
import { etfType } from "./etfType.js";

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

// ETFs and exchange indices are analysed (charts, screens, alerts) but never
// enter the CW / EW index construction, breadth or Weight Watcher.
export const FUND_UNIVERSES = { us_etfs: "ETF", india_etfs: "ETF", global_etfs: "ETF", demo_etfs: "ETF", us_indices: "Index", india_indices: "Index", global_indices: "Index", demo_indices: "Index",
  commodities: "Commodity", crypto_etfs: "Crypto", currency_etf: "Currency" };
/** Asset classes beyond stocks. Commodity and crypto products are the heatmap's
 *  exchange-traded vehicles (GLD, USO, IBIT, ...); US currency ETFs are read
 *  from the heatmap's own etf_category, never guessed from a name. */
export const ASSET_CLASSES = ["Stock", "ETF", "Index", "Commodity", "Crypto", "Currency"];
const UNIVERSE_COUNTRY = { us_etfs: "United States", us_indices: "United States", india_etfs: "India", india_indices: "India", commodities: "United States", crypto_etfs: "United States", currency_etf: "United States" };

// The heatmap's "no trade in 5 sessions" marker. Such a row is still a company: it is analysed (charts, screens,
// the stock page) with a visible flag, but kept out of index construction, breadth and back-tests (owner, 2026-11-25:
// Neogen and other India stocks were missing from XRayDar).
export const DORMANT_MARKER = "NO_RECENT_TRADES";
export const isDormantRow = (row) => String(row.sector ?? "").trim() === DORMANT_MARKER;

// The instrument type of a stock row. A few India rows were added to the heatmap by hand without a type (Tata Motors
// CV, Page Industries, NLC India, Neogen ...): in india_stocks a missing type is a stock, because the heatmap marks
// non-companies there by sector, not by type. US "FUND" rows are REIT trusts with shares of beneficial interest.
function stockType(row) {
  const t = row.type == null || String(row.type).trim() === "" ? (row.universe === "india_stocks" ? "stock" : null) : row.type;
  return row.universe === "us_stocks" && t === "FUND" ? "CS" : t;
}

export function isAnalysableRow(row) {
  if (FUND_UNIVERSES[row.universe]) return true;
  return isEquityRow(row) || (isDormantRow(row) && !!EQUITY_UNIVERSES[row.universe]?.has(stockType(row)));
}

export function isEquityRow(row) {
  const types = EQUITY_UNIVERSES[row.universe];
  if (!types || !types.has(stockType(row))) return false;
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
  const fund = universe === "us_etfs" && row.etf_category === "currency" ? "Currency" : FUND_UNIVERSES[universe] || null;
  // ETFs: the industry-group slot carries the ETF type (Equity / Fixed income / Commodity / Currency / Real estate ...)
  const dormant = !fund && isDormantRow(row);
  const g = fund ? { sector: fund, industryGroup: fund === "ETF" ? etfType({ name: row.name, category: row.etf_category }).type : row.etf_category || fund, source: "asset_class" } : classifyGics({ symbol: row.symbol, industry, sector: dormant ? null : row.sector, universe });
  // owner's US workbook: sector / industry / sub-industry for US stocks and US-listed ADRs (replaces the GICS-derived labels where listed)
  let us = universe === "us_stocks" ? US_CLASS[row.symbol] || null : null;
  let usSource = us ? "us_workbook" : null;
  if (universe === "us_stocks" && !us) {
    // not in the workbook: place by the FMP profile industry (best fit), else keep the GICS-derived sector with no sub-industry
    us = usRuleFor(row.fmp_industry, row.market_cap_usd != null ? Number(row.market_cap_usd) : null);
    if (us) usSource = "us_rule";
  }
  const country = canonicalCountry(row.country) || UNIVERSE_COUNTRY[universe] || (universe === "india_stocks" ? "India" : universe === "us_stocks" ? "United States" : null);
  const meta = countryMeta(country);
  const currency = row.currency || meta.currency || "USD";
  const { major, divisor } = majorCurrency(currency);
  let capLocal = row.market_cap_local != null ? Number(row.market_cap_local) : null;
  let capCurrency = row.market_cap_currency || null;
  if (capLocal == null && row.market_cap_inr != null) { capLocal = Number(row.market_cap_inr); capCurrency = "INR"; }
  if (capLocal == null && row.market_cap_usd != null && major === "USD") { capLocal = Number(row.market_cap_usd); capCurrency = "USD"; }
  const noCap = CAP_UNRELIABLE_COUNTRIES.has(country);
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
    sector: us ? us[0] : g.sector,
    industryGroup: canonicalIndustryGroup(us ? us[1] : g.industryGroup),
    industry: us ? canonicalIndustryGroup(us[1]) : industry || null,
    // sub-industry, one level below the industry group, in every market (Alok Sir, 2026-11-26): US = the owner's workbook;
    // India = the exchanges' official basic industry (NSE / BSE harmonised scheme), else the India business label;
    // Global = the data vendor's industry (about 200 labels, finer than the 25 GICS groups)
    subIndustry: fund ? null : us ? us[2] : universe === "india_stocks" ? row.official_basic_industry || industry || null : universe === "global" ? row.industry || null : null,
    // GICS industry group even where the US workbook relabels the stock: cross-market groups (Global GLOCOM) use it
    gicsIndustryGroup: g.industryGroup || null,
    classSource: us ? usSource : g.source,
    capLocal: !noCap && capLocal && capLocal > 0 ? capLocal : null, // in capCurrency (major units)
    capCurrency: !noCap && capCurrency ? majorCurrency(capCurrency).major : null,
    capUsd: !noCap && row.market_cap_usd != null ? Number(row.market_cap_usd) : null,
    active: row.is_active !== false,
    assetClass: fund || "Stock",
    dormant,
  };
}

export const UNCLASSIFIED = OTHERS;
