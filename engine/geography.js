// Country canonicalisation, region and market classification.
//
// The source data spells some countries two ways ("Hong Kong" / "Hong_kong",
// "United Kingdom" / "United_kingdom") and leaves `region` blank for whole
// markets (every US stock, ~1,000 Indian ones). The index hierarchy cannot
// rest on that column, so region and classification are derived here from the
// canonical country, never read from the row.
//
// Region and classification assignments are configuration [C]. The spec names
// five regions (US, Asia, Europe, Africa, LATAM); Canada fits none of them and
// is placed in "Other Americas" until that is decided. Middle-East markets sit
// in Asia and Australia / New Zealand in Asia (Asia-Pacific). Countries not
// listed below map to region "Unassigned" and classification "Unclassified",
// and are reported by the data-health page rather than guessed.

/**
 * Countries whose market caps are not reliable enough to publish (owner, 2026-11-19: India, no dependable source;
 * the heatmap hides them for the same reason). Their stocks keep charts, screens and scans, but carry NO cap, so they
 * join no CW, EW or Weight Watcher index and no "top N by cap" list. Remove a country here to bring it back.
 */
export const CAP_UNRELIABLE_COUNTRIES = new Set(["India"]);

export const REGIONS = ["US", "Asia", "Europe", "Africa", "LATAM", "Other Americas"];
export const CLASSIFICATIONS = ["US", "Emerging Markets", "European Developed Markets", "Other Developed Markets"];

// country -> [region, classification, primary currency]
const C = {
  "United States": ["US", "US", "USD"],
  Canada: ["Other Americas", "Other Developed Markets", "CAD"],
  // Developed Europe
  "United Kingdom": ["Europe", "European Developed Markets", "GBP"],
  Germany: ["Europe", "European Developed Markets", "EUR"],
  France: ["Europe", "European Developed Markets", "EUR"],
  Switzerland: ["Europe", "European Developed Markets", "CHF"],
  Netherlands: ["Europe", "European Developed Markets", "EUR"],
  Sweden: ["Europe", "European Developed Markets", "SEK"],
  Denmark: ["Europe", "European Developed Markets", "DKK"],
  Norway: ["Europe", "European Developed Markets", "NOK"],
  Finland: ["Europe", "European Developed Markets", "EUR"],
  Belgium: ["Europe", "European Developed Markets", "EUR"],
  Austria: ["Europe", "European Developed Markets", "EUR"],
  Ireland: ["Europe", "European Developed Markets", "EUR"],
  Portugal: ["Europe", "European Developed Markets", "EUR"],
  Spain: ["Europe", "European Developed Markets", "EUR"],
  Italy: ["Europe", "European Developed Markets", "EUR"],
  Iceland: ["Europe", "European Developed Markets", "ISK"],
  Luxembourg: ["Europe", "European Developed Markets", "EUR"],
  // Emerging Europe
  Poland: ["Europe", "Emerging Markets", "PLN"],
  Greece: ["Europe", "Emerging Markets", "EUR"],
  Turkey: ["Europe", "Emerging Markets", "TRY"],
  "Czech Republic": ["Europe", "Emerging Markets", "CZK"],
  Hungary: ["Europe", "Emerging Markets", "HUF"],
  // Asia developed
  Japan: ["Asia", "Other Developed Markets", "JPY"],
  Australia: ["Asia", "Other Developed Markets", "AUD"],
  "New Zealand": ["Asia", "Other Developed Markets", "NZD"],
  "Hong Kong": ["Asia", "Other Developed Markets", "HKD"],
  Singapore: ["Asia", "Other Developed Markets", "SGD"],
  Israel: ["Asia", "Other Developed Markets", "ILS"],
  // Asia emerging
  China: ["Asia", "Emerging Markets", "CNY"],
  India: ["Asia", "Emerging Markets", "INR"],
  Taiwan: ["Asia", "Emerging Markets", "TWD"],
  "South Korea": ["Asia", "Emerging Markets", "KRW"],
  Indonesia: ["Asia", "Emerging Markets", "IDR"],
  Thailand: ["Asia", "Emerging Markets", "THB"],
  Malaysia: ["Asia", "Emerging Markets", "MYR"],
  Philippines: ["Asia", "Emerging Markets", "PHP"],
  "Saudi Arabia": ["Asia", "Emerging Markets", "SAR"],
  "United Arab Emirates": ["Asia", "Emerging Markets", "AED"],
  Qatar: ["Asia", "Emerging Markets", "QAR"],
  Kuwait: ["Asia", "Emerging Markets", "KWD"],
  // LATAM
  Brazil: ["LATAM", "Emerging Markets", "BRL"],
  Mexico: ["LATAM", "Emerging Markets", "MXN"],
  Chile: ["LATAM", "Emerging Markets", "CLP"],
  Argentina: ["LATAM", "Emerging Markets", "ARS"],
  Colombia: ["LATAM", "Emerging Markets", "COP"],
  Peru: ["LATAM", "Emerging Markets", "PEN"],
  // Africa
  "South Africa": ["Africa", "Emerging Markets", "ZAR"],
  Egypt: ["Africa", "Emerging Markets", "EGP"],
  Nigeria: ["Africa", "Emerging Markets", "NGN"],
  Kenya: ["Africa", "Emerging Markets", "KES"],
  Morocco: ["Africa", "Emerging Markets", "MAD"],
};

const ALIASES = {
  "hong_kong": "Hong Kong", "united_kingdom": "United Kingdom", "united_states": "United States",
  "south_africa": "South Africa", "new_zealand": "New Zealand", "south_korea": "South Korea",
  "usa": "United States", "us": "United States", "uk": "United Kingdom", "korea": "South Korea",
  "czechia": "Czech Republic", "uae": "United Arab Emirates", "great britain": "United Kingdom",
};

const byLower = Object.fromEntries(Object.keys(C).map((k) => [k.toLowerCase(), k]));

/** Canonical country name, or the cleaned input when unknown (never null for non-empty input). */
export function canonicalCountry(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const l = s.toLowerCase();
  if (byLower[l]) return byLower[l];
  if (ALIASES[l]) return ALIASES[l];
  const spaced = l.replace(/_/g, " ");
  if (byLower[spaced]) return byLower[spaced];
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function countryMeta(country) {
  const m = C[country];
  return m ? { region: m[0], classification: m[1], currency: m[2], assigned: true }
    : { region: "Unassigned", classification: "Unclassified", currency: null, assigned: false };
}

export const knownCountries = () => Object.keys(C);

/** Family of a country's house benchmark: cap-weighted, except where no reliable market cap exists (India: equal-weight). */
export const countryFamily = (country) => (CAP_UNRELIABLE_COUNTRIES.has(country) ? "EW" : "CW");
/** Display tag for it ("CW" / "EW"). */
export const countryBenchLabel = (country) => `${country} ${countryFamily(country)}`;
