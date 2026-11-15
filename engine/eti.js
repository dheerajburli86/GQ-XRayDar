// IMB / ETI characteristics. Computed by the ETI project (dheerajburli86/ETI) and
// copied into the heatmap database (tas_eti_characteristic) by tas_eti_sync().
// This app only SHOWS them: each one is yes / no / unknown (unknown = not enough
// data to check the rule), with the numbers and notes behind it. No score, no
// rank, no view -- sir's rule for this project. Keys and rules match the ETI
// README; thresholds live in the ETI project's settings.

export const ETI_CHARACTERISTICS = [
  { key: "imb_cagr", framework: "imb", short: "CAGR 20%+", label: "Price CAGR at or above target", rule: "Split/bonus-adjusted price CAGR since 2010 (or listing) at least 20%" },
  { key: "imb_history_5y", framework: "imb", short: "5y history", label: "5+ years of history", rule: "The CAGR window covers at least 5 years" },
  { key: "imb_quiet_base", framework: "imb", short: "Quiet base", label: "Quiet base", rule: "6 months before the inflection: price move within ±20% and high/low range at most 1.45x" },
  { key: "imb_sustained_breakout", framework: "imb", short: "Breakout", label: "Sustained breakout", rule: "From a quiet base, cleared 1.25x its 6-month median and held 1.1x for 60 sessions" },
  { key: "imb_mcap_500", framework: "imb", short: "₹500 cr+", label: "₹500 cr+ at inflection", rule: "Market cap at least ₹500 cr on the inflection date, or crossed it within 12 months" },
  { key: "imb_gains_held", framework: "imb", short: "Gains held", label: "Gains held", rule: "At least 2x and 15% CAGR since the inflection" },
  { key: "eti_g1_new_vertical", framework: "eti", short: "G1 new vertical", label: "Gate 1: new vertical", rule: "New vertical at least 40% of order book / pipeline / capex while revenue is still at least 70% legacy" },
  { key: "eti_g2_hard_commitment", framework: "eti", short: "G2 hard commitment", label: "Gate 2: hard commitment", rule: "Hard physical capacity commitment stated in the last 12 months" },
  { key: "eti_g3_margins_holding", framework: "eti", short: "G3 margins holding", label: "Gate 3: margins holding", rule: "EBITDA margin (and gross margin where reported), latest quarter vs same quarter a year earlier, within 0.5 pp or better" },
  { key: "eti_g4_legacy_valuation", framework: "eti", short: "G4 legacy P/E", label: "Gate 4: legacy valuation", rule: "Trailing P/E between 10x and 20x" },
];
export const ETI_BY_KEY = Object.fromEntries(ETI_CHARACTERISTICS.map((c) => [c.key, c]));

/** meets -> "yes" | "no" | "unknown" (null means the rule could not be checked, never "no"). */
export const etiAnswer = (meets) => (meets === true ? "yes" : meets === false ? "no" : "unknown");

/**
 * Rows [{ company_id, characteristic, meets, ... }] -> Map(company_id -> company record)
 * with { flags: { key: "yes"|"no"|"unknown" }, detail: { key: row } }.
 */
export function groupEti(rows) {
  const m = new Map();
  for (const r of rows || []) {
    let c = m.get(r.company_id);
    if (!c) {
      c = { companyId: r.company_id, instrumentId: r.instrument_id != null ? String(r.instrument_id) : null, name: r.company_name, nse: r.nse_symbol, bse: r.bse_code, isin: r.isin, asOf: r.as_of, flags: {}, detail: {} };
      for (const x of ETI_CHARACTERISTICS) c.flags[x.key] = "unknown";
      m.set(r.company_id, c);
    }
    if (!ETI_BY_KEY[r.characteristic]) continue;
    c.flags[r.characteristic] = etiAnswer(r.meets);
    c.detail[r.characteristic] = { meets: r.meets, value: r.value, note: r.note, asOf: r.as_of, methodVersion: r.method_version };
    if (r.as_of && (!c.asOf || r.as_of > c.asOf)) c.asOf = r.as_of;
  }
  return m;
}

/** filter: { key: "yes"|"no"|"unknown"|"" } -- every set key must match. */
export function matchEti(company, filter) {
  for (const [k, want] of Object.entries(filter || {})) if (want && company.flags[k] !== want) return false;
  return true;
}
