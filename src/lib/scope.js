import { CAP_UNRELIABLE_COUNTRIES } from "../../engine/geography.js";

/** India (and any CAP_UNRELIABLE country) has no market cap here, so no size segment: a size filter on such a
 *  market would silently empty it (Alok Sir's Grok bot got "0 in scope", 2026-11-25). It is dropped there. */
export const capless = (scope, market) => CAP_UNRELIABLE_COUNTRIES.has(market) || CAP_UNRELIABLE_COUNTRIES.has(scope?.country) || CAP_UNRELIABLE_COUNTRIES.has(scope?.region);
export const effectiveScope = (scope, market) => (scope?.cap && capless(scope, market) ? { ...scope, cap: null } : scope || {});

