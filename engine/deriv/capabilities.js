// Exchange capability matrix and per-exchange rule engines.
//
// Panels, screeners and pricing read these instead of assuming every exchange
// offers everything: when a capability is "no" or "needs feed", the page says
// so instead of showing an empty or imitated number.

/** yes = collected and used now · feed = needs a live / licensed feed · no = not published by the exchange · na = does not apply */
export const CAPABILITY_LEVELS = { yes: "Available", feed: "Needs a live or licensed feed", vendor: "Needs a vendor licence", no: "Not published", na: "Not applicable" };

export const CAPABILITIES = [
  { key: "eodChain", label: "End-of-day option chain (all strikes / expiries)" },
  { key: "eodFutures", label: "End-of-day futures" },
  { key: "intradayChain", label: "Intraday / live chain" },
  { key: "bidAsk", label: "Bid / ask quotes" },
  { key: "depth", label: "Level 2 / 3 order-book depth" },
  { key: "tape", label: "Time & sales (tick tape)" },
  { key: "participantOi", label: "Participant-wise OI (FII / DII / Pro / Client)" },
  { key: "mwpl", label: "MWPL and ban list" },
  { key: "span", label: "SPAN risk-parameter file (exact margin)" },
  { key: "european", label: "European-style options" },
  { key: "american", label: "American-style options" },
  { key: "physical", label: "Physical settlement of stock contracts" },
];

export const EXCHANGES = {
  NSE: { name: "NSE (equity derivatives)", connected: true, source: "NSE archive, end-of-day files via the nse-fo-fetch proxy",
    caps: { eodChain: "yes", eodFutures: "yes", intradayChain: "feed", bidAsk: "feed", depth: "feed", tape: "feed", participantOi: "yes", mwpl: "yes", span: "vendor", european: "yes", american: "no", physical: "yes" } },
  BSE: { name: "BSE (SENSEX / BANKEX derivatives)", connected: false, source: "BSE end-of-day files (adapter defined, not collected yet)",
    caps: { eodChain: "feed", eodFutures: "feed", intradayChain: "feed", bidAsk: "feed", depth: "feed", tape: "feed", participantOi: "no", mwpl: "no", span: "vendor", european: "yes", american: "no", physical: "yes" } },
  NSE_CDS: { name: "NSE currency derivatives", connected: false, source: "NSE CDS bhavcopy (adapter defined, not collected yet)",
    caps: { eodChain: "feed", eodFutures: "feed", intradayChain: "feed", bidAsk: "feed", depth: "feed", tape: "feed", participantOi: "no", mwpl: "na", span: "vendor", european: "yes", american: "no", physical: "na" } },
  MCX: { name: "MCX commodities", connected: false, source: "MCX bhavcopy or licensed feed",
    caps: { eodChain: "vendor", eodFutures: "vendor", intradayChain: "vendor", bidAsk: "vendor", depth: "vendor", tape: "vendor", participantOi: "no", mwpl: "na", span: "vendor", european: "yes", american: "no", physical: "yes" } },
  CME: { name: "CME Group", connected: false, source: "licensed vendor feed",
    caps: { eodChain: "vendor", eodFutures: "vendor", intradayChain: "vendor", bidAsk: "vendor", depth: "vendor", tape: "vendor", participantOi: "no", mwpl: "na", span: "vendor", european: "yes", american: "yes", physical: "yes" } },
  CBOE: { name: "Cboe", connected: false, source: "licensed vendor feed",
    caps: { eodChain: "vendor", eodFutures: "vendor", intradayChain: "vendor", bidAsk: "vendor", depth: "vendor", tape: "vendor", participantOi: "no", mwpl: "na", span: "na", european: "yes", american: "yes", physical: "yes" } },
  EUREX: { name: "Eurex", connected: false, source: "licensed vendor feed",
    caps: { eodChain: "vendor", eodFutures: "vendor", intradayChain: "vendor", bidAsk: "vendor", depth: "vendor", tape: "vendor", participantOi: "no", mwpl: "na", span: "na", european: "yes", american: "yes", physical: "yes" } },
  SGX: { name: "SGX", connected: false, source: "licensed vendor feed",
    caps: { eodChain: "vendor", eodFutures: "vendor", intradayChain: "vendor", bidAsk: "vendor", depth: "vendor", tape: "vendor", participantOi: "no", mwpl: "na", span: "vendor", european: "yes", american: "no", physical: "na" } },
  ICE: { name: "ICE", connected: false, source: "licensed vendor feed",
    caps: { eodChain: "vendor", eodFutures: "vendor", intradayChain: "vendor", bidAsk: "vendor", depth: "vendor", tape: "vendor", participantOi: "no", mwpl: "na", span: "na", european: "yes", american: "yes", physical: "yes" } },
};

export const capability = (exchange, key) => EXCHANGES[exchange]?.caps?.[key] || "no";
export const hasCapability = (exchange, key) => capability(exchange, key) === "yes";
/** Plain sentence for a panel that cannot show something on this exchange. */
export const capabilityNote = (exchange, key) => { const c = capability(exchange, key), cap = CAPABILITIES.find((x) => x.key === key)?.label || key; return c === "yes" ? null : `${cap}: ${CAPABILITY_LEVELS[c]} on ${EXCHANGES[exchange]?.name || exchange}.`; };

/**
 * Exchange rule engines. Lot sizes always come from the exchange's own file
 * (each contract row); these hold the rules that are not in the file.
 * Freeze quantities and thresholds as published by the exchange (rule versions dated).
 */
export const EXCHANGE_RULES = {
  NSE: {
    version: "2025 circulars (verify freeze limits against the latest circular)", mwplNearBan: 0.8, mwplBan: 0.95, mwplExit: 0.8, physicalWarnDays: 5,
    freezeQty: { NIFTY: 1800, BANKNIFTY: 900, FINNIFTY: 1800, MIDCPNIFTY: 2800, NIFTYNXT50: 600 },
    stockFreezeRule: "Freeze quantity for stock derivatives is set per contract by NSE (lot multiple); read from the contract file when present.",
    expiry: { index: "NIFTY weekly on Tuesday; monthly index contracts on the last Tuesday", stock: "last Tuesday of the month", holiday: "previous trading day" },
    settlement: { index: "cash, at the final settlement price (closing price of the index)", stock: "physical delivery for stock futures and in-the-money stock options" },
    style: "European", tradingHours: "09:15-15:30 IST", tick: 0.05,
  },
  BSE: {
    version: "2025 circulars (verify freeze limits against the latest circular)", mwplNearBan: 0.8, mwplBan: 0.95, mwplExit: 0.8, physicalWarnDays: 5, freezeQty: { SENSEX: 1000, BANKEX: 900 },
    expiry: { index: "SENSEX weekly on Thursday", stock: "last Thursday" }, settlement: { index: "cash", stock: "physical" }, style: "European", tradingHours: "09:15-15:30 IST", tick: 0.05,
  },
  MCX: { version: "not connected", expiry: { commodity: "contract-specific (product calendar)" }, settlement: { commodity: "cash or delivery per product; tender / delivery period before expiry" }, style: "European (options on futures)", tradingHours: "09:00-23:30 IST (varies by product)" },
};

/** Split an order quantity (units) into slices no larger than the freeze quantity. */
export function freezeSlices(exchange, und, qtyUnits, lot) {
  const fz = EXCHANGE_RULES[exchange]?.freezeQty?.[und];
  if (!fz) return { slices: [qtyUnits], freeze: null };
  const maxPer = Math.floor(fz / (lot || 1)) * (lot || 1) || fz;
  const out = []; let left = qtyUnits;
  while (left > 0) { const q = Math.min(left, maxPer); out.push(q); left -= q; }
  return { slices: out, freeze: fz };
}
