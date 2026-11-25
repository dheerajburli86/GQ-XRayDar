// One name per industry group (Alok Sir, 2026-11-25: "look for all industries with similar name and merge them").
// The owner's US workbook and the rule table carry a few variants of the same group ("Pharmaceuticals",
// "Pharmaceuticals & Medical Products", "Pharmaceuticals, Biotechnology & Medical Devices"), which split one
// industry into tiny groups that then ranked on their own. Variants map to the main group here; the stock keeps
// its own sub-industry. Groups that are genuinely different (Semiconductor Equipment & Materials, Quantum
// Computing, Cloud & AI Compute Services ...) are NOT merged.

export const INDUSTRY_ALIASES = {
  "Pharmaceuticals & Medical Products": "Pharmaceuticals",
  "Pharmaceuticals, Biotechnology & Medical Devices": "Pharmaceuticals",
  "Automobiles & Components": "Automobiles",
  "Telecommunications": "Telecommunication Services",
  "Banking & Financial Services": "Banks",
  "Trading Companies & Leasing": "Trading Companies & Distributors",
  "Metals, Mining & Chemicals": "Metals & Mining",
  "Software & Digital Platforms": "Software",
  "Semiconductors & Hardware": "Semiconductors",
  "Electronic Components": "Electronic Equipment & Instruments",
  "Health Care Services": "Health Care Providers",
  "Diversified / Other Industrials": "Industrial Conglomerates",
  "Financial Services & Real Estate": "Diversified Financials",
  "Capital Goods & Transportation": "Machinery",
};

// spelling-only variants ("&" vs "and", commas, case) fold onto the first spelling seen in GICS_FIRST, else the alias table
const norm = (s) => String(s).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
const GICS_FIRST = ["Household and Personal Products", "Media and Entertainment", "Automobiles and Components", "Commercial and Professional Services",
  "Food, Beverage, and Tobacco", "Semiconductors and Semiconductor Equipment", "Pharmaceuticals, Biotechnology, and Life Sciences",
  "Health Care Equipment and Services", "Technology Hardware and Equipment", "Software and Services", "Consumer Durables and Apparel"];
const BY_NORM = new Map(GICS_FIRST.map((g) => [norm(g), g]));

/** The one name an industry group is shown and grouped under. */
export function canonicalIndustryGroup(name) {
  if (!name) return name;
  if (INDUSTRY_ALIASES[name]) return INDUSTRY_ALIASES[name];
  return BY_NORM.get(norm(name)) || name;
}
