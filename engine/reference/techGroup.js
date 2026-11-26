// Technology / Non Technology split used by the house index groups (owner / Alok Sir, 2026-11-26).
// Sir's decision: Technology = the Information Technology sector PLUS internet-platform and tech-like names
// (Alphabet, Meta, Amazon-type marketplaces, Tesla, SpaceX).
// US: the owner's workbook places every stock by sector / industry / sub-industry, so the extras are chosen by
// industry or sub-industry. India and Global have no sub-industry (GICS industry group only), so they use the
// GICS Information Technology sector alone until a sub-industry source exists for them.
// Change the definition here only; everything else reads techGroup().
export const TECH = "Technology";
export const NON_TECH = "Non Technology";
export const TECH_GROUPS = [TECH, NON_TECH];
export const TECH_SECTORS = new Set(["Information Technology"]);
/** Workbook industries (any sector) counted as technology: search / social / marketplace / platform / streaming / games. */
export const TECH_INDUSTRIES = new Set([
  "Digital Advertising", "Social & Community Platforms", "Interactive Entertainment", "Music & Audio",
  "Online Marketplaces & E-commerce", "Consumer Service Platforms",
]);
/** Workbook sub-industries counted as technology on their own (the rest of their industry is not). */
export const TECH_SUB_INDUSTRIES = new Set([
  "Video Streaming & Platforms",                       // Netflix
  "EV & Autonomous-Focused Vehicle Makers",            // Tesla
  "Satellite Communications",                          // SpaceX
  "Online Travel & Lodging Platforms",                 // Booking, Airbnb, Expedia
  "Vertical Marketplaces & Online Resale",             // eBay-type
]);

export function techGroup(sec) {
  if (TECH_SECTORS.has(sec?.sector)) return TECH;
  if (TECH_INDUSTRIES.has(sec?.industryGroup)) return TECH;
  if (sec?.subIndustry && TECH_SUB_INDUSTRIES.has(sec.subIndustry)) return TECH;
  return NON_TECH;
}
