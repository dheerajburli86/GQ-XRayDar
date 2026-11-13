// Flat "screen row": every screenable field of one security as a positional
// array, so the whole universe (20k+ securities) loads in one light request
// instead of 20k full snapshots. The full snapshot (with evidence) is fetched
// per security on demand.

import { FIELDS } from "./fields.js";

// Identity fields come from the security master; everything else is flattened.
const IDENTITY = new Set(["symbol", "name", "country", "region", "classification", "sector", "industryGroup", "industry", "cap", "capUsd", "currency"]);
export const SCREEN_KEYS = FIELDS.filter((f) => !IDENTITY.has(f.key)).map((f) => f.key);

const rnd = (v) => (typeof v === "number" ? (Number.isFinite(v) ? Math.round(v * 10000) / 10000 : null) : v);

export function buildFlat(fullRow) {
  return SCREEN_KEYS.map((k) => {
    const f = FIELDS.find((x) => x.key === k);
    const v = f.get(fullRow);
    return v === undefined ? null : rnd(v);
  });
}

export function decodeFlat(arr, keys = SCREEN_KEYS) {
  const o = {};
  for (let i = 0; i < keys.length; i++) o[keys[i]] = arr[i];
  return o;
}
