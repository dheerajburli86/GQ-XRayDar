// Small helpers over index series {dates, level}.
export function changeOver(s, bars) {
  if (!s?.level?.length) return null;
  const n = s.level.length - 1;
  return n - bars >= 0 && s.level[n - bars] ? (s.level[n] / s.level[n - bars] - 1) * 100 : null;
}
export const HBARS = { "1D": 1, "1W": 5, "1M": 21, "3M": 63, "6M": 126, "12M": 252 };
export function changeYtd(s) {
  if (!s?.dates?.length) return null;
  const y = s.dates[s.dates.length - 1].slice(0, 4);
  let k = s.dates.length - 1;
  while (k > 0 && s.dates[k].slice(0, 4) === y) k--;
  return s.dates[k].slice(0, 4) === y ? null : (s.level[s.level.length - 1] / s.level[k] - 1) * 100;
}
/** Rebase a series to 100 at the first date >= from. */
export function rebase(s, from) {
  const i = Math.max(0, s.dates.findIndex((d) => d >= from));
  const b = s.level[i];
  return { dates: s.dates.slice(i), level: s.level.slice(i).map((v) => (v / b) * 100) };
}
export const idxKey = (family, ccy, scope) => `${family}|${ccy}|${scope}`;
