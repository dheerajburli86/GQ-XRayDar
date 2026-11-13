// Data health: problems that would otherwise surface only as a wrong number.
// Each issue names the instrument, the rule and the evidence. Nothing here
// changes data -- it reports.

export const SEVERITY = { error: 3, warn: 2, info: 1 };

/**
 * Per-security checks.
 *   daily                  own bars
 *   ctx.countryLatest      latest session date of the security's country
 *   ctx.countrySessions    Set of dates on which >= 80% of the country's listed stocks traded
 *   ctx.recentFrom         first date of the missing-session look-back window
 */
export function securityIssues(sec, daily, ctx) {
  const out = [];
  const add = (severity, rule, detail) => out.push({ id: sec.id, symbol: sec.symbol, country: sec.country, severity, rule, detail });
  const n = daily?.time?.length || 0;
  if (!n) { add("warn", "no_price_history", "No price bars"); return out; }
  const last = daily.time[n - 1];
  if (sec.active && ctx.countryLatest && last < ctx.countryLatest) {
    const behind = ctx.sessionsBetween ? ctx.sessionsBetween(last, ctx.countryLatest) : null;
    if (behind == null || behind > 5) add("warn", "stale_price", `Last bar ${last}; country latest ${ctx.countryLatest}${behind != null ? ` (${behind} sessions behind)` : ""}`);
  }
  if (ctx.countrySessions && ctx.recentFrom) {
    const have = new Set(daily.time);
    let missing = 0; const sample = [];
    for (const d of ctx.countrySessions) {
      if (d < ctx.recentFrom || d < daily.time[0] || d > last) continue;
      if (!have.has(d)) { missing++; if (sample.length < 5) sample.push(d); }
    }
    if (missing > 10) add("warn", "missing_sessions", `${missing} sessions missing in the last year where most of the country traded (e.g. ${sample.join(", ")})`);
    else if (missing > 0) add("info", "missing_sessions", `${missing} session(s) missing in the last year (e.g. ${sample.join(", ")})`);
  }
  const c = daily.close;
  for (let i = 1; i < n; i++) {
    const r = c[i] / c[i - 1];
    if (r > 1.8 || r < 0.55) {
      const reverted = i + 1 < n && Math.abs(c[i + 1] / c[i - 1] - 1) < 0.1;
      add(reverted ? "warn" : "error", reverted ? "price_spike" : "possible_split",
        `${daily.time[i - 1]} ${c[i - 1]} -> ${daily.time[i]} ${c[i]} (x${r.toFixed(3)})${reverted ? ", reverted next session" : " - check for an unadjusted corporate action"}`);
    }
  }
  for (let i = 0; i < n; i++) {
    if (daily.high && (daily.high[i] < daily.low[i] || daily.close[i] > daily.high[i] * 1.0001 || daily.close[i] < daily.low[i] * 0.9999)) {
      add("info", "ohlc_inconsistent", `${daily.time[i]} close outside high-low range`); break;
    }
  }
  const stock = !sec.assetClass || sec.assetClass === "Stock";
  if (stock && !sec.capLocal && !sec.capUsd) add("warn", "missing_market_cap", "No market cap: excluded from CW and EW indices");
  if (stock && sec.sector === "Others") add("info", "unclassified_sector", `No GICS sector (evidence: ${sec.classSource})`);
  if (!sec.geoAssigned) add("warn", "unassigned_geography", `Country "${sec.country}" has no region / classification mapping`);
  if (sec.countryCurrency && sec.currencyMajor !== sec.countryCurrency) add("info", "foreign_currency_listing", `Quoted in ${sec.currency}; country currency ${sec.countryCurrency} (converted via FX)`);
  return out;
}

/** Corporate-action adjustment: actions [{exDate, factor}] where factor = new shares per old
 *  (2-for-1 split -> 2). Prices before exDate are divided by the factor, volumes multiplied. */
export function applyCorporateActions(daily, actions) {
  if (!actions?.length) return { bars: daily, applied: [] };
  const bars = { ...daily, open: [...daily.open], high: [...daily.high], low: [...daily.low], close: [...daily.close], volume: daily.volume ? [...daily.volume] : null };
  const applied = [];
  for (const a of [...actions].sort((x, y) => (x.exDate < y.exDate ? -1 : 1))) {
    if (!(a.factor > 0) || a.factor === 1) continue;
    let k = 0;
    for (let i = 0; i < bars.time.length && bars.time[i] < a.exDate; i++) {
      bars.open[i] /= a.factor; bars.high[i] /= a.factor; bars.low[i] /= a.factor; bars.close[i] /= a.factor;
      if (bars.volume) bars.volume[i] *= a.factor;
      k++;
    }
    applied.push({ ...a, barsAdjusted: k });
  }
  return { bars, applied };
}
