// Alok Sir's item 19: an index quoted in local currency and its USD copy must not look alike. Every index name carries the currency
// it is quoted in: "KOSPI Composite Index (KRW)" and "KOSPI Composite Index (USD)". Names that already say so are left alone.
import { COUNTRY_CURRENCY } from "../../engine/reference/extraInstruments.js";

const HAS_CCY = /\((?:[A-Z]{3}|LCL)\)\s*$/;
export const hasCurrencyTag = (name) => HAS_CCY.test(String(name || ""));
export const withCurrency = (name, ccy) => (!name || !ccy || hasCurrencyTag(name) ? name : `${name} (${ccy})`);

/** Exchange-provided index securities (India, global, US): the currency is the country's, since the stored one says USD for every global index. */
export function labelIndexSecurity(sec) {
  if (!sec || sec.assetClass !== "Index") return sec;
  const ccy = COUNTRY_CURRENCY[sec.country];
  const name = withCurrency(sec.name, ccy);
  return name === sec.name ? sec : { ...sec, name };
}

/** Chart-only extras: indices are quoted in the currency their row records; USD copies and sets already say (USD). */
export function labelExtra(x) {
  if (!x || x.category !== "Index") return x;
  const label = withCurrency(x.label, x.currency);
  return label === x.label ? x : { ...x, label };
}
