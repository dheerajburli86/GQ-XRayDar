// Derivatives data adapters. One adapter per exchange / feed; each says what it
// covers and what it needs. Only the NSE end-of-day adapter is connected: the
// rest are listed so the gap is visible and the slot for each is defined.

export const DERIV_SOURCES = [
  { key: "nse_eod", name: "NSE F&O end-of-day files", status: "connected",
    covers: ["Index and stock futures and options, every listed expiry and strike", "Settlement, close, OI, change in OI, volume, lot size", "Participant-wise OI (FII / DII / Pro / Client)", "F&O ban list and market-wide position limits"],
    timing: "After the exchange publishes the day's files (about 18:00-20:00 IST)" },
  { key: "live_fo", name: "Live F&O stream (broker WebSocket, e.g. Kite)", status: "not connected",
    needs: "A broker API session dedicated to this app (sharing the heatmap's live Kite session would log it out) and a server process holding the stream.",
    unlocks: ["Live chain and intraday OI / PCR / IV series", "Bid / ask and bid / ask IV", "Top-5 depth, time and sales, aggressive-side classification", "Footprint, cumulative volume delta, sweeps and block prints"] },
  { key: "nse_span", name: "NSE SPAN risk-parameter files", status: "not connected", needs: "Daily SPAN files and a SPAN calculator.", unlocks: ["Exchange-accurate SPAN + exposure margin and spread benefits"] },
  { key: "bse_fo", name: "BSE derivatives (SENSEX, BANKEX)", status: "not connected", needs: "BSE end-of-day derivatives bhavcopy (same adapter pattern as NSE)." },
  { key: "mcx", name: "MCX commodity futures and options", status: "not connected", needs: "MCX bhavcopy or a licensed vendor feed, with delivery-centre and product rules." },
  { key: "nse_cds", name: "NSE currency and interest-rate derivatives", status: "not connected", needs: "NSE CDS / IRF bhavcopy (USDINR, EURINR, GBPINR, JPYINR, bond futures)." },
  { key: "intl", name: "CME, Eurex, CBOE, SGX, ICE", status: "not connected", needs: "Vendor data licences per exchange; subject to local rules." },
  { key: "macro_calendar", name: "Macro and policy calendar (RBI, Fed, budget, data releases)", status: "not connected", needs: "A calendar feed; until then events can be added by hand on the Catalyst calendar." },
];
