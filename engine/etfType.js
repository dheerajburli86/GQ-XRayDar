// ETF type (owner, Nov 2026): Equity, Fixed income, Commodity, Currency, Real estate, Alternative, Multi-asset.
// The provider's asset class wins when it is known (tas_etf_info, from FMP); until then the type is read
// from the fund's name and the heatmap's category, and is marked as such ("from name").

export const ETF_TYPES = ["Equity", "Fixed income", "Commodity", "Currency", "Real estate", "Alternative", "Multi-asset", "Crypto"];

const FROM_PROVIDER = [
  [/fixed income|bond|debt|money market/i, "Fixed income"], [/commodit/i, "Commodity"], [/currenc/i, "Currency"],
  [/real estate|reit/i, "Real estate"], [/alternative/i, "Alternative"], [/multi|asset allocation|allocation|balanced/i, "Multi-asset"],
  [/crypto|digital/i, "Crypto"], [/equit|stock/i, "Equity"],
];

// order matters: miners / producers are equity even when the name says gold or oil
const NAME_RULES = [
  [/\b(bitcoin|ether(eum)?|crypto|solana|xrp)\b/i, "Crypto"],
  [/\b(miners?|mining|producers?|explorers?|equit(y|ies)|stocks?|companies|dividend|select sector|sector spdr)\b/i, "Equity"],
  [/\b(reits?|real estate|realty|property|properties|mortgage reit)\b/i, "Real estate"],
  [/\b(bonds?|treasur(y|ies)|t-?bills?|aggregate|fixed income|munis?|municipal|tax[- ]exempt|credit|high yield|corporate|tips|mbs|mortgage[- ]backed|floating rate|senior loan|bank loan|clo|duration|government|govt|gilts?|debt|money market|liquid|g-?sec|sdl|bharat bond|ultra[- ]short|income fund|short[- ]term income|cash management)\b/i, "Fixed income"],
  [/\b(gold|silver|bullion|precious metals?|platinum|palladium|crude|oil fund|brent|wti|natural gas|commodit(y|ies)|copper|agricultur(e|al)|grains?|wheat|corn|soybeans?|sugar|coffee|cocoa|uranium|lithium fund|carbon credit)\b/i, "Commodity"],
  [/\b(currency|currencies|dollar index|us dollar|euro\b|japanese yen|yen\b|swiss franc|british pound|sterling|rupee|yuan|renminbi|fx\b|forex)\b/i, "Currency"],
  [/\b(buffer|defined (outcome|protection)|structured|hedged equity|long[- ]short|market neutral|managed futures|merger arbitrage|volatility|vix|tail risk|option income|covered call|premium income|autocallable)\b/i, "Alternative"],
  [/\b(allocation|balanced|multi[- ]asset|target (date|risk)|60\/40|moderate|conservative|aggressive growth allocation)\b/i, "Multi-asset"],
];

/** {type, source: "provider" | "name" | "category"} for an ETF. */
export function etfType({ name, category, assetClass, providerClass }) {
  if (assetClass === "Currency") return { type: "Currency", source: "category" };
  if (assetClass === "Crypto") return { type: "Crypto", source: "category" };
  if (providerClass) for (const [re, t] of FROM_PROVIDER) if (re.test(providerClass)) return { type: t, source: "provider" };
  const n = String(name || "");
  for (const [re, t] of NAME_RULES) if (re.test(n)) return { type: t, source: "name" };
  if (category === "alternative" || category === "long_short") return { type: "Alternative", source: "category" };
  if (category === "currency") return { type: "Currency", source: "category" };
  return { type: "Equity", source: "name" };
}
