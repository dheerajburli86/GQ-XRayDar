// Features hidden from version 1 because the data behind them is incomplete.
// Hiding is one line here and fully reversible: delete the key to bring a feature back.
// Each entry says why, so the next person does not have to guess.
export const HIDDEN = {
  dunusual: "Unusual activity: its core (live tape, block and sweep detection) needs a live options feed; end-of-day files cannot show it.",
  chartEvents: "Chart events tab: there is no corporate-event / economic-calendar feed, so it would be an empty calendar.",
};
export const isHidden = (key) => Object.prototype.hasOwnProperty.call(HIDDEN, key);

/** Owner, 2026-11-20: hide crypto everywhere in XRayDar for now. Set to false to bring it back (also restore the Crypto ticker category). */
export const HIDE_CRYPTO = true;
